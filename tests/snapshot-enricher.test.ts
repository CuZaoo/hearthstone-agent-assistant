import { describe, expect, it } from "vitest";
import { CardCatalog } from "../src/core/card-catalog";
import { enrichSnapshotWithCatalog } from "../src/core/snapshot-enricher";
import { emptyPlayerState } from "../src/shared/defaults";
import type { GameStateSnapshot } from "../src/shared/types";

describe("enrichSnapshotWithCatalog", () => {
  it("adds catalog names, text, type, and cost to visible entities", () => {
    const catalog = new CardCatalog({
      version: "test",
      generatedAt: "2026-01-01T00:00:00.000Z",
      locale: "zhCN",
      gameBuild: 243002,
      entries: [
        {
          cardId: "CARD_001",
          name: "测试法术",
          text: "造成1点伤害。",
          cost: 1,
          cardType: "SPELL",
          collectible: true,
          standard: true,
        },
        {
          cardId: "MINION_001",
          name: "测试随从",
          text: "嘲讽",
          cost: 2,
          cardType: "MINION",
          collectible: true,
          standard: true,
        },
        {
          cardId: "HERO_001",
          name: "测试英雄",
          text: "",
          cost: 0,
          cardType: "HERO",
          collectible: false,
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
        hero: { entityId: 1, cardId: "HERO_001" },
        hand: [{ entityId: 10, cardId: "CARD_001", tags: {} }],
        handCount: 1,
        board: [{ entityId: 11, cardId: "MINION_001", attack: 2, tags: {} }],
      },
      opponent: {
        ...emptyPlayerState(),
        hero: { entityId: 2 },
        board: [{ entityId: 20, cardId: "UNKNOWN_001", name: "原名", tags: {} }],
      },
      visibleHistory: [],
      uncertainties: [],
      cardCatalogVersion: "test",
      gameBuild: 243002,
      animationPending: false,
      capturedAt: "2026-01-01T00:00:00.000Z",
    };

    const enriched = enrichSnapshotWithCatalog(snapshot, catalog);

    expect(enriched.self.hero.name).toBe("测试英雄");
    expect(enriched.self.hand[0]).toMatchObject({
      name: "测试法术",
      text: "造成1点伤害。",
      cardType: "SPELL",
      cost: 1,
    });
    expect(enriched.self.board[0]).toMatchObject({
      name: "测试随从",
      text: "嘲讽",
      cardType: "MINION",
      cost: 2,
      attack: 2,
    });
    expect(enriched.opponent.board[0]?.name).toBe("原名");
  });
});
