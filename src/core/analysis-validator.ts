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
  const buildMatch = catalog.matchesGameBuild(snapshot.gameBuild);
  if (buildMatch === false) {
    errors.push(
      `卡牌快照 build ${catalog.gameBuild} 与游戏 build ${snapshot.gameBuild} 不一致。`,
    );
  } else if (buildMatch === undefined) {
    warnings.push("无法确认卡牌快照与当前游戏 build 是否一致。");
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
    warnings.push("部分可见实体在 Power.log 中未公开卡牌 ID，建议可能不完整。");
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
    if (candidate.confidence < 0 || candidate.confidence > 1) {
      errors.push(`路线 ${candidate.rank} 的置信度必须在 0 到 1 之间。`);
    }
    let remainingMana = snapshot.self.mana;
    let boardCount = snapshot.self.board.length;
    const usedSourceIds = new Set<number>();
    for (const [actionIndex, action] of candidate.actions.entries()) {
      validateAction(action, snapshot, errors, warnings);
      if (
        action.sourceEntityId !== undefined &&
        action.type !== "attack" &&
        usedSourceIds.has(action.sourceEntityId)
      ) {
        errors.push(
          `路线 ${candidate.rank} 重复使用了实体 ${action.sourceEntityId}。`,
        );
      }
      if (action.sourceEntityId !== undefined && action.type !== "attack") {
        usedSourceIds.add(action.sourceEntityId);
      }
      if (action.type === "play-card" && action.sourceEntityId !== undefined) {
        const card = snapshot.self.hand.find(
          (entry) => entry.entityId === action.sourceEntityId,
        );
        const catalogEntry = catalog.get(card?.cardId);
        const cost = card?.cost ?? catalogEntry?.cost ?? 0;
        remainingMana -= cost;
        if (remainingMana < 0) {
          errors.push(`路线 ${candidate.rank} 的基础费用超过当前法力。`);
        }
        if (
          catalogEntry?.cardType === "MINION" ||
          catalogEntry?.cardType === "LOCATION"
        ) {
          boardCount += 1;
          if (boardCount > 7) {
            errors.push(`路线 ${candidate.rank} 会超过随从区容量。`);
          }
        }
      }
      if (action.type === "hero-power") {
        remainingMana -= snapshot.self.heroPower?.cost ?? 2;
        if (remainingMana < 0) {
          errors.push(`路线 ${candidate.rank} 的基础费用超过当前法力。`);
        }
      }
      if (action.type === "trade") {
        remainingMana -= 1;
        if (remainingMana < 0) {
          errors.push(`路线 ${candidate.rank} 的基础费用超过当前法力。`);
        }
      }
      if (
        action.type === "end-turn" &&
        actionIndex !== candidate.actions.length - 1
      ) {
        errors.push(`路线 ${candidate.rank} 在结束回合后仍包含动作。`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateAction(
  action: RecommendedAction,
  snapshot: GameStateSnapshot,
  errors: string[],
  warnings: string[],
): void {
  const ownEntities = [
    ...snapshot.self.hand,
    ...snapshot.self.board,
    ...(snapshot.self.heroPower ? [snapshot.self.heroPower] : []),
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
  const selfTargetIds = new Set([
    ...snapshot.self.board.map((entity) => entity.entityId),
    ...(snapshot.self.hero.entityId ? [snapshot.self.hero.entityId] : []),
  ]);
  const opponentTargetIds = new Set([
    ...snapshot.opponent.board.map((entity) => entity.entityId),
    ...(snapshot.opponent.hero.entityId ? [snapshot.opponent.hero.entityId] : []),
  ]);

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
  if (
    action.targetEntityId !== undefined &&
    action.targetSide === "self" &&
    !selfTargetIds.has(action.targetEntityId)
  ) {
    errors.push(`目标实体 ${action.targetEntityId} 不属于己方。`);
  }
  if (
    action.targetEntityId !== undefined &&
    action.targetSide === "opponent" &&
    !opponentTargetIds.has(action.targetEntityId)
  ) {
    errors.push(`目标实体 ${action.targetEntityId} 不属于对手。`);
  }
  const source =
    action.sourceEntityId === undefined
      ? undefined
      : ownEntities.find((entity) => entity.entityId === action.sourceEntityId);
  if (action.sourceCardId && !source) {
    errors.push(`动作携带了卡牌 ${action.sourceCardId}，但没有可用的来源实体。`);
  }
  if (source && "cardId" in source && source.cardId) {
    if (!action.sourceCardId && action.type !== "hero-power") {
      errors.push(`动作的实体 ${action.sourceEntityId} 必须携带卡牌 ID ${source.cardId}。`);
    } else if (action.sourceCardId && source.cardId !== action.sourceCardId) {
      errors.push(
        `动作的实体 ${action.sourceEntityId} 与卡牌 ${action.sourceCardId} 不匹配。`,
      );
    }
  }

  if (action.type === "play-card" && action.sourceEntityId === undefined) {
    errors.push("出牌动作必须引用己方手牌实体。");
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

  if (action.type === "attack") {
    const attacker = snapshot.self.board.find(
      (entry) => entry.entityId === action.sourceEntityId,
    );
    const heroAttack =
      snapshot.self.hero.entityId === action.sourceEntityId
        ? (snapshot.self.hero.attack ?? snapshot.self.weapon?.attack ?? 0)
        : 0;
    if (!attacker && heroAttack <= 0) {
      errors.push("攻击动作必须引用可攻击的己方随从或英雄。");
    }
    if (attacker?.exhausted || attacker?.dormant || (attacker?.attack ?? 0) <= 0) {
      errors.push(`实体 ${attacker?.entityId ?? action.sourceEntityId} 当前无法攻击。`);
    }
    if (snapshot.self.hero.entityId === action.sourceEntityId && snapshot.self.hero.exhausted) {
      errors.push("己方英雄当前无法攻击。");
    }
    if (action.targetSide !== "opponent") {
      errors.push("攻击动作的目标必须属于对手。");
    }
    if (action.targetEntityId === undefined) {
      errors.push("攻击动作必须指定目标实体。");
    }
    const taunts = snapshot.opponent.board.filter((entry) => entry.taunt);
    if (
      taunts.length > 0 &&
      !taunts.some((entry) => entry.entityId === action.targetEntityId)
    ) {
      errors.push("对手存在嘲讽随从，攻击目标必须是嘲讽随从。");
    }
  }

  if (action.type === "hero-power") {
    if (
      action.sourceEntityId !== undefined &&
      action.sourceEntityId !== snapshot.self.heroPower?.entityId
    ) {
      errors.push("英雄技能动作引用了错误的实体。");
    }
    if (snapshot.self.heroPower?.exhausted) {
      errors.push("英雄技能本回合已经使用。");
    }
  }

  if (action.type === "trade" && action.sourceEntityId !== undefined) {
    const card = snapshot.self.hand.find(
      (entry) => entry.entityId === action.sourceEntityId,
    );
    if (!card || !(card.tags.TRADEABLE === 1 || card.tags.TRADEABLE === true)) {
      errors.push("交易动作必须引用具有可交易属性的己方手牌。");
    }
  }
  if (action.type === "trade" && action.sourceEntityId === undefined) {
    errors.push("交易动作必须引用己方手牌实体。");
  }

  if (action.type === "end-turn") {
    if (
      action.sourceEntityId !== undefined ||
      action.targetEntityId !== undefined ||
      action.sourceCardId !== undefined
    ) {
      errors.push("结束回合动作不应引用实体或卡牌。");
    }
  }
}
