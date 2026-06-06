import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
  GameStateSnapshot,
} from "../shared/types.js";
import {
  validateAnalysisResult,
  validateCandidateLine,
} from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";
import {
  chatCompletionsConnectionTestPayload,
  chatCompletionsPayload,
  responsesConnectionTestPayload,
  responsesPayload,
  type StructuredOutputMode,
} from "./agent-prompt.js";
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

function salvageValidCandidates(
  result: AnalysisResult,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
  maxCandidates: number,
): AnalysisResult | undefined {
  if (
    result.snapshotRevision !== snapshot.revision ||
    result.candidates.length === 0
  ) {
    return undefined;
  }

  const reports = result.candidates.map((candidate) => ({
    candidate,
    report: validateCandidateLine(candidate, snapshot, catalog),
  }));
  const validCandidates = reports
    .filter((entry) => entry.report.ok)
    .map((entry) => entry.candidate);
  if (validCandidates.length === 0) {
    return undefined;
  }

  const invalidReports = reports.filter((entry) => !entry.report.ok);
  const keptCandidates = validCandidates
    .slice(0, maxCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
  const warningParts = [
    ...reports.flatMap((entry) => entry.report.warnings),
  ];
  if (invalidReports.length > 0) {
    warningParts.push(
      `已丢弃 ${invalidReports.length} 条未通过本地校验的路线：${invalidReports
        .map(
          (entry) =>
            `路线 ${entry.candidate.rank} ${entry.report.errors.join("；")}`,
        )
        .join("；")}`,
    );
  }
  if (validCandidates.length > keptCandidates.length) {
    warningParts.push(
      `Agent 返回路线超过上限，已只保留前 ${maxCandidates} 条可用路线。`,
    );
  }

  return {
    ...result,
    candidates: keptCandidates,
    warnings: [...result.warnings, ...warningParts],
  };
}

function isDisplayableValidationFailure(errors: string[]): boolean {
  return (
    errors.length > 0 &&
    errors.every((error) =>
      [
        "基础费用超过当前法力",
        "基础费用高于当前法力",
        "临时法力牌后没有使用获得的法力",
        "会超过随从区容量",
      ].some((pattern) => error.includes(pattern)),
    )
  );
}

function extractResponsesText(payload: unknown): string {
  const data = payload as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  if (data.output_text) {
    return data.output_text;
  }
  for (const output of data.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && content.text) {
        return content.text;
      }
    }
  }
  throw new Error("Responses API 未返回可解析的文本结果。");
}

function extractChatCompletionsText(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Chat Completions API 未返回可解析的文本结果。");
  }
  return text;
}

function parseAnalysisResult(text: string): AnalysisResult {
  const json = extractJsonObject(text);
  let parsed: AnalysisResult;
  try {
    parsed = JSON.parse(json) as AnalysisResult;
  } catch {
    throw new Error("Agent 返回了无效 JSON。");
  }
  if (
    typeof parsed.snapshotRevision !== "string" ||
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.warnings) ||
    !Array.isArray(parsed.candidates)
  ) {
    throw new Error("Agent 返回 JSON 结构无效：缺少 snapshotRevision、summary、warnings 或 candidates。");
  }
  return {
    ...parsed,
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      actions: Array.isArray(candidate.actions)
        ? candidate.actions.map((action) => ({
            ...action,
            sourceEntityId: action.sourceEntityId ?? undefined,
            sourceCardId: action.sourceCardId ?? undefined,
            targetEntityId: action.targetEntityId ?? undefined,
            targetSide: action.targetSide ?? undefined,
          }))
        : [],
    })),
  };
}

function parseConnectionTestResult(text: string): {
  ok: boolean;
  message: string;
} {
  try {
    const parsed = JSON.parse(extractJsonObject(text)) as {
      ok?: unknown;
      message?: unknown;
    };
    if (typeof parsed.ok !== "boolean" || typeof parsed.message !== "string") {
      throw new Error("Agent 连接测试返回结构无效。");
    }
    return { ok: parsed.ok, message: parsed.message };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Agent 连接测试返回了无效 JSON。");
  }
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*(?<json>\{[\s\S]*?\})\s*```/i)
    ?.groups?.json;
  if (fenced) {
    return fenced;
  }

  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error("Agent 返回了无效 JSON。");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  throw new Error("Agent 返回了无效 JSON。");
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
