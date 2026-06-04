import { describe, expect, it } from "vitest";
import { CardCatalog } from "../src/core/card-catalog";
import { VisualValidator } from "../src/main/visual-validator";
import { emptyPlayerState } from "../src/shared/defaults";
import type { GameStateSnapshot } from "../src/shared/types";

describe("VisualValidator", () => {
  it("accepts a matching visible card feature", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1920, 1080) as never,
      snapshot,
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(true);
    expect(report.matchedEntityIds).toEqual([10]);
  });

  it("rejects a mismatching visible card feature", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1920, 1080) as never,
      snapshot,
      catalogWithHash("ffffffffffffffff"),
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("不一致");
  });

  it("rejects unsupported aspect ratios", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1600, 1200) as never,
      snapshot,
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("16:9");
  });
});

class FakeImage {
  constructor(
    private readonly width: number,
    private readonly height: number,
  ) {}

  getSize() {
    return { width: this.width, height: this.height };
  }

  crop() {
    return this;
  }

  resize() {
    return new FakeImage(9, 8);
  }

  toBitmap() {
    return Buffer.alloc(this.width * this.height * 4);
  }
}

function catalogWithHash(imageHash: string): CardCatalog {
  return new CardCatalog({
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
        imageHash,
      },
    ],
  });
}

const snapshot: GameStateSnapshot = {
  revision: "1",
  gameMode: "standard",
  gameType: "GT_RANKED",
  turn: 1,
  activePlayer: "self",
  self: {
    ...emptyPlayerState(),
    hero: { entityId: 1 },
    hand: [{ entityId: 10, cardId: "CARD_001", tags: {} }],
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

