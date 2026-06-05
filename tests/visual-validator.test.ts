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

  it("downgrades all visual mismatches to a calibration warning", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1920, 1080) as never,
      snapshot,
      catalogWithHash("ffffffffffffffff"),
    );

    expect(report.ok).toBe(true);
    expect(report.warnings.join(" ")).toContain("视觉校验坐标尚未适配");
  });

  it("rejects partial visual mismatches", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1920, 1080, ["0000000000000000", "ffffffffffffffff"]) as never,
      {
        ...snapshot,
        self: {
          ...snapshot.self,
          hand: [
            { entityId: 10, cardId: "CARD_001", tags: {} },
            { entityId: 11, cardId: "CARD_001", tags: {} },
          ],
          handCount: 2,
        },
      },
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(false);
    expect(report.matchedEntityIds).toEqual([10]);
    expect(report.errors.join(" ")).toContain("实体 11");
  });

  it("rejects unsupported aspect ratios", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1600, 1200) as never,
      snapshot,
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("1920×1080");
  });

  it("accepts maximized 2560 window content height", () => {
    const report = new VisualValidator().validate(
      new FakeImage(2560, 1385) as never,
      snapshot,
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(true);
  });

  it("rejects unlisted 16:9 resolutions", () => {
    const report = new VisualValidator().validate(
      new FakeImage(1280, 720) as never,
      snapshot,
      catalogWithHash("0000000000000000"),
    );

    expect(report.ok).toBe(false);
    expect(report.errors.join(" ")).toContain("2560×1440");
  });
});

class FakeImage {
  private cropIndex = 0;

  constructor(
    private readonly width: number,
    private readonly height: number,
    private readonly cropHashes: string[] = [],
    private readonly hash?: string,
  ) {}

  getSize() {
    return { width: this.width, height: this.height };
  }

  crop() {
    const hash = this.cropHashes[this.cropIndex];
    this.cropIndex += 1;
    return new FakeImage(this.width, this.height, [], hash);
  }

  resize() {
    return new FakeImage(9, 8, [], this.hash);
  }

  toBitmap() {
    if (!this.hash || this.hash === "0000000000000000") {
      return Buffer.alloc(this.width * this.height * 4);
    }
    const bitmap = Buffer.alloc(this.width * this.height * 4);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const offset = (y * this.width + x) * 4;
        const value = 255 - x;
        bitmap[offset] = value;
        bitmap[offset + 1] = value;
        bitmap[offset + 2] = value;
        bitmap[offset + 3] = 255;
      }
    }
    return bitmap;
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
