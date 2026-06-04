import type {
  AnalysisResult,
  GameStateSnapshot,
  RecommendedAction,
  ValidationReport,
} from "../shared/types.js";
import type { CardCatalog } from "./card-catalog.js";

export function validateSnapshotForAnalysis(
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!catalog.isReady()) {
    errors.push("卡牌快照尚未配置，无法生成可靠建议。");
  }
  if (snapshot.gameMode !== "standard") {
    errors.push("首版仅支持标准构筑模式。");
  }
  if (snapshot.activePlayer !== "self") {
    errors.push("当前不是己方回合。");
  }
  if (snapshot.animationPending) {
    errors.push("检测到对局动画或日志事件仍在进行，请稍后重试。");
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
    errors.push(`卡牌快照缺少 ${unknownCards.length} 张可见卡牌。`);
  }
  if (visibleCards.some((card) => !card.cardId)) {
    warnings.push("部分可见实体缺少卡牌 ID，建议可能不完整。");
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
    if (candidate.confidence < 0 || candidate.confidence > 1) {
      errors.push(`路线 ${candidate.rank} 的置信度必须在 0 到 1 之间。`);
    }
    for (const action of candidate.actions) {
      validateAction(action, snapshot, catalog, errors, warnings);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateAction(
  action: RecommendedAction,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
  errors: string[],
  warnings: string[],
): void {
  const ownEntities = [
    ...snapshot.self.hand,
    ...snapshot.self.board,
    ...(snapshot.self.hero.entityId ? [{ entityId: snapshot.self.hero.entityId }] : []),
  ];
  const allTargets = [
    ...snapshot.self.board,
    ...snapshot.opponent.board,
    ...(snapshot.self.hero.entityId ? [{ entityId: snapshot.self.hero.entityId }] : []),
    ...(snapshot.opponent.hero.entityId
      ? [{ entityId: snapshot.opponent.hero.entityId }]
      : []),
  ];

  if (
    action.sourceEntityId !== undefined &&
    !ownEntities.some((entity) => entity.entityId === action.sourceEntityId)
  ) {
    errors.push(`动作引用了不可用的己方实体 ${action.sourceEntityId}。`);
  }
  if (
    action.targetEntityId !== undefined &&
    !allTargets.some((entity) => entity.entityId === action.targetEntityId)
  ) {
    errors.push(`动作引用了不可见的目标实体 ${action.targetEntityId}。`);
  }
  if (action.sourceCardId && !catalog.has(action.sourceCardId)) {
    errors.push(`动作引用了卡牌快照中不存在的卡牌 ${action.sourceCardId}。`);
  }

  if (action.type === "play-card" && action.sourceEntityId !== undefined) {
    const card = snapshot.self.hand.find(
      (entry) => entry.entityId === action.sourceEntityId,
    );
    if (!card) {
      errors.push(`出牌动作的实体 ${action.sourceEntityId} 不在己方手牌中。`);
    } else if ((card.cost ?? 0) > snapshot.self.mana) {
      warnings.push(`实体 ${action.sourceEntityId} 的基础费用高于当前法力。`);
    }
  }
}

