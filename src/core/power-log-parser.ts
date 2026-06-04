import { createHash } from "node:crypto";
import { emptyPlayerState } from "../shared/defaults.js";
import type {
  ActivePlayer,
  CardReference,
  GameEvent,
  GameMode,
  GameStateSnapshot,
  PlayerSide,
} from "../shared/types.js";

type EntityTags = Record<string, number | string | boolean>;

interface EntityState {
  entityId: number;
  cardId?: string;
  name?: string;
  controller?: number;
  zone?: string;
  zonePosition?: number;
  tags: EntityTags;
}

interface ParserState {
  entities: Map<number, EntityState>;
  selfPlayerId?: number;
  opponentPlayerId?: number;
  turn: number;
  activePlayer: ActivePlayer;
  gameMode: GameMode;
  animationDepth: number;
  visibleHistory: GameEvent[];
  uncertainties: Set<string>;
  processedEventIds: Set<string>;
}

const TAG_LINE =
  /TAG_CHANGE Entity=(?:\[(?<entity>[^\]]+)\]|(?<simple>\d+)) tag=(?<tag>[A-Z0-9_]+) value=(?<value>[^\s]+)/;
const SHOW_LINE =
  /SHOW_ENTITY - Updating Entity=(?:\[(?<entity>[^\]]+)\]|(?<simple>\d+)) CardID=(?<cardId>[A-Z0-9_]+)/;
const FULL_LINE =
  /FULL_ENTITY - Creating ID=(?<id>\d+) CardID=(?<cardId>[A-Z0-9_]*)/;
const BLOCK_START = /BLOCK_START BlockType=(?<type>[A-Z_]+)/;
const BLOCK_END = /BLOCK_END/;
const TIMESTAMP = /^D\s+(?<time>\d{2}:\d{2}:\d{2}\.\d+)\s+/;

export class PowerLogParser {
  private state: ParserState = this.newState();
  private revisionCounter = 0;

  reset(): void {
    this.state = this.newState();
    this.revisionCounter = 0;
  }

  consume(content: string): void {
    for (const line of content.split(/\r?\n/)) {
      if (line.trim()) {
        this.consumeLine(line);
      }
    }
  }

  consumeLine(line: string): void {
    const eventId = createHash("sha1").update(line).digest("hex");
    if (this.state.processedEventIds.has(eventId)) {
      return;
    }
    this.state.processedEventIds.add(eventId);

    if (BLOCK_START.test(line)) {
      this.state.animationDepth += 1;
      this.bumpRevision();
      return;
    }
    if (BLOCK_END.test(line)) {
      this.state.animationDepth = Math.max(0, this.state.animationDepth - 1);
      this.bumpRevision();
      return;
    }

    const full = line.match(FULL_LINE);
    if (full?.groups) {
      const entityId = Number(full.groups.id);
      this.getEntity(entityId).cardId = full.groups.cardId || undefined;
      this.bumpRevision();
      return;
    }

    const show = line.match(SHOW_LINE);
    if (show?.groups) {
      const entityId = this.entityIdFromGroups(show.groups);
      if (entityId !== undefined) {
        this.getEntity(entityId).cardId = show.groups.cardId;
        this.bumpRevision();
      }
      return;
    }

    const tag = line.match(TAG_LINE);
    if (tag?.groups) {
      const entityId = this.entityIdFromGroups(tag.groups);
      if (entityId === undefined) {
        return;
      }
      this.applyTag(entityId, tag.groups.tag, tag.groups.value, line);
    }
  }

