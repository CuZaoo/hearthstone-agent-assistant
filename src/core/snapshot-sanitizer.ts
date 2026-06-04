import type {
  CardReference,
  GameStateSnapshot,
  PlayerState,
} from "../shared/types.js";
import type { CardCatalog } from "./card-catalog.js";

export function sanitizeSnapshotForAgent(
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): GameStateSnapshot {
  return {
    ...snapshot,
    self: sanitizePlayer(snapshot.self, catalog),
    opponent: sanitizePlayer(snapshot.opponent, catalog),
    visibleHistory: snapshot.visibleHistory.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      side: event.side,
      entityId: event.entityId,
      cardId: event.cardId,
      text: event.text,
    })),
  };
}

function sanitizePlayer(player: PlayerState, catalog: CardCatalog): PlayerState {
  return {
    hero: { ...player.hero },
    weapon: player.weapon ? { ...player.weapon } : undefined,
    mana: player.mana,
    maxMana: player.maxMana,
    overloadLocked: player.overloadLocked,
    hand: player.hand.map((card) => sanitizeCard(card, catalog)),
    board: player.board.map((card) => sanitizeCard(card, catalog)),
    deckCount: player.deckCount,
    secretCount: player.secretCount,
    fatigue: player.fatigue,
  };
}

function sanitizeCard(card: CardReference, catalog: CardCatalog): CardReference {
  const catalogEntry = catalog.get(card.cardId);
  return {
    entityId: card.entityId,
    cardId: card.cardId,
    name: catalogEntry?.name ?? card.name,
    zonePosition: card.zonePosition,
    attack: card.attack,
    health: card.health,
    damage: card.damage,
    exhausted: card.exhausted,
    taunt: card.taunt,
    divineShield: card.divineShield,
    poisonous: card.poisonous,
    lifesteal: card.lifesteal,
    dormant: card.dormant,
    cost: card.cost ?? catalogEntry?.cost,
    tags: {},
  };
}

