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
    expect(body).toContain("不得推荐");
    expect(body).toContain("打出幸运币，然后结束回合");
    expect(body).toContain("本地合法动作提示");
    expect(body).not.toContain("不得发送");
    expect(body).not.toContain("secret-key");
  });

  it("includes local playable action hints for coin turns", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(responseFor(validResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    await client.analyze({
      ...request,
      snapshot: {
        ...snapshot,
        self: {
          ...snapshot.self,
          mana: 2,
          maxMana: 2,
          hand: [
            { entityId: 11, cardId: "BAR_COIN1", tags: {} },
            { entityId: 12, cardId: "CARD_003", tags: {} },
          ],
          handCount: 2,
        },
      },
    });

    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    const input = JSON.parse(body).input as string;
    expect(body).toContain("使用临时法力后才可打出的手牌");
    expect(body).toContain("#12 三费测试卡(CARD_003, 3费)");
    expect(body).toContain("临时法力牌：#11 幸运币(BAR_COIN1, 0费)");
    expect(input).toContain('"playCards"');
    expect(input).toContain('"requiresTemporaryMana":true');
    expect(input).toContain('"temporaryManaCards"');
  });

  it("includes legal attack targets in the executable action list", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(responseFor(validResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    await client.analyze({
      ...request,
      snapshot: {
        ...snapshot,
        self: {
          ...snapshot.self,
          board: [
            {
              entityId: 20,
              cardId: "MINION_002",
              name: "己方随从",
              attack: 2,
              health: 2,
              exhausted: false,
              tags: {},
            },
          ],
        },
        opponent: {
          ...snapshot.opponent,
          board: [
            {
              entityId: 30,
              cardId: "TAUNT_001",
              name: "嘲讽随从",
              attack: 1,
              health: 4,
              taunt: true,
              tags: {},
            },
            {
              entityId: 31,
              cardId: "MINION_001",
              name: "普通随从",
              attack: 3,
              health: 2,
              tags: {},
            },
          ],
        },
      },
    });

    const input = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).input as string;
    expect(input).toContain('"attacks"');
    expect(input).toContain('"sourceEntityId":20');
    expect(input).toContain('"targetEntityId":30');
    expect(input).not.toContain('"targetEntityId":31');
    expect(input).not.toContain('"targetEntityId":2');
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

  it("returns displayable suggestions when only mana validation fails", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseFor(overBudgetResult()))
      .mockResolvedValueOnce(responseFor(overBudgetResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    const result = await client.analyze({
      ...request,
      snapshot: {
        ...snapshot,
        self: {
          ...snapshot.self,
          mana: 2,
          maxMana: 2,
          hand: [{ entityId: 12, cardId: "CARD_003", tags: {} }],
          handCount: 1,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.summary).toBe("费用不足但可展示");
    expect(result.warnings.join(" ")).toContain("本地校验提示");
    expect(result.warnings.join(" ")).toContain("基础费用超过当前法力");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "基础费用超过当前法力",
    );
  });

  it("keeps valid candidates when another route fails validation", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(responseFor(mixedValidityResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    const result = await client.analyze(request);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.rank).toBe(1);
    expect(result.candidates[0]?.rationale).toBe("保留资源");
    expect(result.warnings.join(" ")).toContain("已丢弃 1 条未通过本地校验的路线");
    expect(result.warnings.join(" ")).toContain("不可用的己方实体");
  });

  it("still retries hard invalid entity errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(responseFor(invalidResult()))
      .mockResolvedValueOnce(responseFor(validResult()));
    const client = new AgentClient(settings, "secret-key", catalog);

    await client.analyze(request);

    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("accepts a full chat completions endpoint as baseUrl", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(chatResponseFor({ ok: true, message: "连接正常" }));
    const client = new AgentClient(
      {
        ...settings,
        baseUrl: "http://10.10.101.31:8001/v1/chat/completions",
        model: "qwen3.6-35b",
        transport: "chat-completions",
      },
      "secret-key",
      catalog,
    );

    await expect(client.testConnection()).resolves.toBe("连接正常");

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://10.10.101.31:8001/v1/chat/completions",
    );
  });

  it("uses json_object directly for chat completions analysis", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(chatResponseFor(validResult()));
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    const result = await client.analyze(request);

    expect(result.summary).toBe("结束回合");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("json_object");
    expect(body).toContain("不要返回格式定义");
    expect(body).not.toContain("additionalProperties");
    expect(body).toContain("max_tokens");
    expect(body).not.toContain("secret-key");
  });

  it("parses json from chat completions text with surrounding prose", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: `好的，结果如下：\n\`\`\`json\n${JSON.stringify(validResult())}\n\`\`\``,
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    await expect(client.analyze(request)).resolves.toMatchObject({
      summary: "结束回合",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries once when chat completions returns invalid json", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "{\"snapshotRevision\":\"1\"" } }],
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(chatResponseFor(validResult()));
    const client = new AgentClient(
      { ...settings, transport: "chat-completions" },
      "secret-key",
      catalog,
    );

    await expect(client.analyze(request)).resolves.toMatchObject({
      summary: "结束回合",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      "请重新返回完整 JSON",
    );
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
    {
      cardId: "BAR_COIN1",
      name: "幸运币",
      text: "在本回合中，获得一个法力水晶。",
      cost: 0,
      cardType: "SPELL",
      collectible: false,
      standard: true,
    },
    {
      cardId: "CARD_003",
      name: "三费测试卡",
      text: "测试三费文本",
      cost: 3,
      cardType: "SPELL",
      collectible: true,
      standard: true,
    },
    {
      cardId: "MINION_001",
      name: "普通随从",
      text: "",
      cost: 2,
      attack: 3,
      health: 2,
      cardType: "MINION",
      collectible: true,
      standard: true,
    },
    {
      cardId: "MINION_002",
      name: "己方随从",
      text: "",
      cost: 2,
      attack: 2,
      health: 2,
      cardType: "MINION",
      collectible: true,
      standard: true,
    },
    {
      cardId: "TAUNT_001",
      name: "嘲讽随从",
      text: "<b>嘲讽</b>",
      cost: 4,
      attack: 1,
      health: 4,
      cardType: "MINION",
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

function overBudgetResult() {
  return {
    snapshotRevision: "1",
    summary: "费用不足但可展示",
    candidates: [
      {
        rank: 1,
        actions: [
          {
            type: "play-card",
            sourceEntityId: 12,
            sourceCardId: "CARD_003",
            targetEntityId: null,
            targetSide: null,
            description: "打出三费测试卡",
          },
        ],
        rationale: "用户操作后可能已过期，但仍可展示思路",
        risks: [],
        confidence: 0.4,
      },
    ],
    warnings: [],
  };
}

function mixedValidityResult() {
  return {
    snapshotRevision: "1",
    summary: "部分路线可用",
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
        rationale: "错误路线",
        risks: [],
        confidence: 0.5,
      },
      {
        rank: 2,
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
