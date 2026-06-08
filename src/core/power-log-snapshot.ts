import { emptyPlayerState } from "../shared/defaults.js";
import type {
  CardReference,
  GameStateSnapshot,
  PlayerSide,
} from "../shared/types.js";
import type { EntityState, ParserState } from "./power-log-model.js";
import {
  byZonePosition,
  isCardType,
  visibleEntityName,
} from "./power-log-patterns.js";

export function buildPowerLogSnapshot(
  state: ParserState,
  revisionCounter: number,
  cardCatalogVersion: string,
): GameStateSnapshot {
  const self = emptyPlayerState();
  const opponent = emptyPlayerState();

  for (const entity of state.entities.values()) {
    const side = sideForEntity(state, entity);
    if (!side) {
      continue;
    }
    const player = side === "self" ? self : opponent;
    const zone = entity.zone ?? String(entity.tags.ZONE ?? "");

    if (zone === "HAND") {
      player.handCount += 1;
      if (side === "self") {
        player.hand.push(toCardReference(entity));
      }
    } else if (zone === "PLAY" || zone === "SECRET") {
      if (isHero(entity)) {
        player.hero = {
          entityId: entity.entityId,
          cardId: entity.cardId,
          name: entity.name,
          health: numberTag(entity, "HEALTH"),
          damage: numberTag(entity, "DAMAGE"),
          armor: numberTag(entity, "ARMOR"),
          attack: numberTag(entity, "ATK"),
          exhausted: booleanTag(entity, "EXHAUSTED"),
        };
      } else if (isHeroPower(entity)) {
        player.heroPower = toCardReference(entity);
      } else if (isWeapon(entity)) {
        const durability = numberTag(entity, "DURABILITY");
        const damage = numberTag(entity, "DAMAGE") ?? 0;
        player.weapon = {
          entityId: entity.entityId,
          cardId: entity.cardId,
          name: entity.name,
          attack: numberTag(entity, "ATK"),
          durability:
            durability === undefined ? undefined : Math.max(0, durability - damage),
        };
      } else if (isSecret(entity) || zone === "SECRET") {
        player.secretCount += 1;
      } else if (isBoardEntity(entity)) {
        player.board.push(toCardReference(entity));
      }
    } else if (zone === "DECK") {
      player.deckCount = (player.deckCount ?? 0) + 1;
    }

    if (isPlayer(entity)) {
      const resources = numberTag(entity, "RESOURCES") ?? player.maxMana;
      const resourcesUsed = numberTag(entity, "RESOURCES_USED") ?? 0;
      const temporaryResources = numberTag(entity, "TEMP_RESOURCES") ?? 0;
      const overloadLocked = numberTag(entity, "OVERLOAD_LOCKED") ?? 0;
      player.maxMana = resources;
      player.mana = Math.max(
        0,
        resources + temporaryResources - resourcesUsed - overloadLocked,
      );
      player.overloadLocked = overloadLocked;
      player.deckCount = numberTag(entity, "DECK_COUNT") ?? player.deckCount;
      player.fatigue = numberTag(entity, "FATIGUE") ?? player.fatigue;
    }
  }

  self.hand.sort(byZonePosition);
  self.board.sort(byZonePosition);
  opponent.board.sort(byZonePosition);

  return Object.freeze({
    revision: String(revisionCounter),
    gameId: state.gameId,
    gameMode: state.gameMode,
    gameType: state.gameType,
    turn: state.turn,
    activePlayer:
      state.activePlayerId !== undefined
        ? (sideForPlayerId(state, state.activePlayerId) ?? "unknown")
        : state.activePlayer,
    self,
    opponent,
    visibleHistory: [...state.visibleHistory].slice(-50),
    uncertainties: [...state.uncertainties],
    cardCatalogVersion,
    gameBuild: state.gameBuild,
    animationPending: state.animationDepth > 0,
    capturedAt: new Date().toISOString(),
  });
}

function toCardReference(entity: EntityState): CardReference {
  return {
    entityId: entity.entityId,
    cardId: entity.cardId,
    name: visibleEntityName(entity.name),
    cardType:
      entity.tags.CARDTYPE === undefined
        ? undefined
        : String(entity.tags.CARDTYPE),
    zonePosition: entity.zonePosition,
    attack: numberTag(entity, "ATK"),
    health: numberTag(entity, "HEALTH"),
    damage: numberTag(entity, "DAMAGE"),
    exhausted: booleanTag(entity, "EXHAUSTED"),
    taunt: booleanTag(entity, "TAUNT"),
    divineShield: booleanTag(entity, "DIVINE_SHIELD"),
    poisonous: booleanTag(entity, "POISONOUS"),
    lifesteal: booleanTag(entity, "LIFESTEAL"),
    dormant: booleanTag(entity, "DORMANT"),
    cost: numberTag(entity, "COST"),
    tags: { ...entity.tags },
  };
}

function isPlayer(entity: EntityState): boolean {
  return isCardType(entity, "PLAYER", 2);
}

function isHero(entity: EntityState): boolean {
  return isCardType(entity, "HERO", 3);
}

function isWeapon(entity: EntityState): boolean {
  return isCardType(entity, "WEAPON", 7);
}

function isHeroPower(entity: EntityState): boolean {
  return isCardType(entity, "HERO_POWER", 10);
}

function isBoardEntity(entity: EntityState): boolean {
  return isCardType(entity, "MINION", 4) || isCardType(entity, "LOCATION", 39);
}

function isSecret(entity: EntityState): boolean {
  return Number(entity.tags.SECRET) === 1 || entity.tags.SECRET === true;
}

function numberTag(entity: EntityState, tag: string): number | undefined {
  const value = entity.tags[tag];
  return value === undefined ? undefined : Number(value);
}

function booleanTag(entity: EntityState, tag: string): boolean | undefined {
  const value = entity.tags[tag];
  return value === undefined ? undefined : Number(value) === 1 || value === true;
}

function sideForEntity(
  state: ParserState,
  entity: EntityState,
): PlayerSide | undefined {
  return (
    sideForController(state, entity.controller) ??
    sideForPlayerId(state, playerIdForEntity(state, entity.entityId))
  );
}

function sideForController(
  state: ParserState,
  controller?: number,
): PlayerSide | undefined {
  if (controller === undefined) {
    return undefined;
  }
  return sideForPlayerId(state, controller);
}

function sideForPlayerId(
  state: ParserState,
  playerId: number,
): PlayerSide | undefined {
  if (playerId === state.selfPlayerId) {
    return "self";
  }
  if (playerId === state.opponentPlayerId) {
    return "opponent";
  }
  return undefined;
}

function playerIdForEntity(state: ParserState, entityId: number): number {
  const entity = state.entities.get(entityId);
  const playerIdTag = entity?.tags.PLAYER_ID;
  return (
    state.playerIdByEntityId.get(entityId) ??
    (playerIdTag === undefined ? undefined : Number(playerIdTag)) ??
    entityId
  );
}
