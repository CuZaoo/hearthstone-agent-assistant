import type { AnalysisResult } from "../shared/types.js";

export function extractResponsesText(payload: unknown): string {
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

export function extractChatCompletionsText(payload: unknown): string {
  const data = payload as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Chat Completions API 未返回可解析的文本结果。");
  }
  return text;
}

export function parseAnalysisResult(text: string): AnalysisResult {
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

export function parseConnectionTestResult(text: string): {
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
