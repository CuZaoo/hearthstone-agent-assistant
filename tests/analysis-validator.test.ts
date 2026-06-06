import { describe, expect, it } from "vitest";
import {
  validateAnalysisResult,
  validateSnapshotForAnalysis,
} from "../src/core/analysis-validator";
import { CardCatalog } from "../src/core/card-catalog";
import { emptyPlayerState } from "../src/shared/defaults";
import type { AnalysisResult, GameStateSnapshot } from "../src/shared/types";

const catalog = new CardCatalog({
  version: "test",
  generatedAt: "2026-01-01T00:00:00.000Z",
  locale: "zhCN",
  gameBuild: 123456,
  entries: [
    {
      cardId: "CARD_001",
      name: "测试卡",
      text: "",
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
      text: "",
      cost: 3,
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
    hero: { entityId: 1, cardId: "HERO_001", health: 30 },
    mana: 1,
    maxMana: 1,
    hand: [{ entityId: 10, cardId: "CARD_001", cost: 1, tags: {} }],
  },
  opponent: {
    ...emptyPlayerState(),
    hero: { entityId: 2, cardId: "HERO_002", health: 30 },
  },
  visibleHistory: [],
  uncertainties: [],
  cardCatalogVersion: "test",
  gameBuild: 123456,
  animationPending: false,
  capturedAt: "2026-01-01T00:00:00.000Z",
};

describe("validateAnalysisResult", () => {
  it("accepts actions that only reference visible entities", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "出牌",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 10,
              sourceCardId: "CARD_001",
              description: "打出测试卡",
            },
          ],
          rationale: "使用法力",
          risks: [],
          confidence: 0.8,
        },
      ],
    };

    expect(validateAnalysisResult(result, snapshot, catalog).ok).toBe(true);
  });

  it("rejects invisible source entities", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "非法动作",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 999,
              description: "引用不存在的实体",
            },
          ],
          rationale: "",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    expect(validateAnalysisResult(result, snapshot, catalog).ok).toBe(false);
  });

  it("rejects playing the same hand entity twice", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "重复出牌",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 10,
              sourceCardId: "CARD_001",
              description: "第一次打出",
            },
            {
              type: "play-card",
              sourceEntityId: 10,
              sourceCardId: "CARD_001",
              description: "第二次打出",
            },
          ],
          rationale: "",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    expect(validateAnalysisResult(result, snapshot, catalog).ok).toBe(false);
  });

  it("rejects attack actions sourced from hand cards", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "非法攻击",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "attack",
              sourceEntityId: 10,
              targetEntityId: 2,
              targetSide: "opponent",
              description: "用手牌攻击",
            },
          ],
          rationale: "",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    expect(validateAnalysisResult(result, snapshot, catalog).ok).toBe(false);
  });

  it("rejects playable actions without the matching source card id", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "缺少卡牌 ID",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 10,
              description: "打出测试卡",
            },
          ],
          rationale: "",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    const report = validateAnalysisResult(result, snapshot, catalog);

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("必须携带卡牌 ID CARD_001");
  });

  it("allows hero power source card ids that are absent from the card catalog", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "英雄技能",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "hero-power",
              sourceEntityId: 30,
              sourceCardId: "HERO_POWER_NOT_IN_CATALOG",
              description: "使用英雄技能",
            },
          ],
          rationale: "",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    const report = validateAnalysisResult(
      result,
      {
        ...snapshot,
        self: {
          ...snapshot.self,
          mana: 2,
          heroPower: {
            entityId: 30,
            cardId: "HERO_POWER_NOT_IN_CATALOG",
            cost: 2,
            tags: {},
          },
        },
      },
      catalog,
    );

    expect(report.ok).toBe(true);
  });

  it("rejects playing the coin without spending the temporary mana", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "空打幸运币",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 11,
              sourceCardId: "BAR_COIN1",
              description: "打出幸运币",
            },
            {
              type: "end-turn",
              description: "结束回合",
            },
          ],
          rationale: "错误地浪费资源",
          risks: [],
          confidence: 0.5,
        },
      ],
    };

    const report = validateAnalysisResult(
      result,
      {
        ...snapshot,
        self: {
          ...snapshot.self,
          hand: [
            ...snapshot.self.hand,
            { entityId: 11, cardId: "BAR_COIN1", cost: 0, tags: {} },
          ],
          handCount: 2,
        },
      },
      catalog,
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("没有使用获得的法力");
  });

  it("allows spending coin mana on a card one mana above the current total", () => {
    const result: AnalysisResult = {
      snapshotRevision: "1",
      summary: "幸运币接三费牌",
      warnings: [],
      candidates: [
        {
          rank: 1,
          actions: [
            {
              type: "play-card",
              sourceEntityId: 11,
              sourceCardId: "BAR_COIN1",
              description: "打出幸运币",
            },
            {
              type: "play-card",
              sourceEntityId: 12,
              sourceCardId: "CARD_003",
              description: "打出三费测试卡",
            },
          ],
          rationale: "使用临时法力完成出牌",
          risks: [],
          confidence: 0.8,
        },
      ],
    };

    const report = validateAnalysisResult(
      result,
      {
        ...snapshot,
        self: {
          ...snapshot.self,
          mana: 2,
          maxMana: 2,
          hand: [
            { entityId: 11, cardId: "BAR_COIN1", cost: 0, tags: {} },
            { entityId: 12, cardId: "CARD_003", cost: 3, tags: {} },
          ],
          handCount: 2,
        },
      },
      catalog,
    );

    expect(report.ok).toBe(true);
  });
});

describe("validateSnapshotForAnalysis", () => {
  it("rejects a card catalog from another game build", () => {
    const staleCatalog = new CardCatalog({
      version: "stale",
      generatedAt: "2026-01-01T00:00:00.000Z",
      locale: "zhCN",
      gameBuild: 999999,
      entries: catalog.list(),
    });

    const report = validateSnapshotForAnalysis(snapshot, staleCatalog);

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("build");
  });

  it("reports missing visible card ids and names", () => {
    const report = validateSnapshotForAnalysis(
      {
        ...snapshot,
        self: {
          ...snapshot.self,
          hand: [
            ...snapshot.self.hand,
            {
              entityId: 11,
              cardId: "MISSING_CARD",
              name: "缺失卡",
              tags: {},
            },
          ],
        },
      },
      catalog,
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("缺失卡(MISSING_CARD)");
  });
});
