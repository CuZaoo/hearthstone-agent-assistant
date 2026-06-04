import type { AppSettings, PlayerState } from "./types.js";

export const DEFAULT_POWER_LOG_PATH =
  "%LOCALAPPDATA%\\Blizzard\\Hearthstone\\Logs\\Power.log";

export const DEFAULT_SETTINGS: AppSettings = {
  powerLogPath: DEFAULT_POWER_LOG_PATH,
  baseUrl: "https://api.openai.com",
  model: "",
  transport: "responses",
  timeoutMs: 8_000,
  maxCandidates: 3,
  overlayVisible: true,
  liveRecommendationsEnabled: false,
};

export function emptyPlayerState(): PlayerState {
  return {
    hero: {},
    mana: 0,
    maxMana: 0,
    overloadLocked: 0,
    hand: [],
    handCount: 0,
    board: [],
    secretCount: 0,
  };
}
