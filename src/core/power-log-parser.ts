import { createHash } from "node:crypto";
import { emptyPlayerState } from "../shared/defaults.js";
import type {
  CardReference,
  GameEvent,
  GameStateSnapshot,
  PlayerSide,
} from "../shared/types.js";
import type { EntityState, ParserState } from "./power-log-model.js";
import { newParserState } from "./power-log-model.js";
import {
  BLOCK_END,
  BLOCK_START,
  CREATE_GAME,
  DEBUG_BUILD_NUMBER,
  DEBUG_FORMAT_TYPE,
  DEBUG_GAME_TYPE,
  DEBUG_PLAYER,
  ENTITY_DESCRIPTION,
  ENTITY_TAG_LINE,
  FULL_LINE,
  GAME_ENTITY_LINE,
  PLAYER_LINE,
  SHOW_LINE,
  TAG_LINE,
  TIMESTAMP,
  UNKNOWN_PLAYER_NAME,
  byZonePosition,
  isCardType,
  isRelevantPowerLine,
  isVisibleEventTag,
  parseTagValue,
  shouldInferSelfFromOptions,
  shouldReadEntityDescriptionMetadata,
  shouldReplaceName,
  visibleEntityName,
} from "./power-log-patterns.js";

export class PowerLogParser {
  private state: ParserState = this.newState();
  private revisionCounter = 0;
  private lastCreateGameTimestamp?: string;

  reset(): void {
    this.state = this.newState();
    this.revisionCounter = 0;
    this.lastCreateGameTimestamp = undefined;
  }

  consume(content: string): void {
    for (const line of content.split(/\r?\n/)) {
      if (line.trim()) {
        this.consumeLine(line);
      }
    }
  }

  consumeLine(line: string): void {
    const metadataChanged = shouldReadEntityDescriptionMetadata(line)
      ? this.consumeEntityDescriptions(line)
      : false;
    if (!isRelevantPowerLine(line)) {
      if (metadataChanged) {
        this.bumpRevision();
      }
      return;
    }

    if (CREATE_GAME.test(line)) {
      const timestamp = line.match(TIMESTAMP)?.groups?.time;
      if (!timestamp || timestamp !== this.lastCreateGameTimestamp) {
        this.startNewGame();
        this.lastCreateGameTimestamp = timestamp;
      }
    }

    if (BLOCK_START.test(line)) {
      this.state.currentEntityId = undefined;
      this.state.animationDepth += 1;
      this.bumpRevision();
      return;
    }
    if (BLOCK_END.test(line)) {
      this.state.currentEntityId = undefined;
      this.state.animationDepth = Math.max(0, this.state.animationDepth - 1);
      this.bumpRevision();
      return;
    }

    const entityTag = line.match(ENTITY_TAG_LINE);
    const eventKey =
      entityTag && this.state.currentEntityId !== undefined
        ? `${this.state.currentEntityId}|${line}`
        : line;
    const eventId = createHash("sha1").update(eventKey).digest("hex");
    if (this.state.processedEventIds.has(eventId)) {
      return;
    }
    this.rememberEventId(eventId);

    const buildNumber = line.match(DEBUG_BUILD_NUMBER)?.groups?.build;
    if (buildNumber) {
      this.state.gameBuild = Number(buildNumber);
      this.bumpRevision();
      return;
    }

    const gameType = line.match(DEBUG_GAME_TYPE)?.groups?.gameType;
    if (gameType) {
      this.state.gameType = gameType;
      this.updateGameMode();
      this.bumpRevision();
      return;
    }

    const formatType = line.match(DEBUG_FORMAT_TYPE)?.groups?.formatType;
    if (formatType) {
      this.state.formatType = formatType;
      this.updateGameMode();
      this.bumpRevision();
      return;
    }

    const debugPlayer = line.match(DEBUG_PLAYER);
    const debugPlayerName = debugPlayer?.groups?.name;
    const debugPlayerId = debugPlayer?.groups?.playerId;
    if (debugPlayerName && debugPlayerId) {
      this.state.playerIdByName.set(
        debugPlayerName.trim(),
        Number(debugPlayerId),
      );
      if (
        !UNKNOWN_PLAYER_NAME.test(debugPlayerName.trim()) &&
        !this.hasUnambiguousLocalAccountPlayer()
      ) {
        this.setSelfPlayerId(Number(debugPlayerId));
      }
      this.bumpRevision();
      return;
    }

    const full = line.match(FULL_LINE);
    if (full?.groups) {
      const entityId = full.groups.id
        ? Number(full.groups.id)
        : this.entityIdFromGroups(full.groups);
      if (entityId !== undefined) {
        const entity = this.getEntity(entityId);
        entity.cardId = full.groups.cardId || entity.cardId;
        this.state.currentEntityId = entityId;
        this.bumpRevision();
      }
      return;
    }

    const show = line.match(SHOW_LINE);
    if (show?.groups) {
      const entityId = this.entityIdFromGroups(show.groups);
      if (entityId !== undefined) {
        const entity = this.getEntity(entityId);
        entity.cardId = show.groups.cardId;
        this.state.currentEntityId = entityId;
        this.inferSidesFromVisibleHand(entity);
        this.bumpRevision();
      }
      return;
    }

    const tag = line.match(TAG_LINE);
    const tagName = tag?.groups?.tag;
    const tagValue = tag?.groups?.value;
    if (tag?.groups && tagName && tagValue) {
      const entityId = this.entityIdFromGroups(tag.groups);
      if (entityId === undefined) {
        return;
      }
      this.applyTag(entityId, tagName, tagValue, line);
      this.state.currentEntityId = undefined;
      return;
    }

    const player = line.match(PLAYER_LINE);
    if (player?.groups) {
      const entityId = Number(player.groups.entityId);
      this.registerPlayer(
        entityId,
        Number(player.groups.playerId),
      );
      if (player.groups.hi !== "0" || player.groups.lo !== "0") {
        this.state.localAccountPlayerIds.add(Number(player.groups.playerId));
      }
      this.inferSelfFromAccountIds();
      this.state.currentEntityId = entityId;
      this.bumpRevision();
      return;
    }

    const gameEntity = line.match(GAME_ENTITY_LINE);
    if (gameEntity?.groups) {
      this.state.currentEntityId = Number(gameEntity.groups.entityId);
      this.state.gameEntityId = this.state.currentEntityId;
      this.getEntity(this.state.currentEntityId);
      this.bumpRevision();
      return;
    }

    const entityTagName = entityTag?.groups?.tag;
    const entityTagValue = entityTag?.groups?.value;
    if (
      entityTagName &&
      entityTagValue &&
      this.state.currentEntityId !== undefined
    ) {
      this.applyTag(
        this.state.currentEntityId,
        entityTagName,
        entityTagValue,
        line,
      );
    }
  }

