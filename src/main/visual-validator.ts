import type { NativeImage } from "electron";
import type {
  GameStateSnapshot,
  VisualValidationReport,
} from "../shared/types.js";
import type { CardCatalog } from "../core/card-catalog.js";

interface Slot {
  entityId: number;
  cardId?: string;
  kind: "hand" | "board";
  x: number;
  y: number;
  width: number;
  height: number;
}

export class VisualValidator {
  validate(
    screenshot: NativeImage,
    snapshot: GameStateSnapshot,
    catalog: CardCatalog,
  ): VisualValidationReport {
    const size = screenshot.getSize();
    const resolution = `${size.width}x${size.height}`;
    const errors: string[] = [];
    const warnings: string[] = [];
    const matchedEntityIds: number[] = [];

    if (!isSupportedResolution(size.width, size.height)) {
      errors.push(
        `不支持的截图分辨率 ${resolution}，首版仅支持 1920×1080、2560×1440 或对应最大化窗口内容尺寸。`,
      );
      return { ok: false, errors, warnings, resolution, matchedEntityIds };
    }
    if (!catalog.isReady()) {
      errors.push("卡牌视觉特征快照尚未配置。");
      return { ok: false, errors, warnings, resolution, matchedEntityIds };
    }

    const slots = buildSlots(snapshot, size.width, size.height);
    const mismatchedEntityIds: number[] = [];
    for (const slot of slots) {
      const expectedHash = catalog.get(slot.cardId)?.imageHash;
      if (!expectedHash) {
        errors.push(`实体 ${slot.entityId} 缺少视觉特征，无法校验。`);
        continue;
      }
      const crop = screenshot.crop(artRegion(slot));
      const actualHash = differenceHash(crop);
      if (hammingDistance(expectedHash, actualHash) <= 12) {
        matchedEntityIds.push(slot.entityId);
      } else {
        mismatchedEntityIds.push(slot.entityId);
      }
    }

    if (mismatchedEntityIds.length > 0) {
      if (matchedEntityIds.length === 0) {
        warnings.push(
          `视觉校验坐标尚未适配当前窗口，${mismatchedEntityIds.length} 个实体未能匹配；本次仅使用 Power.log 快照分析。`,
        );
      } else {
        for (const entityId of mismatchedEntityIds) {
          errors.push(`实体 ${entityId} 的截图与日志卡牌不一致。`);
        }
      }
    }
    if (
      slots.length > 0 &&
      matchedEntityIds.length === 0 &&
      mismatchedEntityIds.length === 0 &&
      errors.length === 0
    ) {
      warnings.push("没有可用的视觉特征，本次仅使用 Power.log 快照分析。");
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings,
      resolution,
      matchedEntityIds,
    };
  }
}

function artRegion(slot: Slot) {
  const horizontalInset = slot.kind === "hand" ? 0.18 : 0.15;
  const topInset = slot.kind === "hand" ? 0.12 : 0.08;
  const widthRatio = slot.kind === "hand" ? 0.64 : 0.7;
  const heightRatio = slot.kind === "hand" ? 0.38 : 0.58;
  return {
    x: Math.max(0, Math.round(slot.x + slot.width * horizontalInset)),
    y: Math.max(0, Math.round(slot.y + slot.height * topInset)),
    width: Math.max(1, Math.round(slot.width * widthRatio)),
    height: Math.max(1, Math.round(slot.height * heightRatio)),
  };
}

function isSupportedResolution(width: number, height: number): boolean {
  return (
    (width === 1920 && height === 1080) ||
    (width === 2560 && height === 1440) ||
    (width === 1920 && height >= 1030 && height < 1080) ||
    (width === 2560 && height >= 1350 && height < 1440)
  );
}

function buildSlots(
  snapshot: GameStateSnapshot,
  width: number,
  height: number,
): Slot[] {
  const slots: Slot[] = [];
  const hand = snapshot.self.hand;
  const handWidth = width * 0.07;
  const handGap = Math.min(width * 0.055, (width * 0.5) / Math.max(1, hand.length));
  const handStart = width / 2 - ((hand.length - 1) * handGap) / 2;
  hand.forEach((card, index) => {
    slots.push({
      entityId: card.entityId,
      cardId: card.cardId,
      kind: "hand",
      x: handStart + index * handGap - handWidth / 2,
      y: height * 0.81,
      width: handWidth,
      height: height * 0.12,
    });
  });

  addBoardSlots(slots, snapshot.self.board, width, height, 0.59);
  addBoardSlots(slots, snapshot.opponent.board, width, height, 0.35);
  return slots;
}

function addBoardSlots(
  slots: Slot[],
  board: GameStateSnapshot["self"]["board"],
  width: number,
  height: number,
  yRatio: number,
): void {
  const cardWidth = width * 0.06;
  const gap = width * 0.075;
  const start = width / 2 - ((board.length - 1) * gap) / 2;
  board.forEach((card, index) => {
    slots.push({
      entityId: card.entityId,
      cardId: card.cardId,
      kind: "board",
      x: start + index * gap - cardWidth / 2,
      y: height * yRatio,
      width: cardWidth,
      height: height * 0.1,
    });
  });
}

function differenceHash(image: NativeImage): string {
  const bitmap = image.resize({ width: 9, height: 8 }).toBitmap();
  const bits: number[] = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const left = pixelLuma(bitmap, 9, x, y);
      const right = pixelLuma(bitmap, 9, x + 1, y);
      bits.push(left > right ? 1 : 0);
    }
  }
  let hash = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4).reduce((value, bit) => value * 2 + bit, 0);
    hash += nibble.toString(16);
  }
  return hash;
}

function pixelLuma(
  bitmap: Buffer,
  rowWidth: number,
  x: number,
  y: number,
): number {
  const offset = (y * rowWidth + x) * 4;
  const blue = bitmap[offset] ?? 0;
  const green = bitmap[offset + 1] ?? 0;
  const red = bitmap[offset + 2] ?? 0;
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function hammingDistance(left: string, right: string): number {
  if (left.length !== right.length) {
    return Number.POSITIVE_INFINITY;
  }
  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    const value = Number.parseInt(left[i] ?? "0", 16) ^ Number.parseInt(right[i] ?? "0", 16);
    distance += value.toString(2).replaceAll("0", "").length;
  }
  return distance;
}
