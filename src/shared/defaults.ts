import type { AppSettings, PlayerState, PromptConfig, PromptSections, ProviderPreset } from "./types.js";

export const DEFAULT_POWER_LOG_PATH =
  "%LOCALAPPDATA%\\Blizzard\\Hearthstone\\Logs\\Power.log";

export const DEFAULT_PROMPT_SECTIONS: PromptSections = {
  roleSetting: true,
  infoConstraint: true,
  goalDefinition: true,
  refConstraint: true,
  fieldConstraint: true,
  descConstraint: true,
  coinConstraint: true,
  candidateConstraint: true,
  formatConstraint: true,
};

export const DEFAULT_PROMPT_CONFIG: PromptConfig = {
  systemPromptSections: { ...DEFAULT_PROMPT_SECTIONS },
  customUserPrompt: "",
};

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    label: "智谱AI (GLM)",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
    model: "glm-4-flash",
    format: "chat-completions",
  },
  {
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-v4-flash",
    format: "chat-completions",
  },
  {
    label: "通义千问 (阿里)",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
    format: "chat-completions",
  },
  {
    label: "月之暗面 (Kimi)",
    apiUrl: "https://api.moonshot.cn/v1/chat/completions",
    model: "kimi-k2.5",
    format: "chat-completions",
  },
  {
    label: "硅基流动",
    apiUrl: "https://api.siliconflow.cn/v1/chat/completions",
    model: "deepseek-ai/DeepSeek-V3",
    format: "chat-completions",
  },
  {
    label: "MiniMax",
    apiUrl: "https://api.minimax.chat/v1/chat/completions",
    model: "MiniMax-Text-01",
    format: "chat-completions",
  },
  {
    label: "字节豆包",
    apiUrl: "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
    model: "doubao-1.5-pro",
    format: "chat-completions",
  },
  {
    label: "Ollama (本地)",
    apiUrl: "http://localhost:11434/v1/chat/completions",
    model: "qwen2.5",
    format: "chat-completions",
  },
  {
    label: "OpenAI",
    apiUrl: "https://api.openai.com/v1/responses",
    model: "gpt-4o-mini",
    format: "responses",
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  powerLogPath: DEFAULT_POWER_LOG_PATH,
  agents: [
    {
      id: "default",
      name: "默认 Agent",
      apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4-flash",
      format: "chat-completions",
      timeoutMs: 8_000,
      promptConfig: { ...DEFAULT_PROMPT_CONFIG },
    },
  ],
  activeAgentId: "default",
  apiUrl: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  model: "glm-4-flash",
  format: "chat-completions",
  timeoutMs: 8_000,
  maxCandidates: 3,
  overlayVisible: true,
  liveRecommendationsEnabled: false,
  autoAnalyze: true,
  guideDismissed: false,
  language: "zhCN",
  multiAgentCompareEnabled: false,
  winRateEstimationEnabled: false,
  hotkeys: {
    analyze: "CommandOrControl+Shift+A",
    toggleOverlay: "CommandOrControl+Shift+O",
  },
  validationMode: "relaxed",
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