  snapshot(cardCatalogVersion: string): GameStateSnapshot {
    const self = emptyPlayerState();
    const opponent = emptyPlayerState();

    for (const entity of this.state.entities.values()) {
      const side = this.sideForEntity(entity);
      if (!side) {
        continue;
      }
      const player = side === "self" ? self : opponent;
      const zone = entity.zone ?? String(entity.tags.ZONE ?? "");

      if (zone === "HAND") {
        player.handCount += 1;
        if (side === "self") {
          player.hand.push(this.toCardReference(entity));
        }
      } else if (zone === "PLAY" || zone === "SECRET") {
        if (this.isHero(entity)) {
          const health = this.numberTag(entity, "HEALTH");
          const damage = this.numberTag(entity, "DAMAGE") ?? 0;
          player.hero = {
            entityId: entity.entityId,
            cardId: entity.cardId,
            name: entity.name,
            health: health === undefined ? undefined : Math.max(0, health - damage),
            armor: this.numberTag(entity, "ARMOR"),
            attack: this.numberTag(entity, "ATK"),
            exhausted: this.booleanTag(entity, "EXHAUSTED"),
          };
        } else if (this.isHeroPower(entity)) {
          player.heroPower = this.toCardReference(entity);
        } else if (this.isWeapon(entity)) {
          const durability = this.numberTag(entity, "DURABILITY");
          const damage = this.numberTag(entity, "DAMAGE") ?? 0;
          player.weapon = {
            entityId: entity.entityId,
            cardId: entity.cardId,
            name: entity.name,
            attack: this.numberTag(entity, "ATK"),
            durability:
              durability === undefined ? undefined : Math.max(0, durability - damage),
          };
        } else if (this.isSecret(entity) || zone === "SECRET") {
          player.secretCount += 1;
        } else if (this.isBoardEntity(entity)) {
          player.board.push(this.toCardReference(entity));
        }
      } else if (zone === "DECK") {
        player.deckCount = (player.deckCount ?? 0) + 1;
      }

      if (this.isPlayer(entity)) {
        const resources = this.numberTag(entity, "RESOURCES") ?? player.maxMana;
        const resourcesUsed = this.numberTag(entity, "RESOURCES_USED") ?? 0;
        const temporaryResources = this.numberTag(entity, "TEMP_RESOURCES") ?? 0;
        const overloadLocked = this.numberTag(entity, "OVERLOAD_LOCKED") ?? 0;
        player.maxMana = resources;
        player.mana = Math.max(
          0,
          resources + temporaryResources - resourcesUsed - overloadLocked,
        );
        player.overloadLocked =
          overloadLocked;
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
      gameType: this.state.gameType,
      turn: this.state.turn,
      activePlayer:
        this.state.activePlayerId !== undefined
          ? (this.sideForPlayerId(this.state.activePlayerId) ?? "unknown")
          : this.state.activePlayer,
      self,
      opponent,
      visibleHistory: [...this.state.visibleHistory].slice(-50),
      uncertainties: [...this.state.uncertainties],
      cardCatalogVersion,
      gameBuild: this.state.gameBuild,
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
    } else if (tag === "PLAYSTATE") {
      this.registerPlayer(entityId, this.playerIdForEntity(entityId));
    } else if (tag === "PLAYER_ID") {
      this.registerPlayer(entityId, Number(value));
    } else if (tag === "CURRENT_PLAYER") {
      if (entityId === this.state.gameEntityId) {
        this.state.activePlayerId = Number(value);
      } else if (Number(value) === 1) {
        this.state.activePlayerId = this.playerIdForEntity(entityId);
      }
      if (this.state.activePlayerId !== undefined) {
        this.state.activePlayer =
          this.sideForPlayerId(this.state.activePlayerId) ?? "unknown";
      }
    } else if (tag === "FORMAT_TYPE") {
      this.state.formatType = String(value);
      this.updateGameMode();
    }

    this.inferSidesFromVisibleHand(entity);

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

  private registerPlayer(entityId: number, playerId: number): void {
    this.state.playerIdByEntityId.set(entityId, playerId);
    this.state.playerEntityIdByPlayerId.set(playerId, entityId);
    this.state.playerIds.add(playerId);
    if (this.state.selfPlayerId !== undefined) {
      this.state.opponentPlayerId = [...this.state.playerIds].find(
        (id) => id !== this.state.selfPlayerId,
      );
    }
  }

  private inferSidesFromVisibleHand(entity: EntityState): void {
    if (
      this.state.selfPlayerId === undefined &&
      entity.zone === "HAND" &&
      entity.cardId &&
      entity.controller !== undefined
    ) {
      this.setSelfPlayerId(entity.controller);
    }
  }

  private setSelfPlayerId(playerId: number): void {
    this.state.selfPlayerId = playerId;
    this.state.opponentPlayerId = [...this.state.playerIds].find(
      (id) => id !== playerId,
    );
    if (this.state.activePlayerId !== undefined) {
      this.state.activePlayer =
        this.sideForPlayerId(this.state.activePlayerId) ?? "unknown";
    }
  }

  private inferSelfFromAccountIds(): void {
    if (this.state.playerIds.size < 2 || !this.hasUnambiguousLocalAccountPlayer()) {
      return;
    }
    const [playerId] = this.state.localAccountPlayerIds;
    if (playerId !== undefined) {
      this.setSelfPlayerId(playerId);
    }
  }

  private hasUnambiguousLocalAccountPlayer(): boolean {
    return this.state.localAccountPlayerIds.size === 1;
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

  private sideForEntity(entity: EntityState): PlayerSide | undefined {
    return (
      this.sideForController(entity.controller) ??
      this.sideForPlayerId(this.playerIdForEntity(entity.entityId))
    );
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

  private playerIdForEntity(entityId: number): number {
    return (
      this.state.playerIdByEntityId.get(entityId) ??
      this.numberTag(this.getEntity(entityId), "PLAYER_ID") ??
      entityId
    );
  }

  private entityIdFromGroups(groups: Record<string, string>): number | undefined {
    if (groups.simple) {
      return Number(groups.simple);
    }
    if (groups.named === "GameEntity") {
      return this.state.gameEntityId;
    }
    if (groups.named) {
      const playerId = this.state.playerIdByName.get(groups.named);
      return playerId === undefined
        ? undefined
        : this.state.playerEntityIdByPlayerId.get(playerId);
    }
    const source = groups.entity;
    if (!source) {
      return undefined;
    }
    const idMatch = source.match(/id=(\d+)/);
    if (idMatch?.[1]) {
      const id = Number(idMatch[1]);
      const entity = this.getEntity(id);
      this.mergeEntityDescription(entity, source);
      return id;
    }
    return undefined;
  }

  private consumeEntityDescriptions(line: string): boolean {
    if (!line.includes("entityName=")) {
      return false;
    }

    let changed = false;
    for (const match of line.matchAll(ENTITY_DESCRIPTION)) {
      const id = Number(match.groups?.id);
      if (!Number.isFinite(id)) {
        continue;
      }
      const entity = this.getEntity(id);
      changed = this.mergeEntityDescription(entity, match[0]) || changed;
      if (
        shouldInferSelfFromOptions(line) &&
        entity.controller !== undefined &&
        entity.cardId &&
        !this.hasUnambiguousLocalAccountPlayer()
      ) {
        this.setSelfPlayerId(entity.controller);
        changed = true;
      }
    }
    return changed;
  }

  private mergeEntityDescription(entity: EntityState, source: string): boolean {
    const previous = { ...entity };
    const name = source.match(/entityName=(.+?) id=\d+/)?.[1]?.trim();
    const cardId = source.match(/cardId=([A-Za-z0-9_]*)/)?.[1];
    const zone = source.match(/zone=([A-Z]+)/)?.[1];
    const zonePosition = source.match(/zonePos=(\d+)/)?.[1];
    const controller = source.match(/player=(\d+)/)?.[1];

    if (name && shouldReplaceName(entity.name, name)) {
      entity.name = name;
    }
    if (cardId) {
      entity.cardId = cardId;
    }
    if (zone && entity.zone === undefined) {
      entity.zone = zone;
    }
    if (zonePosition !== undefined && entity.zonePosition === undefined) {
      entity.zonePosition = Number(zonePosition);
    }
    if (controller !== undefined && entity.controller === undefined) {
      entity.controller = Number(controller);
    }

    return (
      previous.name !== entity.name ||
      previous.cardId !== entity.cardId ||
      previous.zone !== entity.zone ||
      previous.zonePosition !== entity.zonePosition ||
      previous.controller !== entity.controller
    );
  }

  private toCardReference(entity: EntityState): CardReference {
    return {
      entityId: entity.entityId,
      cardId: entity.cardId,
      name: visibleEntityName(entity.name),
      cardType:
        entity.tags.CARDTYPE === undefined
          ? undefined
          : String(entity.tags.CARDTYPE),
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
    return isCardType(entity, "PLAYER", 2);
  }

  private isHero(entity: EntityState): boolean {
    return isCardType(entity, "HERO", 3);
  }

  private isWeapon(entity: EntityState): boolean {
    return isCardType(entity, "WEAPON", 7);
  }

  private isHeroPower(entity: EntityState): boolean {
    return isCardType(entity, "HERO_POWER", 10);
  }

  private isBoardEntity(entity: EntityState): boolean {
    return isCardType(entity, "MINION", 4) || isCardType(entity, "LOCATION", 39);
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
    return newParserState();
  }

  private startNewGame(): void {
    const processedEventIds = this.state.processedEventIds;
    const processedEventIdQueue = this.state.processedEventIdQueue;
    this.state = this.newState();
    this.state.processedEventIds = processedEventIds;
    this.state.processedEventIdQueue = processedEventIdQueue;
    this.bumpRevision();
  }

  private rememberEventId(eventId: string): void {
    this.state.processedEventIds.add(eventId);
    this.state.processedEventIdQueue.push(eventId);
    while (this.state.processedEventIdQueue.length > 100_000) {
      const oldest = this.state.processedEventIdQueue.shift();
      if (oldest) {
        this.state.processedEventIds.delete(oldest);
      }
    }
  }

  private updateGameMode(): void {
    if (
      this.state.gameType &&
      !["GT_RANKED", "GT_CASUAL", "GT_FRIENDLY", "GT_VS_AI"].includes(
        this.state.gameType,
      )
    ) {
      this.state.gameMode = "unsupported";
      return;
    }
    if (
      this.state.formatType?.includes("STANDARD") ||
      Number(this.state.formatType) === 2
    ) {
      this.state.gameMode = "standard";
      return;
    }
    if (this.state.formatType && this.state.formatType !== "FT_UNKNOWN") {
      this.state.gameMode = "unsupported";
    }
  }
}
