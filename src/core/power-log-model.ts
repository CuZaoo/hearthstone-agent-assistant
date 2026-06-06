import type {
  ActivePlayer,
  GameEvent,
  GameMode,
} from "../shared/types.js";

export type EntityTags = Record<string, number | string | boolean>;

export interface EntityState {
  entityId: number;
  cardId?: string;
  name?: string;
  controller?: number;
  zone?: string;
  zonePosition?: number;
  tags: EntityTags;
}

export interface ParserState {
  entities: Map<number, EntityState>;
  playerIds: Set<number>;
  playerIdByEntityId: Map<number, number>;
  playerEntityIdByPlayerId: Map<number, number>;
  playerIdByName: Map<string, number>;
  localAccountPlayerIds: Set<number>;
  gameEntityId?: number;
  selfPlayerId?: number;
  opponentPlayerId?: number;
  activePlayerId?: number;
  currentEntityId?: number;
  turn: number;
  activePlayer: ActivePlayer;
  gameMode: GameMode;
  gameType?: string;
  formatType?: string;
  gameBuild?: number;
  animationDepth: number;
  visibleHistory: GameEvent[];
  uncertainties: Set<string>;
  processedEventIds: Set<string>;
  processedEventIdQueue: string[];
}

export function newParserState(): ParserState {
  return {
    entities: new Map(),
    playerIds: new Set(),
    playerIdByEntityId: new Map(),
    playerEntityIdByPlayerId: new Map(),
    playerIdByName: new Map(),
    localAccountPlayerIds: new Set(),
    turn: 0,
    activePlayer: "unknown",
    gameMode: "unknown",
    animationDepth: 0,
    visibleHistory: [],
    uncertainties: new Set(),
    processedEventIds: new Set(),
    processedEventIdQueue: [],
  };
}