  snapshot(cardCatalogVersion: string): GameStateSnapshot {
    const self = emptyPlayerState();
    const opponent = emptyPlayerState();

    for (const entity of this.state.entities.values()) {
      const side = this.sideForController(entity.controller);
      if (!side) {
        continue;
      }
      const player = side === "self" ? self : opponent;
      const zone = entity.zone ?? String(entity.tags.ZONE ?? "");

      if (zone === "HAND" && side === "self") {
        player.hand.push(this.toCardReference(entity));
      } else if (zone === "PLAY") {
        if (this.isHero(entity)) {
          player.hero = {
            entityId: entity.entityId,
            cardId: entity.cardId,
            name: entity.name,
            health: this.numberTag(entity, "HEALTH"),
            armor: this.numberTag(entity, "ARMOR"),
            attack: this.numberTag(entity, "ATK"),
            exhausted: this.booleanTag(entity, "EXHAUSTED"),
          };
        } else if (this.isWeapon(entity)) {
          player.weapon = {
            entityId: entity.entityId,
            cardId: entity.cardId,
            name: entity.name,
            attack: this.numberTag(entity, "ATK"),
            durability: this.numberTag(entity, "DURABILITY"),
          };
        } else if (this.isSecret(entity)) {
          player.secretCount += 1;
        } else {
          player.board.push(this.toCardReference(entity));
        }
      }

      if (this.isPlayer(entity)) {
        player.mana = this.numberTag(entity, "RESOURCES") ?? player.mana;
        player.maxMana = this.numberTag(entity, "RESOURCES") ?? player.maxMana;
        player.overloadLocked =
          this.numberTag(entity, "OVERLOAD_LOCKED") ?? player.overloadLocked;
        player.deckCount = this.numberTag(entity, "DECK_COUNT") ?? player.deckCount;
        player.fatigue = this.numberTag(entity, "FATIGUE") ?? player.fatigue;
      }
    }

    self.hand.sort(byZonePosition);
    self.board.sort(byZonePosition);
    opponent.board.sort(byZonePosition);

    return Object.freeze({
      revision: String(this.revisionCounter),
      gameMode: this.state.gameMode,
      turn: this.state.turn,
      activePlayer: this.state.activePlayer,
      self,
      opponent,
      visibleHistory: [...this.state.visibleHistory].slice(-50),
      uncertainties: [...this.state.uncertainties],
      cardCatalogVersion,
      animationPending: this.state.animationDepth > 0,
      capturedAt: new Date().toISOString(),
    });
  }

  private applyTag(
    entityId: number,
    tag: string,
    rawValue: string,
    line: string,
  ): void {
    const entity = this.getEntity(entityId);
    const value = parseTagValue(rawValue);
    entity.tags[tag] = value;

    if (tag === "CONTROLLER") {
      entity.controller = Number(value);
    } else if (tag === "ZONE") {
      entity.zone = String(value);
    } else if (tag === "ZONE_POSITION") {
      entity.zonePosition = Number(value);
    } else if (tag === "TURN") {
      this.state.turn = Number(value);
    } else if (tag === "FIRST_PLAYER" && Number(value) === 1) {
      this.state.selfPlayerId ??= entityId;
    } else if (tag === "PLAYSTATE") {
      this.registerPlayer(entityId);
    } else if (tag === "CURRENT_PLAYER") {
      this.registerPlayer(entityId);
      this.state.activePlayer =
        Number(value) === 1 ? this.sideForPlayerId(entityId) : this.state.activePlayer;
    } else if (tag === "GAME_MODE") {
      this.state.gameMode = String(value).includes("STANDARD")
        ? "standard"
        : "unsupported";
    }

    if (isVisibleEventTag(tag)) {
      this.pushHistory({
        id: createHash("sha1").update(line).digest("hex"),
        timestamp: line.match(TIMESTAMP)?.groups?.time,
        type: tag,
        side: this.sideForController(entity.controller),
        entityId,
        cardId: entity.cardId,
        text: `${tag}=${String(value)}`,
      });
    }
    this.bumpRevision();
  }

  private registerPlayer(entityId: number): void {
    if (this.state.selfPlayerId === undefined) {
      this.state.selfPlayerId = entityId;
    } else if (
      this.state.opponentPlayerId === undefined &&
      this.state.selfPlayerId !== entityId
    ) {
      this.state.opponentPlayerId = entityId;
    }
  }

  private getEntity(entityId: number): EntityState {
    let entity = this.state.entities.get(entityId);
    if (!entity) {
      entity = { entityId, tags: {} };
      this.state.entities.set(entityId, entity);
    }
    return entity;
  }

