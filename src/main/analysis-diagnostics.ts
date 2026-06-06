import type { GameStateSnapshot } from "../shared/types.js";

export function snapshotSummary(snapshot: GameStateSnapshot) {
  return {
    revision: snapshot.revision,
    gameMode: snapshot.gameMode,
    gameType: snapshot.gameType,
    turn: snapshot.turn,
    activePlayer: snapshot.activePlayer,
    animationPending: snapshot.animationPending,
    self: {
      hero: snapshot.self.hero.name ?? snapshot.self.hero.cardId,
      health: snapshot.self.hero.health,
      mana: `${snapshot.self.mana}/${snapshot.self.maxMana}`,
      hand: snapshot.self.hand.map((card) => ({
        entityId: card.entityId,
        cardId: card.cardId,
        name: card.name,
        cost: card.cost,
      })),
      board: snapshot.self.board.map(cardSummary),
    },
    opponent: {
      hero: snapshot.opponent.hero.name ?? snapshot.opponent.hero.cardId,
      health: snapshot.opponent.hero.health,
      handCount: snapshot.opponent.handCount,
      board: snapshot.opponent.board.map(cardSummary),
    },
    uncertainties: snapshot.uncertainties,
  };
}

function cardSummary(card: GameStateSnapshot["self"]["board"][number]) {
  return {
    entityId: card.entityId,
    cardId: card.cardId,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    damage: card.damage,
    exhausted: card.exhausted,
  };
}
