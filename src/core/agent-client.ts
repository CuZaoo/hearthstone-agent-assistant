import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
  PromptConfig,
} from "../shared/types.js";
import {
  isDisplayableValidationFailure,
  salvageValidCandidates,
} from "./agent-result-salvage.js";
import { validateCandidateLine } from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";
import {
  chatCompletionsConnectionTestPayload,
  chatCompletionsPayload,
  responsesConnectionTestPayload,
  responsesPayload,
  type StructuredOutputMode,
} from "./agent-prompt.js";
import {
  extractChatCompletionsText,
  extractResponsesText,
  extractUsage,
  parseAnalysisResult,
  parseConnectionTestResult,
} from "./agent-result-parser.js";

import { sanitizeSnapshotForAgent } from "./snapshot-sanitizer.js";

type AgentDiagnosticEvent = {
  event: string;
  data?: Record<string, unknown>;
};
type AgentDiagnostics = (event: AgentDiagnosticEvent) => void;

export class AgentClient {
  constructor(
    private readonly settings: Pick<
      AppSettings,
      "apiUrl" | "model" | "format" | "timeoutMs" | "winRateEstimationEnabled"
    > & { promptConfig?: PromptConfig },
    private readonly apiKey: string,
    private readonly catalog: CardCatalog,
    private readonly diagnostics?: AgentDiagnostics,
  ) {}

