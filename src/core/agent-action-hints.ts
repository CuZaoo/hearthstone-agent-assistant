import type { AnalysisRequest, CardReference } from "../shared/types.js";
import type { CardCatalog } from "./card-catalog.js";

export function buildLocalActionHints(
  request: AnalysisRequest,
  catalog: CardCatalog,
): string {
  const snapshot = request.snapshot;
  const hand = snapshot.self.hand;
  const currentMana = snapshot.self.mana;
  const coinCards = hand.filter((card) => isTemporaryManaCard(card, catalog));
  const directlyPlayable = hand.filter(
    (card) => !isTemporaryManaCard(card, catalog) && cardCost(card, catalog) <= currentMana,
  );
  const coinPlayable =
    coinCards.length > 0
      ? hand.filter((card) => {
          const cost = cardCost(card, catalog);
          return (
            !isTemporaryManaCard(card, catalog) &&
            cost > currentMana &&
            cost <= currentMana + coinCards.length
          );
        })
      : [];
  const attackers = snapshot.self.board.filter(
    (card) =>
      !card.exhausted &&
      !card.dormant &&
      (card.attack ?? 0) > 0,
  );
  const taunts = snapshot.opponent.board.filter((card) => card.taunt);
  const heroCanAttack =
    !snapshot.self.hero.exhausted &&
    (snapshot.self.hero.attack ?? snapshot.self.weapon?.attack ?? 0) > 0;

  return [
    "本地合法动作提示：",
    `- 当前法力：${snapshot.self.mana}/${snapshot.self.maxMana}；己方场面：${snapshot.self.board.length}/7；对手场面：${snapshot.opponent.board.length}/7。`,
    `- 当前可直接打出的手牌：${formatCardList(directlyPlayable, catalog)}。`,
    `- 使用临时法力后才可打出的手牌：${formatCardList(coinPlayable, catalog)}。`,
    `- 临时法力牌：${formatCardList(coinCards, catalog)}；只有后续会立刻消费新增法力时才考虑。`,
    `- 可攻击来源：${formatCardList(attackers, catalog)}${heroCanAttack ? "；己方英雄可攻击" : ""}。`,
    `- 对手嘲讽：${formatCardList(taunts, catalog)}。若存在嘲讽，攻击目标必须优先为嘲讽。`,
    `- 本地可执行动作清单(JSON)：${JSON.stringify(buildExecutableActionList(request, catalog))}`,
    "- 生成路线时优先组合上面的 JSON 动作清单；除 end-turn 外，不要发明清单中没有 sourceEntityId 的动作。",
    "- 如果没有有价值动作，可以推荐直接结束回合；如果推荐保留资源，理由必须说明为什么优于当前可用动作。",
  ].join("\n");
}

