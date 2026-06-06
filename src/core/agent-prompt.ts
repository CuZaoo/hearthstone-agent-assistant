import type { AnalysisRequest } from "../shared/types.js";
import { buildLocalActionHints } from "./agent-action-hints.js";
import type { CardCatalog } from "./card-catalog.js";

export type StructuredOutputMode = "json_schema" | "json_object";

function systemPrompt(winRateEstimationEnabled: boolean): string {
  const winRateLine = winRateEstimationEnabled
    ? `对每条路线估算 winRateBefore（执行前胜率）和 winRateAfter（执行后胜率），范围 0~1。`
    : "";
  return `你是炉石传说对局分析助手。
你只能使用请求中明确提供的可见信息，不得假设对手手牌、牌库顺序或随机结果。
你的目标是提供当前回合的高质量候选路线，不得声称路线是数学最优。
每条路线必须引用请求中存在的实体 ID，并说明理由、主要风险与置信度。
${winRateLine}
sourceCardId 必须与 sourceEntityId 对应实体的 cardId 完全一致；end-turn 不得携带来源或目标。
description 只描述动作本身，例如"打出神圣新星"或"卡多雷女祭司攻击敌方英雄"，不得把法术写成战吼，不得编造卡牌文本外的效果。
幸运币或其他"本回合获得法力"的牌只能在后续动作会立刻使用这点法力时打出；不得推荐"打出幸运币，然后结束回合"。
如果某条路线无法满足实体、费用、攻击、目标和场面容量约束，就不要返回这条路线。
只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。`;
}

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
          winRateBefore: { type: "number", minimum: 0, maximum: 1 },
          winRateAfter: { type: "number", minimum: 0, maximum: 1 },
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

export function responsesConnectionTestPayload(model: string): object {
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

export function chatCompletionsConnectionTestPayload(
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

export function responsesPayload(
  model: string,
  request: AnalysisRequest,
  repairErrors: string[],
  catalog: CardCatalog,
  winRateEnabled: boolean = false,
): object {
  return {
    model,
    instructions: systemPrompt(winRateEnabled),
    input: buildUserContent(request, repairErrors, catalog),
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

export function chatCompletionsPayload(
  model: string,
  request: AnalysisRequest,
  repairErrors: string[],
  catalog: CardCatalog,
  mode: StructuredOutputMode = "json_schema",
  winRateEnabled: boolean = false,
): object {
  return {
    model,
    temperature: 0.2,
    max_tokens: 2_000,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt(winRateEnabled) },
      { role: "user", content: buildUserContent(request, repairErrors, catalog, mode) },
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
  catalog: CardCatalog,
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
- 不要为了“用掉资源”而打出幸运币；只有打出后能继续使用获得的本回合法力，才允许把幸运币放进路线。
${buildLocalActionHints(request, catalog)}
${repair}${schema}\n${JSON.stringify(request)}`;
}
