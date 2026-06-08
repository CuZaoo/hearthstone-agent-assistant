import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_PROMPT_CONFIG, DEFAULT_SETTINGS } from "../shared/defaults.js";
import type { AgentProfile, ApiFormat, AppSettings, PromptConfig } from "../shared/types.js";

export class SettingsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = asRecord(JSON.parse(raw)) ?? {};
      return normalizeSettings({
        ...DEFAULT_SETTINGS,
        ...parsed,
        agents:
          Array.isArray(parsed.agents) && parsed.agents.length > 0
            ? parsed.agents
            : [
                {
                  id: "default",
                  name: "默认 Agent",
                  apiUrl: parsed.apiUrl ?? DEFAULT_SETTINGS.apiUrl,
                  model: parsed.model ?? DEFAULT_SETTINGS.model,
                  format: parsed.format ?? DEFAULT_SETTINGS.format,
                  timeoutMs: parsed.timeoutMs ?? DEFAULT_SETTINGS.timeoutMs,
                },
              ],
      });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        throw error;
      }
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeSettings(settings);
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      this.path,
      `${JSON.stringify(normalized, null, 2)}\n`,
      "utf8",
    );
    return normalized;
  }
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const agents = normalizeAgents(settings);
  const activeAgent =
    agents.find((agent) => agent.id === settings.activeAgentId) ??
    agents[0] ??
    {
      id: "default",
      name: "默认 Agent",
      apiUrl: DEFAULT_SETTINGS.apiUrl,
      model: DEFAULT_SETTINGS.model,
      format: DEFAULT_SETTINGS.format,
      timeoutMs: DEFAULT_SETTINGS.timeoutMs,
    };
  const hotkeys = asRecord(settings.hotkeys) ?? DEFAULT_SETTINGS.hotkeys;
  return {
    powerLogPath: stringValue(settings.powerLogPath, DEFAULT_SETTINGS.powerLogPath),
    agents,
    activeAgentId: activeAgent.id,
    apiUrl: activeAgent.apiUrl,
    model: activeAgent.model,
    format: activeAgent.format,
    timeoutMs: activeAgent.timeoutMs,
    maxCandidates: clampNumber(settings.maxCandidates, DEFAULT_SETTINGS.maxCandidates, 1, 5),
    overlayVisible: booleanValue(settings.overlayVisible, DEFAULT_SETTINGS.overlayVisible),
    liveRecommendationsEnabled: booleanValue(
      settings.liveRecommendationsEnabled,
      DEFAULT_SETTINGS.liveRecommendationsEnabled,
    ),
    liveRecommendationsRiskAcceptedAt:
      typeof settings.liveRecommendationsRiskAcceptedAt === "string"
        ? settings.liveRecommendationsRiskAcceptedAt
        : undefined,
    autoAnalyze: booleanValue(settings.autoAnalyze, DEFAULT_SETTINGS.autoAnalyze),
    guideDismissed: booleanValue(settings.guideDismissed, DEFAULT_SETTINGS.guideDismissed ?? false),
    language: settings.language === "enUS" ? "enUS" : DEFAULT_SETTINGS.language,
    multiAgentCompareEnabled: booleanValue(
      settings.multiAgentCompareEnabled,
      DEFAULT_SETTINGS.multiAgentCompareEnabled,
    ),
    winRateEstimationEnabled: booleanValue(
      settings.winRateEstimationEnabled,
      DEFAULT_SETTINGS.winRateEstimationEnabled,
    ),
    hotkeys: {
      analyze: stringValue(hotkeys.analyze, DEFAULT_SETTINGS.hotkeys.analyze),
      toggleOverlay: stringValue(
        hotkeys.toggleOverlay,
        DEFAULT_SETTINGS.hotkeys.toggleOverlay,
      ),
    },
    validationMode: settings.validationMode === "strict" ? "strict" : "relaxed",
  };
}

function normalizeAgents(settings: Partial<AppSettings>): AgentProfile[] {
  const sourceAgents =
    Array.isArray(settings.agents) && settings.agents.length > 0
      ? settings.agents
      : [
          {
            id: "default",
            name: "默认 Agent",
            apiUrl: settings.apiUrl,
            model: settings.model,
            format: settings.format,
            timeoutMs: settings.timeoutMs,
          },
        ];
  return sourceAgents.map((agent, index) => normalizeAgent(agent, index));
}

function normalizeAgent(agent: Partial<AgentProfile>, index: number): AgentProfile {
  return {
    id: stringValue(agent.id, `agent-${index + 1}`),
    name: typeof agent.name === "string" ? agent.name : `Agent ${index + 1}`,
    apiUrl: stringValue(agent.apiUrl, DEFAULT_SETTINGS.apiUrl),
    model: stringValue(agent.model, DEFAULT_SETTINGS.model),
    format: formatValue(agent.format, DEFAULT_SETTINGS.format),
    timeoutMs: clampNumber(agent.timeoutMs, DEFAULT_SETTINGS.timeoutMs, 1_000, 60_000),
    promptConfig: normalizePromptConfig(agent.promptConfig),
  };
}

function normalizePromptConfig(value: unknown): PromptConfig | undefined {
  const raw = asRecord(value);
  if (!raw) return undefined;
  const sections = asRecord(raw.systemPromptSections);
  return {
    systemPromptSections: {
      roleSetting: booleanValue(sections?.roleSetting, DEFAULT_PROMPT_CONFIG.systemPromptSections.roleSetting),
      infoConstraint: booleanValue(sections?.infoConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.infoConstraint),
      goalDefinition: booleanValue(sections?.goalDefinition, DEFAULT_PROMPT_CONFIG.systemPromptSections.goalDefinition),
      refConstraint: booleanValue(sections?.refConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.refConstraint),
      fieldConstraint: booleanValue(sections?.fieldConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.fieldConstraint),
      descConstraint: booleanValue(sections?.descConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.descConstraint),
      coinConstraint: booleanValue(sections?.coinConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.coinConstraint),
      candidateConstraint: booleanValue(sections?.candidateConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.candidateConstraint),
      formatConstraint: booleanValue(sections?.formatConstraint, DEFAULT_PROMPT_CONFIG.systemPromptSections.formatConstraint),
    },
    customUserPrompt: stringValue(raw.customUserPrompt, ""),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, number));
}

function formatValue(value: unknown, fallback: ApiFormat): ApiFormat {
  return value === "responses" || value === "chat-completions" ? value : fallback;
}
