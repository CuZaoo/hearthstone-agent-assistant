export type PlayerSide = "self" | "opponent";
export type ActivePlayer = PlayerSide | "unknown";
export type GameMode = "standard" | "unsupported" | "unknown";
export type Transport = "responses" | "chat-completions";
export type ApiFormat = "responses" | "chat-completions";

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
  damage?: number;
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
  gameId: string;
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
  winRateBefore?: number;
  winRateAfter?: number;
  futureConsideration?: string;
}

export interface AnalysisResult {
  snapshotRevision: string;
  gameId?: string;
  turn?: number;
  summary: string;
  candidates: CandidateLine[];
  warnings: string[];
  createdAt?: string;
  stale?: boolean;
  durationMs?: number;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface GameInfo {
  gameId: string;
  startedAt: string;
  heroClass: string;
  opponentClass: string;
  gameMode: GameMode;
  firstTurn: number;
  lastTurn: number;
  analysisCount: number;
}

export interface AppSettings {
  powerLogPath: string;
  agents: AgentProfile[];
  activeAgentId?: string;
  apiUrl: string;
  model: string;
  format: ApiFormat;
  timeoutMs: number;
  maxCandidates: number;
  overlayVisible: boolean;
  liveRecommendationsEnabled: boolean;
  liveRecommendationsRiskAcceptedAt?: string;
  autoAnalyze: boolean;
  guideDismissed?: boolean;
  language: "zhCN" | "enUS";
  multiAgentCompareEnabled: boolean;
  winRateEstimationEnabled: boolean;
  hotkeys: HotkeyConfig;
}

export interface HotkeyConfig {
  analyze: string;
  toggleOverlay: string;
}

export interface PromptSections {
  roleSetting: boolean;
  infoConstraint: boolean;
  goalDefinition: boolean;
  refConstraint: boolean;
  fieldConstraint: boolean;
  descConstraint: boolean;
  coinConstraint: boolean;
  candidateConstraint: boolean;
  formatConstraint: boolean;
}

export interface PromptConfig {
  systemPromptSections: PromptSections;
  customUserPrompt: string;
}

export interface ProviderPreset {
  label: string;
  apiUrl: string;
  model: string;
  format: ApiFormat;
}

export interface AgentProfile {
  id: string;
  name: string;
  apiUrl: string;
  model: string;
  format: ApiFormat;
  timeoutMs: number;
  promptConfig?: PromptConfig;
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

export interface DiagnosticLogEntry {
  at: string;
  event: string;
  [key: string]: unknown;
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
  powerLogConfig?: { ok: boolean; message: string };
}

export interface PlayerAction {
  type: "play-card" | "attack" | "hero-power" | "end-turn" | "unknown";
  cardId?: string;
  entityId?: number;
  description: string;
}

export interface AdoptionRecord {
  id: number;
  analysisId: number;
  agentId: string;
  agentName: string;
  summary: string;
  snapshotTurn: number;
  adopted: boolean;
  matchedActions: number;
  totalRecommended: number;
  createdAt: string;
}

export interface AdoptionStats {
  totalAnalyses: number;
  totalAdopted: number;
  adoptionRate: number;
  actionsMatched: number;
  actionsTotal: number;
  actionMatchRate: number;
  perAgent: Array<{
    agentId: string;
    agentName: string;
    analyses: number;
    adopted: number;
    adoptionRate: number;
  }>;
}
