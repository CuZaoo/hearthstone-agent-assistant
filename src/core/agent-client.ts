import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
} from "../shared/types.js";
import { validateAnalysisResult } from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";
import { sanitizeSnapshotForAgent } from "./snapshot-sanitizer.js";

type StructuredOutputMode = "json_schema" | "json_object";
type AgentDiagnosticEvent = {
  event: string;
  data?: Record<string, unknown>;
};
type AgentDiagnostics = (event: AgentDiagnosticEvent) => void;

const SYSTEM_PROMPT = `你是炉石传说标准构筑对局分析助手。
你只能使用请求中明确提供的可见信息，不得假设对手手牌、牌库顺序或随机结果。
你的目标是提供当前回合的高质量候选路线，不得声称路线是数学最优。
每条路线必须引用请求中存在的实体 ID，并说明理由、主要风险与置信度。
sourceCardId 必须与 sourceEntityId 对应实体的 cardId 完全一致；end-turn 不得携带来源或目标。
description 只描述动作本身，例如“打出神圣新星”或“卡多雷女祭司攻击敌方英雄”，不得把法术写成战吼，不得编造卡牌文本外的效果。
如果某条路线无法满足实体、费用、攻击、目标和场面容量约束，就不要返回这条路线。
只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。`;

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

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
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
  ): Promise<AnalysisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const endpoint =
        this.settings.transport === "responses"
          ? "/v1/responses"
          : "/v1/chat/completions";
      const startedAt = Date.now();
      const payload =
        this.settings.transport === "responses"
          ? await this.postJson(
              endpoint,
              responsesPayload(this.settings.model, request, repairErrors),
              controller.signal,
            )
          : await this.postJson(
              endpoint,
              chatCompletionsPayload(
                this.settings.model,
                request,
                repairErrors,
                "json_object",
              ),
              controller.signal,
            );
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
    temperature: 0.2,
    max_tokens: 2_000,
    stream: false,
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
      ? `\n上一次结果存在以下错误，请修复或删除相关路线：${repairErrors.join("；")}`
      : "";
  const schema =
    mode === "json_object"
      ? `\n只返回 JSON 对象。不要输出思考过程、重新评估过程或长篇解释。
限制：summary 不超过 80 字；每条路线最多 4 个动作；description 不超过 30 字；rationale 不超过 120 字；每条 risk 不超过 40 字。
字段为：
{
  "snapshotRevision": "${request.snapshot.revision}",
  "summary": "简短中文总结",
  "warnings": ["可为空"],
  "candidates": [
    {
      "rank": 1,
      "actions": [
        {
          "type": "play-card | attack | hero-power | trade | end-turn",
          "sourceEntityId": 数字或 null,
          "sourceCardId": "字符串或 null",
          "targetEntityId": 数字或 null,
          "targetSide": "self | opponent | null",
          "description": "中文动作"
        }
      ],
      "rationale": "中文理由",
      "risks": ["可为空"],
      "confidence": 0到1
    }
  ]
}
不要返回格式定义，不要解释字段含义，只返回本局分析结果。`
      : "";
  return `分析以下结构化局面，最多返回 ${request.maxCandidates} 条候选路线。
硬性规则：
- 只能使用 snapshot.self.hand、snapshot.self.board、snapshot.self.hero、snapshot.self.heroPower 中存在的己方 sourceEntityId。
- play-card 必须来自 self.hand；attack 必须来自可攻击的 self.board 或英雄；hero-power 只能使用 self.heroPower。
- sourceCardId 必须等于该 sourceEntityId 的 cardId；没有 cardId 时填 null。
- description 不要复述或改写不存在的效果标签，只写卡名、动作和目标。
${repair}${schema}\n${JSON.stringify(request)}`;
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
