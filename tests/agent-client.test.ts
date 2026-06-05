import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentClient } from "../src/core/agent-client";
import { CardCatalog } from "../src/core/card-catalog";
import { emptyPlayerState } from "../src/shared/defaults";
import type { AnalysisRequest, GameStateSnapshot } from "../src/shared/types";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AgentClient", () => {
  it("sends sanitized card text and no raw entity tags", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(responseFor(validResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    await client.analyze(request);

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/v1/responses");
    expect(body).toContain("测试文本");
    expect(body).not.toContain("不得发送");
    expect(body).not.toContain("secret-key");
  });

  it("retries once with local validation errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseFor(invalidResult()))
      .mockResolvedValueOnce(responseFor(validResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    const result = await client.analyze(request);

    expect(result.summary).toBe("结束回合");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(repairBody).toContain("不可用的己方实体");
  });

  it("tests responses transport with structured output", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(responseFor({ ok: true, message: "连接正常" }));
    const client = new AgentClient(settings, "secret-key", catalog);

    await expect(client.testConnection()).resolves.toBe("连接正常");

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/v1/responses");
    expect(body).toContain("agent_connection_test");
    expect(body).not.toContain("secret-key");
  });

  it("tests chat completions transport with structured output", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        chatResponseFor({ ok: true, message: "连接正常" }),
      );
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    await expect(client.testConnection()).resolves.toBe("连接正常");

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://example.test/v1/chat/completions",
    );
    expect(body).toContain("agent_connection_test");
    expect(body).not.toContain("secret-key");
  });

  it("falls back to json_object when chat completions rejects json_schema", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("bad schema", { status: 400 }))
      .mockResolvedValueOnce(chatResponseFor(validResult()));
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    const result = await client.analyze(request);

    expect(result.summary).toBe("结束回合");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = String(fetchMock.mock.calls[0]?.[1]?.body);
    const secondBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(firstBody).toContain("json_schema");
    expect(secondBody).toContain("json_object");
    expect(secondBody).toContain("返回 JSON 必须匹配此结构");
    expect(secondBody).not.toContain("secret-key");
  });

  it("falls back to json_object for chat completions connection tests", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("bad schema", { status: 400 }))
      .mockResolvedValueOnce(chatResponseFor({ ok: true, message: "连接正常" }));
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    await expect(client.testConnection()).resolves.toBe("连接正常");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = String(fetchMock.mock.calls[1]?.[1]?.body);
    expect(secondBody).toContain("json_object");
    expect(secondBody).not.toContain("secret-key");
  });
});

const settings = {
  baseUrl: "https://example.test/v1",
  model: "test-model",
  transport: "responses" as const,
  timeoutMs: 2_000,
};

const catalog = new CardCatalog({
  version: "test",
  generatedAt: "2026-01-01T00:00:00.000Z",
  locale: "zhCN",
  gameBuild: 123456,
  entries: [
    {
      cardId: "CARD_001",
      name: "测试卡",
      text: "测试文本",
      cost: 1,
      cardType: "SPELL",
      collectible: true,
      standard: true,
    },
  ],
});

const snapshot: GameStateSnapshot = {
  revision: "1",
  gameMode: "standard",
  gameType: "GT_RANKED",
  turn: 1,
  activePlayer: "self",
  self: {
    ...emptyPlayerState(),
    hero: { entityId: 1 },
    hand: [
      {
        entityId: 10,
        cardId: "CARD_001",
        tags: { PRIVATE_VALUE: "不得发送" },
      },
    ],
    handCount: 1,
  },
  opponent: {
    ...emptyPlayerState(),
    hero: { entityId: 2 },
  },
  visibleHistory: [],
  uncertainties: [],
  cardCatalogVersion: "test",
  gameBuild: 123456,
  animationPending: false,
  capturedAt: "2026-01-01T00:00:00.000Z",
};

const request: AnalysisRequest = {
  snapshot,
  objective: "recommend-current-turn",
  maxCandidates: 3,
};

function validResult() {
  return {
    snapshotRevision: "1",
    summary: "结束回合",
    candidates: [
      {
        rank: 1,
        actions: [
          {
            type: "end-turn",
            sourceEntityId: null,
            sourceCardId: null,
            targetEntityId: null,
            targetSide: null,
            description: "结束回合",
          },
        ],
        rationale: "保留资源",
        risks: [],
        confidence: 0.5,
      },
    ],
    warnings: [],
  };
}

function invalidResult() {
  return {
    snapshotRevision: "1",
    summary: "非法出牌",
    candidates: [
      {
        rank: 1,
        actions: [
          {
            type: "play-card",
            sourceEntityId: 999,
            sourceCardId: "CARD_001",
            targetEntityId: null,
            targetSide: null,
            description: "打出不存在的牌",
          },
        ],
        rationale: "",
        risks: [],
        confidence: 0.5,
      },
    ],
    warnings: [],
  };
}

function responseFor(result: object): Response {
  return new Response(
    JSON.stringify({
      output_text: JSON.stringify(result),
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

function chatResponseFor(result: object): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(result) } }],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