function buildExecutableActionList(
  request: AnalysisRequest,
  catalog: CardCatalog,
): object {
  const snapshot = request.snapshot;
  const currentMana = snapshot.self.mana;
  const coinCards = snapshot.self.hand.filter((card) =>
    isTemporaryManaCard(card, catalog),
  );
  const attackTargets = legalAttackTargets(snapshot);
  return {
    playCards: snapshot.self.hand
      .filter((card) => !isTemporaryManaCard(card, catalog))
      .map((card) => {
        const cost = cardCost(card, catalog);
        return {
          type: "play-card",
          sourceEntityId: card.entityId,
          sourceCardId: card.cardId ?? null,
          cardName: cardName(card, catalog),
          cost,
          currentlyPlayable: cost <= currentMana,
          requiresTemporaryMana: cost > currentMana && cost <= currentMana + coinCards.length,
          targetPolicy: "follow-card-text",
        };
      })
      .filter((action) => action.currentlyPlayable || action.requiresTemporaryMana),
    temporaryManaCards: coinCards.map((card) => ({
      type: "play-card",
      sourceEntityId: card.entityId,
      sourceCardId: card.cardId ?? null,
      cardName: cardName(card, catalog),
      grantsTemporaryMana: 1,
      onlyUseIfLaterActionSpendsMana: true,
    })),
    attacks: legalAttackers(snapshot).map((attacker) => ({
      type: "attack",
      sourceEntityId: attacker.entityId,
      sourceCardId: attacker.cardId ?? null,
      cardName: cardName(attacker, catalog),
      attack: attacker.attack ?? 0,
      legalTargets: attackTargets,
    })),
    heroAttack:
      !snapshot.self.hero.exhausted &&
      (snapshot.self.hero.attack ?? snapshot.self.weapon?.attack ?? 0) > 0
        ? {
            type: "attack",
            sourceEntityId: snapshot.self.hero.entityId ?? null,
            sourceCardId: snapshot.self.hero.cardId ?? null,
            attack: snapshot.self.hero.attack ?? snapshot.self.weapon?.attack ?? 0,
            legalTargets: attackTargets,
          }
        : null,
    heroPower:
      snapshot.self.heroPower &&
      !snapshot.self.heroPower.exhausted &&
      cardCost(snapshot.self.heroPower, catalog) <= currentMana
        ? {
            type: "hero-power",
            sourceEntityId: snapshot.self.heroPower.entityId,
            sourceCardId: snapshot.self.heroPower.cardId ?? null,
            cardName: cardName(snapshot.self.heroPower, catalog),
            cost: cardCost(snapshot.self.heroPower, catalog),
            targetPolicy: "follow-card-text",
          }
        : null,
    trades: snapshot.self.hand
      .filter((card) => card.tags.TRADEABLE === 1 || card.tags.TRADEABLE === true)
      .filter(() => currentMana >= 1)
      .map((card) => ({
        type: "trade",
        sourceEntityId: card.entityId,
        sourceCardId: card.cardId ?? null,
        cardName: cardName(card, catalog),
        cost: 1,
      })),
    endTurn: {
      type: "end-turn",
      sourceEntityId: null,
      sourceCardId: null,
      targetEntityId: null,
      targetSide: null,
    },
  };
}

function legalAttackers(snapshot: AnalysisRequest["snapshot"]): CardReference[] {
  return snapshot.self.board.filter(
    (card) => !card.exhausted && !card.dormant && (card.attack ?? 0) > 0,
  );
}

function legalAttackTargets(snapshot: AnalysisRequest["snapshot"]) {
  const taunts = snapshot.opponent.board.filter((card) => card.taunt);
  const boardTargets = (taunts.length > 0 ? taunts : snapshot.opponent.board).map(
    (card) => ({
      targetEntityId: card.entityId,
      targetSide: "opponent" as const,
      cardName: cardName(card, undefined),
      taunt: Boolean(card.taunt),
    }),
  );
  if (taunts.length > 0) {
    return boardTargets;
  }
  return [
    ...boardTargets,
    ...(snapshot.opponent.hero.entityId
      ? [
          {
            targetEntityId: snapshot.opponent.hero.entityId,
            targetSide: "opponent" as const,
            cardName: snapshot.opponent.hero.name ?? snapshot.opponent.hero.cardId ?? "对手英雄",
            hero: true,
          },
        ]
      : []),
  ];
}

function formatCardList(cards: CardReference[], catalog: CardCatalog): string {
  if (cards.length === 0) {
    return "无";
  }
  return cards
    .slice(0, 12)
    .map((card) => {
      const cost = cardCost(card, catalog);
      return `#${card.entityId} ${cardName(card, catalog)}(${card.cardId ?? "无ID"}, ${cost}费)`;
    })
    .join("；");
}

function cardName(card: CardReference, catalog?: CardCatalog): string {
  const catalogEntry = catalog?.get(card.cardId);
  return catalogEntry?.name ?? card.name ?? card.cardId ?? "未知";
}

function cardCost(card: CardReference, catalog: CardCatalog): number {
  return card.cost ?? catalog.get(card.cardId)?.cost ?? 0;
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