  async testConnection(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const payload =
        this.settings.format === "responses"
          ? await this.postJson(
              responsesConnectionTestPayload(this.settings.model),
              controller.signal,
            )
          : await this.postChatWithStructuredFallback(
              (mode) =>
                chatCompletionsConnectionTestPayload(this.settings.model, mode),
              controller.signal,
            );
      const text =
        this.settings.format === "responses"
          ? extractResponsesText(payload)
          : extractChatCompletionsText(payload);
      const parsed = parseConnectionTestResult(text);
      if (!parsed.ok) {
        throw new Error(parsed.message || "Agent 连接测试未通过。");
      }
      return parsed.message;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Agent 连接测试超过 ${this.settings.timeoutMs}ms。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async analyze(
    request: AnalysisRequest,
    externalSignal?: AbortSignal,
  ): Promise<AnalysisResult> {
    const safeRequest: AnalysisRequest = {
      ...request,
      snapshot: sanitizeSnapshotForAgent(request.snapshot, this.catalog),
    };
    this.emitDiagnostic("agent.analysis.input", {
      snapshotRevision: safeRequest.snapshot.revision,
      requestBytes: JSON.stringify(safeRequest).length,
      visibleHistoryCount: safeRequest.snapshot.visibleHistory.length,
      handCount: safeRequest.snapshot.self.hand.length,
      selfBoardCount: safeRequest.snapshot.self.board.length,
      opponentBoardCount: safeRequest.snapshot.opponent.board.length,
    });

    let repairErrors: string[] = [];
    const deadline = Date.now() + this.settings.timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Agent 分析超过 ${this.settings.timeoutMs}ms 总预算。`);
      }
      let result: AnalysisResult;
      try {
        result = await this.requestAnalysis(
          safeRequest,
          repairErrors,
          remainingMs,
          externalSignal,
        );
      } catch (error) {
        if (attempt === 0 && error instanceof Error) {
          repairErrors = [
            `${error.message} 请重新返回完整 JSON；不要输出推理过程；summary、rationale、description 必须简短。`,
          ];
          this.emitDiagnostic("agent.analysis.retry_after_error", {
            attempt: attempt + 1,
            error: error.message,
          });
          continue;
        }
        throw error;
      }

      const salvaged = salvageValidCandidates(
        result,
        request.snapshot,
        this.catalog,
        request.maxCandidates,
      );
      if (salvaged) {
        return {
          ...salvaged,
          createdAt: new Date().toISOString(),
        };
      }

      if (attempt === 0) {
        repairErrors = collectCandidateErrors(result, request.snapshot, this.catalog);
        if (result.candidates.length > request.maxCandidates) {
          repairErrors.push(`返回了 ${result.candidates.length} 条路线，超过上限 ${request.maxCandidates}。`);
        }
        this.emitDiagnostic("agent.analysis.retry_after_validation", {
          attempt: attempt + 1,
          errors: repairErrors,
        });
        continue;
      }

      const finalErrors = collectCandidateErrors(result, request.snapshot, this.catalog);
      if (result.candidates.length > request.maxCandidates) {
        finalErrors.push(`返回了 ${result.candidates.length} 条路线，超过上限 ${request.maxCandidates}。`);
      }
      if (isDisplayableValidationFailure(finalErrors)) {
        return {
          ...result,
          warnings: [
            ...result.warnings,
            `本地校验提示：${finalErrors.join("；")}`,
          ],
          createdAt: new Date().toISOString(),
        };
      }

      throw new Error(
        `Agent 返回结果未通过本地校验：${finalErrors.join("；")}`,
      );
    }
    throw new Error("Agent 分析出现未预期的流程错误。");
  }

  private async requestAnalysis(
    request: AnalysisRequest,
    repairErrors: string[],
    timeoutMs: number,
    externalSignal?: AbortSignal,
  ): Promise<AnalysisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const combinedSignal = externalSignal
      ? AbortSignal.any([controller.signal, externalSignal])
      : controller.signal;
    try {
      const startedAt = Date.now();
      const winRateEnabled = this.settings.winRateEstimationEnabled ?? false;
      const promptConfig = this.settings.promptConfig;
      const requestBody =
        this.settings.format === "responses"
          ? responsesPayload(
              this.settings.model,
              request,
              repairErrors,
              this.catalog,
              winRateEnabled,
              promptConfig,
            )
          : chatCompletionsPayload(
              this.settings.model,
              request,
              repairErrors,
              this.catalog,
              "json_schema",
              winRateEnabled,
              promptConfig,
            );
      this.emitDiagnostic("agent.analysis.request_payload", {
        format: this.settings.format,
        model: this.settings.model,
        body: requestBody,
      });
      const payload =
        this.settings.format === "responses"
          ? await this.postJson(requestBody, combinedSignal)
          : await this.postChatWithStructuredFallback(
              (mode) =>
                chatCompletionsPayload(
                  this.settings.model,
                  request,
                  repairErrors,
                  this.catalog,
                  mode,
                  winRateEnabled,
                  promptConfig,
                ),
              combinedSignal,
            );
      const text =
        this.settings.format === "responses"
          ? extractResponsesText(payload)
          : extractChatCompletionsText(payload);
      const usage = extractUsage(payload, this.settings.format);
      this.emitDiagnostic("agent.analysis.raw_response", {
        elapsedMs: Date.now() - startedAt,
        responseText: text,
        usage,
      });
      return { ...parseAnalysisResult(text), usage, durationMs: Date.now() - startedAt };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (externalSignal?.aborted) {
          throw new Error("用户取消了分析。");
        }
        throw new Error(`Agent 请求超过 ${timeoutMs}ms。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async postChatWithStructuredFallback(
    buildBody: (mode: StructuredOutputMode) => object,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.postJson(buildBody("json_schema"), signal);
    } catch (error) {
      if (error instanceof AgentHttpError && error.status === 400) {
        return this.postJson(buildBody("json_object"), signal);
      }
      throw error;
    }
  }

  private async postJson(
    body: object,
    signal: AbortSignal,
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const response = await fetch(this.settings.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      throw new AgentHttpError(response.status);
    }
    return response.json() as Promise<unknown>;
  }

  private emitDiagnostic(event: string, data: Record<string, unknown>): void {
    this.diagnostics?.({ event, data });
  }
}

class AgentHttpError extends Error {
  constructor(readonly status: number) {
    super(`Agent 接口返回 HTTP ${status}。`);
  }
}

function collectCandidateErrors(
  result: AnalysisResult,
  snapshot: AnalysisRequest["snapshot"],
  catalog: CardCatalog,
): string[] {
  return result.candidates.flatMap((candidate) => {
    const report = validateCandidateLine(candidate, snapshot, catalog);
    return report.errors;
  });
}
