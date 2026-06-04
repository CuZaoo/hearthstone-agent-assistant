import { describe, expect, it } from "vitest";
import { CardCatalog } from "../src/core/card-catalog";
import { sanitizeSnapshotForAgent } from "../src/core/snapshot-sanitizer";
import { emptyPlayerState } from "../src/shared/defaults";
import type { GameStateSnapshot } from "../src/shared/types";

describe("sanitizeSnapshotForAgent", () => {
  it("adds card text and removes raw entity tags", () => {
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
      visibleHistory: [
        {
          id: "event-1",
          type: "ZONE",
          text: "玩家名#1234",
        },
      ],
      uncertainties: [],
      cardCatalogVersion: "test",
      gameBuild: 123456,
      animationPending: false,
      capturedAt: "2026-01-01T00:00:00.000Z",
    };

    const sanitized = sanitizeSnapshotForAgent(snapshot, catalog);

    expect(sanitized.self.hand[0]?.text).toBe("测试文本");
    expect(sanitized.self.hand[0]?.tags).toEqual({});
    expect(JSON.stringify(sanitized)).not.toContain("不得发送");
    expect(JSON.stringify(sanitized)).not.toContain("玩家名");
  });
});
