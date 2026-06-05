import type {
  CardReference,
  GameStateSnapshot,
  HeroState,
  PlayerState,
  WeaponState,
} from "../shared/types.js";
import type { CardCatalog } from "./card-catalog.js";

export function enrichSnapshotWithCatalog(
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
): GameStateSnapshot {
  return {
    ...snapshot,
    self: enrichPlayer(snapshot.self, catalog),
    opponent: enrichPlayer(snapshot.opponent, catalog),
  };
}

function enrichPlayer(player: PlayerState, catalog: CardCatalog): PlayerState {
  return {
    ...player,
    hero: enrichHero(player.hero, catalog),
    heroPower: player.heroPower
      ? enrichCard(player.heroPower, catalog)
      : undefined,
    weapon: player.weapon ? enrichWeapon(player.weapon, catalog) : undefined,
    hand: player.hand.map((card) => enrichCard(card, catalog)),
    board: player.board.map((card) => enrichCard(card, catalog)),
  };
}

function enrichHero(hero: HeroState, catalog: CardCatalog): HeroState {
  const entry = catalog.get(hero.cardId);
  return {
    ...hero,
    name: entry?.name ?? hero.name,
    text: entry?.text ?? hero.text,
  };
}

function enrichWeapon(weapon: WeaponState, catalog: CardCatalog): WeaponState {
  const entry = catalog.get(weapon.cardId);
  return {
    ...weapon,
    name: entry?.name ?? weapon.name,
    text: entry?.text ?? weapon.text,
  };
}

function enrichCard(card: CardReference, catalog: CardCatalog): CardReference {
  const entry = catalog.get(card.cardId);
  return {
    ...card,
    name: entry?.name ?? card.name,
    text: entry?.text ?? card.text,
    cardType: entry?.cardType ?? card.cardType,
    cost: card.cost ?? entry?.cost,
  };
}
