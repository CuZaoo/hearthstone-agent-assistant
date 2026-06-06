import type {
  CandidateLine,
  CardReference,
  GameStateSnapshot,
  RecommendedAction,
  ValidationReport,
} from "../shared/types.js";
import type { CardCatalog } from "./card-catalog.js";

export function validateCandidateLine(
  candidate: CandidateLine,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): ValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (candidate.confidence < 0 || candidate.confidence > 1) {
    errors.push(`路线 ${candidate.rank} 的置信度必须在 0 到 1 之间。`);
  }
  let remainingMana = snapshot.self.mana;
  let boardCount = snapshot.self.board.length;
  const usedSourceIds = new Set<number>();
  const unspentTemporaryManaSources: number[] = [];
  for (const [actionIndex, action] of candidate.actions.entries()) {
    validateAction(action, snapshot, catalog, errors, warnings);
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
      if (card && isTemporaryManaCard(card, catalog)) {
        remainingMana += 1;
        unspentTemporaryManaSources.push(card.entityId);
      } else if (cost > 0 && unspentTemporaryManaSources.length > 0) {
        unspentTemporaryManaSources.pop();
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
      if (unspentTemporaryManaSources.length > 0) {
        unspentTemporaryManaSources.pop();
      }
    }
    if (action.type === "trade") {
      remainingMana -= 1;
      if (remainingMana < 0) {
        errors.push(`路线 ${candidate.rank} 的基础费用超过当前法力。`);
      }
      if (unspentTemporaryManaSources.length > 0) {
        unspentTemporaryManaSources.pop();
      }
    }
    if (
      action.type === "end-turn" &&
      actionIndex !== candidate.actions.length - 1
    ) {
      errors.push(`路线 ${candidate.rank} 在结束回合后仍包含动作。`);
    }
  }
  if (unspentTemporaryManaSources.length > 0) {
    errors.push(
      `路线 ${candidate.rank} 打出临时法力牌后没有使用获得的法力。`,
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}

function isTemporaryManaCard(card: CardReference, catalog: CardCatalog): boolean {
  const catalogEntry = catalog.get(card.cardId);
  const name = catalogEntry?.name ?? card.name ?? "";
  const text = catalogEntry?.text ?? card.text ?? "";
  const cardId = card.cardId ?? "";
  return (
    (catalogEntry?.cost ?? card.cost ?? 0) === 0 &&
    (cardId.includes("COIN") ||
      name === "幸运币" ||
      /本回合.*法力|法力.*本回合/.test(text))
  );
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
  validateActionDescription(action, source, catalog, errors);

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
    } else {
      validatePlayCardVisibleEffect(card, snapshot, catalog, errors);
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

function validatePlayCardVisibleEffect(
  card: CardReference,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
  errors: string[],
): void {
  const catalogEntry = catalog.get(card.cardId);
  const name = catalogEntry?.name ?? card.name ?? card.cardId ?? `实体 ${card.entityId}`;
  const text = catalogEntry?.text ?? card.text ?? "";
  if (/随机敌方随从/.test(text) && snapshot.opponent.board.length === 0) {
    errors.push(`${name} 需要可见敌方随从，但对手场面为空。`);
  }
  if (
    /攻击力大于或等于5|攻击力大于等于5|攻击力.*>=\s*5/.test(text) &&
    [...snapshot.self.board, ...snapshot.opponent.board].every(
      (entity) => (entity.attack ?? 0) < 5,
    )
  ) {
    errors.push(`${name} 当前没有可影响的 5 攻以上随从。`);
  }
}

function validateActionDescription(
  action: RecommendedAction,
  source: { entityId: number; cardId?: string } | undefined,
  catalog: CardCatalog,
  errors: string[],
): void {
  if (action.type !== "attack" && /攻击(?!力)|打脸|踢脸/.test(action.description)) {
    errors.push("非攻击动作的描述不应写成攻击。");
  }
  const sourceType = catalog.get(source?.cardId)?.cardType;
  if (
    action.type === "play-card" &&
    sourceType === "SPELL" &&
    /战吼/.test(action.description)
  ) {
    errors.push("法术出牌动作的描述不应写成战吼。");
  }
}
