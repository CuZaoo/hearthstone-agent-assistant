import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "../src/core/analysis-validator";
import { CardCatalog } from "../src/core/card-catalog";
import { emptyPlayerState } from "../src/shared/defaults";
import type { AnalysisResult, GameStateSnapshot } from "../src/shared/types";

const catalog = new CardCatalog({
  version: "test",
  generatedAt: "2026-01-01T00:00:00.000Z",
  locale: "zhCN",
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
  ],
});

const snapshot: GameStateSnapshot = {
  revision: "1",
  gameMode: "standard",
  turn: 1,
  activePlayer: "self",
  self: {
    ...emptyPlayerState(),
    mana: 1,
    maxMana: 1,
    hand: [{ entityId: 10, cardId: "CARD_001", cost: 1, tags: {} }],
  },
  opponent: emptyPlayerState(),
  visibleHistory: [],
  uncertainties: [],
  cardCatalogVersion: "test",
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
});