  private sideForController(controller?: number): PlayerSide | undefined {
    if (controller === undefined) {
      return undefined;
    }
    return this.sideForPlayerId(controller);
  }

  private sideForPlayerId(playerId: number): PlayerSide | undefined {
    if (playerId === this.state.selfPlayerId) {
      return "self";
    }
    if (playerId === this.state.opponentPlayerId) {
      return "opponent";
    }
    return undefined;
  }

  private entityIdFromGroups(groups: Record<string, string>): number | undefined {
    if (groups.simple) {
      return Number(groups.simple);
    }
    const source = groups.entity;
    if (!source) {
      return undefined;
    }
    const idMatch = source.match(/id=(\d+)/);
    if (idMatch?.[1]) {
      const id = Number(idMatch[1]);
      const entity = this.getEntity(id);
      entity.name ??= source.match(/entityName=([^\]]+?)(?:\s+id=|$)/)?.[1];
      entity.cardId ??= source.match(/cardId=([A-Z0-9_]+)/)?.[1];
      entity.controller ??= Number(
        source.match(/player=(\d+)/)?.[1] ?? entity.controller,
      );
      return id;
    }
    return undefined;
  }

  private toCardReference(entity: EntityState): CardReference {
    return {
      entityId: entity.entityId,
      cardId: entity.cardId,
      name: entity.name,
      zonePosition: entity.zonePosition,
      attack: this.numberTag(entity, "ATK"),
      health: this.numberTag(entity, "HEALTH"),
      damage: this.numberTag(entity, "DAMAGE"),
      exhausted: this.booleanTag(entity, "EXHAUSTED"),
      taunt: this.booleanTag(entity, "TAUNT"),
      divineShield: this.booleanTag(entity, "DIVINE_SHIELD"),
      poisonous: this.booleanTag(entity, "POISONOUS"),
      lifesteal: this.booleanTag(entity, "LIFESTEAL"),
      dormant: this.booleanTag(entity, "DORMANT"),
      cost: this.numberTag(entity, "COST"),
      tags: { ...entity.tags },
    };
  }

  private isPlayer(entity: EntityState): boolean {
    return String(entity.tags.CARDTYPE) === "PLAYER";
  }

  private isHero(entity: EntityState): boolean {
    return String(entity.tags.CARDTYPE) === "HERO";
  }

  private isWeapon(entity: EntityState): boolean {
    return String(entity.tags.CARDTYPE) === "WEAPON";
  }

  private isSecret(entity: EntityState): boolean {
    return Number(entity.tags.SECRET) === 1 || entity.tags.SECRET === true;
  }

  private numberTag(entity: EntityState, tag: string): number | undefined {
    const value = entity.tags[tag];
    return value === undefined ? undefined : Number(value);
  }

  private booleanTag(entity: EntityState, tag: string): boolean | undefined {
    const value = entity.tags[tag];
    return value === undefined ? undefined : Number(value) === 1 || value === true;
  }

  private pushHistory(event: GameEvent): void {
    this.state.visibleHistory.push(event);
    if (this.state.visibleHistory.length > 100) {
      this.state.visibleHistory.shift();
    }
  }

  private bumpRevision(): void {
    this.revisionCounter += 1;
  }

  private newState(): ParserState {
    return {
      entities: new Map(),
      turn: 0,
      activePlayer: "unknown",
      gameMode: "unknown",
      animationDepth: 0,
      visibleHistory: [],
      uncertainties: new Set(),
      processedEventIds: new Set(),
    };
  }
}

function parseTagValue(value: string): number | string | boolean {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === "true" || value === "false") {
    return value === "true";
  }
  return value;
}

function isVisibleEventTag(tag: string): boolean {
  return [
    "ZONE",
    "DAMAGE",
    "ATK",
    "HEALTH",
    "ARMOR",
    "EXHAUSTED",
    "RESOURCES",
    "OVERLOAD_LOCKED",
  ].includes(tag);
}

function byZonePosition(a: CardReference, b: CardReference): number {
  return (a.zonePosition ?? 0) - (b.zonePosition ?? 0);
}

