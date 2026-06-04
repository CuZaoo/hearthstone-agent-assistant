export type PlayerSide = "self" | "opponent";
export type ActivePlayer = PlayerSide | "unknown";
export type GameMode = "standard" | "unsupported" | "unknown";
export type Transport = "responses" | "chat-completions";

export interface CardReference {
  entityId: number;
  cardId?: string;
  name?: string;
  text?: string;
  cardType?: string;
  zonePosition?: number;
  attack?: number;
  health?: number;
  damage?: number;
  exhausted?: boolean;
  taunt?: boolean;
  divineShield?: boolean;
  poisonous?: boolean;
  lifesteal?: boolean;
  dormant?: boolean;
  cost?: number;
  tags: Record<string, number | string | boolean>;
}

export interface HeroState {
  entityId?: number;
  cardId?: string;
  name?: string;
  text?: string;
  health?: number;
  armor?: number;
  attack?: number;
  exhausted?: boolean;
}

export interface WeaponState {
  entityId: number;
  cardId?: string;
  name?: string;
  text?: string;
  attack?: number;
  durability?: number;
}

export interface PlayerState {
  hero: HeroState;
  heroPower?: CardReference;
  weapon?: WeaponState;
  mana: number;
  maxMana: number;
  overloadLocked: number;
  hand: CardReference[];
  handCount: number;
  board: CardReference[];
  deckCount?: number;
  secretCount: number;
  fatigue?: number;
}

export interface GameEvent {
  id: string;
  timestamp?: string;
  type: string;
  side?: PlayerSide;
  entityId?: number;
  cardId?: string;
  text: string;
}

export interface GameStateSnapshot {
  revision: string;
  gameMode: GameMode;
  gameType?: string;
  turn: number;
  activePlayer: ActivePlayer;
  self: PlayerState;
  opponent: PlayerState;
  visibleHistory: GameEvent[];
  uncertainties: string[];
  cardCatalogVersion: string;
  gameBuild?: number;
  animationPending: boolean;
  capturedAt: string;
}

export interface AnalysisRequest {
  snapshot: GameStateSnapshot;
  objective: "recommend-current-turn";
  maxCandidates: number;
}

export type ActionType =
  | "play-card"
  | "attack"
  | "hero-power"
  | "trade"
  | "end-turn";

export interface RecommendedAction {
  type: ActionType;
  sourceEntityId?: number;
  sourceCardId?: string;
  targetEntityId?: number;
  targetSide?: PlayerSide;
  description: string;
}

export interface CandidateLine {
  rank: number;
  actions: RecommendedAction[];
  rationale: string;
  risks: string[];
  confidence: number;
}

export interface AnalysisResult {
  snapshotRevision: string;
  summary: string;
  candidates: CandidateLine[];
  warnings: string[];
  createdAt?: string;
  stale?: boolean;
}

export interface AppSettings {
  powerLogPath: string;
  baseUrl: string;
  model: string;
  transport: Transport;
  timeoutMs: number;
  maxCandidates: number;
  overlayVisible: boolean;
  liveRecommendationsEnabled: boolean;
  liveRecommendationsRiskAcceptedAt?: string;
}

export interface LogStatus {
  available: boolean;
  path: string;
  message: string;
  lastEventAt?: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export interface VisualValidationReport extends ValidationReport {
  resolution?: string;
  matchedEntityIds: number[];
}

export interface CardCatalogStatus {
  ready: boolean;
  version: string;
  entryCount: number;
  gameBuild?: number;
}

export interface AppStatus {
  settings: AppSettings;
  log: LogStatus;
  catalog: CardCatalogStatus;
  snapshot?: GameStateSnapshot;
  analysis?: AnalysisResult;
  visualValidation?: VisualValidationReport;
  busy: boolean;
  message?: string;
}
