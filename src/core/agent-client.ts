import type {
  AnalysisRequest,
  AnalysisResult,
  AppSettings,
} from "../shared/types.js";
import { validateAnalysisResult } from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";
import { sanitizeSnapshotForAgent } from "./snapshot-sanitizer.js";

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

export class AgentClient {
  constructor(
    private readonly settings: Pick<
      AppSettings,
      "baseUrl" | "model" | "transport" | "timeoutMs"
    >,
    private readonly apiKey: string,
    private readonly catalog: CardCatalog,
  ) {}

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const safeRequest: AnalysisRequest = {
      ...request,
      snapshot: sanitizeSnapshotForAgent(request.snapshot, this.catalog),
    };

    let repairErrors: string[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.requestAnalysis(safeRequest, repairErrors);
      const report = validateAnalysisResult(
        result,
        request.snapshot,
        this.catalog,
      );
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
  ): Promise<AnalysisResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.settings.timeoutMs);
    try {
      const endpoint =
        this.settings.transport === "responses"
          ? "/v1/responses"
          : "/v1/chat/completions";
      const response = await fetch(joinUrl(this.settings.baseUrl, endpoint), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          this.settings.transport === "responses"
            ? responsesPayload(this.settings.model, request, repairErrors)
            : chatCompletionsPayload(this.settings.model, request, repairErrors),
        ),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Agent 接口返回 HTTP ${response.status}。`);
      }
      const payload = (await response.json()) as unknown;
      const text =
        this.settings.transport === "responses"
          ? extractResponsesText(payload)
          : extractChatCompletionsText(payload);
      return parseAnalysisResult(text);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Agent 请求超过 ${this.settings.timeoutMs}ms。`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
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
): object {
  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserContent(request, repairErrors) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "hearthstone_analysis",
        strict: true,
        schema: ANALYSIS_RESULT_SCHEMA,
      },
    },
  };
}

function buildUserContent(
  request: AnalysisRequest,
  repairErrors: string[],
): string {
  const repair =
    repairErrors.length > 0
      ? `\n上一次结果存在以下错误，请修复：${repairErrors.join("；")}`
      : "";
  return `分析以下结构化局面，最多返回 ${request.maxCandidates} 条候选路线。${repair}\n${JSON.stringify(request)}`;
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

function joinUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  if (normalizedBase.endsWith("/v1") && path.startsWith("/v1/")) {
    return `${normalizedBase}${path.slice(3)}`;
  }
  return `${normalizedBase}${path}`;
}
