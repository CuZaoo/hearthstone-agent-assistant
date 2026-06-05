import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
} from "../shared/types.js";
import { validateAnalysisResult } from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";
import { sanitizeSnapshotForAgent } from "./snapshot-sanitizer.js";

type StructuredOutputMode = "json_schema" | "json_object";

const SYSTEM_PROMPT = `你是炉石传说标准构筑对局分析助手。
你只能使用请求中明确提供的可见信息，不得假设对手手牌、牌库顺序或随机结果。
你的目标是提供当前回合的高质量候选路线，不得声称路线是数学最优。
每条路线必须引用请求中存在的实体 ID，并说明理由、主要风险与置信度。
只返回符合 JSON Schema 的结果。`;

const ANALYSIS_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["snapshotRevision", "summary", "candidates", "warnings"],
  properties: {
    snapshotRevision: { type: "string" },
    summary: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rank", "actions", "rationale", "risks", "confidence"],
        properties: {
          rank: { type: "integer" },
          rationale: { type: "string" },
          risks: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          actions: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "type",
                "sourceEntityId",
                "sourceCardId",
                "targetEntityId",
                "targetSide",
                "description",
              ],
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "play-card",
                    "attack",
                    "hero-power",
                    "trade",
                    "end-turn",
                  ],
                },
                sourceEntityId: { type: ["integer", "null"] },
                sourceCardId: { type: ["string", "null"] },
                targetEntityId: { type: ["integer", "null"] },
                targetSide: {
                  type: ["string", "null"],
                  enum: ["self", "opponent", null],
                },
                description: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const CONNECTION_TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok", "message"],
  properties: {
    ok: { type: "boolean" },
    message: { type: "string" },
  },
} as const;

export class AgentClient {
  constructor(
    private readonly settings: Pick<
      AppSettings,
      "baseUrl" | "model" | "transport" | "timeoutMs"
    >,
    private readonly apiKey: string,
    private readonly catalog: CardCatalog,
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

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const safeRequest: AnalysisRequest = {
      ...request,
      snapshot: sanitizeSnapshotForAgent(request.snapshot, this.catalog),
    };

    let repairErrors: string[] = [];
    const deadline = Date.now() + this.settings.timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(`Agent 分析超过 ${this.settings.timeoutMs}ms 总预算。`);
      }
      const result = await this.requestAnalysis(
        safeRequest,
        repairErrors,
        remainingMs,
      );
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
      repairErrors = report.errors;
    }
    throw new Error(`Agent 返回结果未通过本地校验：${repairErrors.join("；")}`);
  }

  private async requestAnalysis(
    request: AnalysisRequest,
    repairErrors: string[],
    timeoutMs: number,
  ): Promise<AnalysisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const endpoint =
        this.settings.transport === "responses"
          ? "/v1/responses"
          : "/v1/chat/completions";
      const payload =
        this.settings.transport === "responses"
          ? await this.postJson(
              endpoint,
              responsesPayload(this.settings.model, request, repairErrors),
              controller.signal,
            )
          : await this.postChatWithStructuredFallback(
              endpoint,
              (mode) =>
                chatCompletionsPayload(
                  this.settings.model,
                  request,
                  repairErrors,
                  mode,
                ),
              controller.signal,
            );
      const text =
        this.settings.transport === "responses"
          ? extractResponsesText(payload)
          : extractChatCompletionsText(payload);
      return parseAnalysisResult(text);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
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
}

function responsesConnectionTestPayload(model: string): object {
  return {
    model,
    instructions: "只返回 JSON，表示接口、模型和结构化输出可用。",
    input: "返回 ok=true，message 使用简体中文，长度不超过 20 个字。",
    max_output_tokens: 80,
    text: {
      format: {
        type: "json_schema",
        name: "agent_connection_test",
        strict: true,
        schema: CONNECTION_TEST_SCHEMA,
      },
    },
  };
}

function chatCompletionsConnectionTestPayload(
  model: string,
  mode: StructuredOutputMode = "json_schema",
): object {
  return {
    model,
    messages: [
      { role: "system", content: "只返回 JSON，表示接口、模型和结构化输出可用。" },
      {
        role: "user",
        content:
          "返回 JSON 对象: {\"ok\":true,\"message\":\"连接正常\"}。message 使用简体中文，长度不超过 20 个字。",
      },
    ],
    max_tokens: 80,
    response_format:
      mode === "json_schema"
        ? {
            type: "json_schema",
            json_schema: {
              name: "agent_connection_test",
              strict: true,
              schema: CONNECTION_TEST_SCHEMA,
            },
          }
        : { type: "json_object" },
  };
}

function responsesPayload(
  model: string,
  request: AnalysisRequest,
  repairErrors: string[],
): object {
  return {
    model,
    instructions: SYSTEM_PROMPT,
    input: buildUserContent(request, repairErrors),
    text: {
      format: {
        type: "json_schema",
        name: "hearthstone_analysis",
        strict: true,
        schema: ANALYSIS_RESULT_SCHEMA,
      },
    },
  };
}

function chatCompletionsPayload(
  model: string,
  request: AnalysisRequest,
  repairErrors: string[],
  mode: StructuredOutputMode = "json_schema",
): object {
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserContent(request, repairErrors, mode) },
    ],
    response_format:
      mode === "json_schema"
        ? {
            type: "json_schema",
            json_schema: {
              name: "hearthstone_analysis",
              strict: true,
              schema: ANALYSIS_RESULT_SCHEMA,
            },
          }
        : { type: "json_object" },
  };
}

function buildUserContent(
  request: AnalysisRequest,
  repairErrors: string[],
  mode: StructuredOutputMode = "json_schema",
): string {
  const repair =
    repairErrors.length > 0
      ? `\n上一次结果存在以下错误，请修复：${repairErrors.join("；")}`
      : "";
  const schema =
    mode === "json_object"
      ? `\n返回 JSON 必须匹配此结构：${JSON.stringify(ANALYSIS_RESULT_SCHEMA)}`
      : "";
  return `分析以下结构化局面，最多返回 ${request.maxCandidates} 条候选路线。${repair}${schema}\n${JSON.stringify(request)}`;
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
  try {
    const parsed = JSON.parse(text) as AnalysisResult;
    return {
      ...parsed,
      candidates: parsed.candidates.map((candidate) => ({
        ...candidate,
        actions: candidate.actions.map((action) => ({
          ...action,
          sourceEntityId: action.sourceEntityId ?? undefined,
          sourceCardId: action.sourceCardId ?? undefined,
          targetEntityId: action.targetEntityId ?? undefined,
          targetSide: action.targetSide ?? undefined,
        })),
      })),
    };
  } catch {
    throw new Error("Agent 返回了无效 JSON。");
  }
}

function parseConnectionTestResult(text: string): {
  ok: boolean;
  message: string;
} {
  try {
    const parsed = JSON.parse(text) as { ok?: unknown; message?: unknown };
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

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
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
