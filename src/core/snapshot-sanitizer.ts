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
    visibleHistory: snapshot.visibleHistory.slice(-12).map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      type: event.type,
      side: event.side,
      entityId: event.entityId,
      cardId: catalog.has(event.cardId) ? event.cardId : undefined,
      text: sanitizeEventText(event.type, event.text),
    })),
    capturedAt: "",
    animationPending: false,
    cardCatalogVersion: "",
  };
}

function sanitizeEventText(type: string, text: string): string {
  const match = text.match(/^(?<type>[A-Z0-9_]+)=(?<value>[A-Z0-9_-]+)$/);
  return match?.groups?.type === type ? text : type;
}

function sanitizePlayer(player: PlayerState, catalog: CardCatalog): PlayerState {
  const heroCatalogEntry = catalog.get(player.hero.cardId);
  const weaponCatalogEntry = catalog.get(player.weapon?.cardId);
  return {
    hero: {
      ...player.hero,
      name: heroCatalogEntry?.name ?? player.hero.name,
      text: heroCatalogEntry?.text,
    },
    heroPower: player.heroPower
      ? sanitizeCard(player.heroPower, catalog)
      : undefined,
    weapon: player.weapon
      ? {
          ...player.weapon,
          name: weaponCatalogEntry?.name ?? player.weapon.name,
          text: weaponCatalogEntry?.text,
        }
      : undefined,
    mana: player.mana,
    maxMana: player.maxMana,
    overloadLocked: player.overloadLocked,
    hand: player.hand.map((card) => sanitizeCard(card, catalog)),
    handCount: player.handCount,
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
    text: catalogEntry?.text ?? card.text,
    cardType: catalogEntry?.cardType ?? card.cardType,
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
