import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
} from "../shared/types.js";
import { validateAnalysisResult } from "./analysis-validator.js";
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
  parseAnalysisResult,
  parseConnectionTestResult,
} from "./agent-result-parser.js";
import {
  isDisplayableValidationFailure,
  salvageValidCandidates,
} from "./agent-result-salvage.js";
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
      "baseUrl" | "model" | "transport" | "timeoutMs" | "winRateEstimationEnabled"
    >,
    private readonly apiKey: string,
    private readonly catalog: CardCatalog,
    private readonly diagnostics?: AgentDiagnostics,
  ) {}

  async testConnection(): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const endpoint =
        this.settings.transport === "responses"
          ? "/v1/responses"
          : "/v1/chat/completions";
      const payload =
        this.settings.transport === "responses"
          ? await this.postJson(
              endpoint,
              responsesConnectionTestPayload(this.settings.model),
              controller.signal,
            )
          : await this.postChatWithStructuredFallback(
              endpoint,
              (mode) =>
                chatCompletionsConnectionTestPayload(this.settings.model, mode),
              controller.signal,
            );
      const text =
        this.settings.transport === "responses"
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
      const report = validateAnalysisResult(
        result,
        request.snapshot,
        this.catalog,
      );
      if (result.candidates.length > request.maxCandidates) {
        report.ok = false;
        report.errors.push(
          `Agent 返回了 ${result.candidates.length} 条路线，超过上限 ${request.maxCandidates}。`,
        );
      }
      if (report.ok) {
        return {
          ...result,
          warnings: [...result.warnings, ...report.warnings],
          createdAt: new Date().toISOString(),
        };
      }
      const salvage = salvageValidCandidates(
        result,
        request.snapshot,
        this.catalog,
        request.maxCandidates,
      );
      if (salvage) {
        this.emitDiagnostic("agent.analysis.salvaged_candidates", {
          attempt: attempt + 1,
          keptCandidates: salvage.candidates.length,
          originalCandidates: result.candidates.length,
          validationErrors: report.errors,
        });
        return {
          ...salvage,
          createdAt: new Date().toISOString(),
        };
      }
      if (attempt === 1 && isDisplayableValidationFailure(report.errors)) {
        return {
          ...result,
          warnings: [
            ...result.warnings,
            ...report.warnings,
            `本地校验提示：${report.errors.join("；")}`,
          ],
          createdAt: new Date().toISOString(),
        };
      }
      this.emitDiagnostic("agent.analysis.validation_failed", {
        attempt: attempt + 1,
        errors: report.errors,
        warnings: report.warnings,
      });
      repairErrors = report.errors;
    }
    throw new Error(`Agent 返回结果未通过本地校验：${repairErrors.join("；")}`);
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
      const endpoint =
        this.settings.transport === "responses"
          ? "/v1/responses"
          : "/v1/chat/completions";
      const startedAt = Date.now();
      const winRateEnabled = this.settings.winRateEstimationEnabled ?? false;
      const body =
        this.settings.transport === "responses"
          ? responsesPayload(
              this.settings.model,
              request,
              repairErrors,
              this.catalog,
              winRateEnabled,
            )
          : chatCompletionsPayload(
              this.settings.model,
              request,
              repairErrors,
              this.catalog,
              "json_object",
              winRateEnabled,
            );
      this.emitDiagnostic("agent.analysis.request_payload", {
        transport: this.settings.transport,
        model: this.settings.model,
        body,
      });
      const payload = await this.postJson(endpoint, body, combinedSignal);
      const text =
        this.settings.transport === "responses"
          ? extractResponsesText(payload)
          : extractChatCompletionsText(payload);
      this.emitDiagnostic("agent.analysis.raw_response", {
        elapsedMs: Date.now() - startedAt,
        responseText: text,
      });
      return parseAnalysisResult(text);
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
    endpoint: string,
    buildBody: (mode: StructuredOutputMode) => object,
    signal: AbortSignal,
  ): Promise<unknown> {
    try {
      return await this.postJson(endpoint, buildBody("json_schema"), signal);
    } catch (error) {
      if (error instanceof AgentHttpError && error.status === 400) {
        return this.postJson(endpoint, buildBody("json_object"), signal);
      }
      throw error;
    }
  }

  private async postJson(
    endpoint: string,
    body: object,
    signal: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(joinUrl(this.settings.baseUrl, endpoint), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
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

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.replace(/\/+$/, "");
  if (normalizedBase.endsWith(normalizedPath)) {
    return normalizedBase;
  }
  if (normalizedBase.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${normalizedBase}${path.slice(3)}`;
  }
  return `${normalizedBase}${path}`;
}

class AgentHttpError extends Error {
  constructor(readonly status: number) {
    super(`Agent 接口返回 HTTP ${status}。`);
  }
}
