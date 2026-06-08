import type {
  AnalysisResult,
  GameStateSnapshot,
  ValidationReport,
} from "../shared/types.js";
import { validateCandidateLine } from "./analysis-action-validator.js";
import type { CardCatalog } from "./card-catalog.js";

export { validateCandidateLine } from "./analysis-action-validator.js";

export function validateSnapshotForAnalysis(
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!catalog.isReady()) {
    errors.push("卡牌快照尚未配置，无法生成可靠建议。");
  }
  const buildMatch = catalog.matchesGameBuild(snapshot.gameBuild);
  if (buildMatch === false) {
    errors.push(
      `卡牌快照 build ${catalog.gameBuild} 与游戏 build ${snapshot.gameBuild} 不一致。`,
    );
  } else if (buildMatch === undefined) {
    warnings.push("无法确认卡牌快照与当前游戏 build 是否一致。");
  }
  if (snapshot.gameMode !== "standard") {
    warnings.push("当前模式非标准构筑，部分卡牌可能存在日志不完整的风险。");
  }
  if (snapshot.activePlayer !== "self") {
    errors.push("当前不是己方回合。");
  }
  if (snapshot.animationPending) {
    errors.push("检测到对局动画或日志事件仍在进行，请稍后重试。");
  }
  if (!snapshot.self.hero.entityId || !snapshot.opponent.hero.entityId) {
    errors.push("尚未识别到双方英雄，局面信息不完整。");
  }

  const visibleCards = [
    ...snapshot.self.hand,
    ...snapshot.self.board,
    ...snapshot.opponent.board,
  ];
  const unknownCards = visibleCards.filter(
    (card) => card.cardId && !catalog.has(card.cardId),
  );
  if (unknownCards.length > 0) {
    errors.push(
      `卡牌快照缺少 ${unknownCards.length} 张可见卡牌：${unknownCards
        .map((card) => `${card.name ?? "未知"}(${card.cardId})`)
        .join("、")}。`,
    );
  }
  if (visibleCards.some((card) => !card.cardId)) {
    warnings.push("部分可见实体在日志中未公开卡牌 ID，建议可能不完整。");
  }
  const supportCards = [
    ...(snapshot.self.heroPower ? [snapshot.self.heroPower] : []),
    ...(snapshot.opponent.heroPower ? [snapshot.opponent.heroPower] : []),
    ...(snapshot.self.weapon ? [snapshot.self.weapon] : []),
    ...(snapshot.opponent.weapon ? [snapshot.opponent.weapon] : []),
  ];
  if (supportCards.some((card) => card.cardId && !catalog.has(card.cardId))) {
    warnings.push("部分英雄技能或武器缺少卡牌文本，建议可能不完整。");
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateAnalysisResult(
  result: AnalysisResult,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (result.snapshotRevision !== snapshot.revision) {
    errors.push("Agent 返回的局面版本与当前请求不一致。");
  }
  if (result.candidates.length === 0) {
    errors.push("Agent 未返回任何候选路线。");
  }

  for (const candidate of result.candidates) {
    const candidateReport = validateCandidateLine(candidate, snapshot, catalog);
    errors.push(...candidateReport.errors);
    warnings.push(...candidateReport.warnings);
  }

  return { ok: errors.length === 0, errors, warnings };
}

