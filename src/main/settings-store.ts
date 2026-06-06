import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS } from "../shared/defaults.js";
import type { AgentProfile, AppSettings, Transport } from "../shared/types.js";

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
                  baseUrl: parsed.baseUrl ?? DEFAULT_SETTINGS.baseUrl,
                  model: parsed.model ?? DEFAULT_SETTINGS.model,
                  transport: parsed.transport ?? DEFAULT_SETTINGS.transport,
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
      baseUrl: DEFAULT_SETTINGS.baseUrl,
      model: DEFAULT_SETTINGS.model,
      transport: DEFAULT_SETTINGS.transport,
      timeoutMs: DEFAULT_SETTINGS.timeoutMs,
    };
  const hotkeys = asRecord(settings.hotkeys) ?? DEFAULT_SETTINGS.hotkeys;
  return {
    powerLogPath: stringValue(settings.powerLogPath, DEFAULT_SETTINGS.powerLogPath),
    agents,
    activeAgentId: activeAgent.id,
    baseUrl: activeAgent.baseUrl,
    model: activeAgent.model,
    transport: activeAgent.transport,
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
            baseUrl: settings.baseUrl,
            model: settings.model,
            transport: settings.transport,
            timeoutMs: settings.timeoutMs,
          },
        ];
  return sourceAgents.map((agent, index) => normalizeAgent(agent, index));
}

function normalizeAgent(agent: Partial<AgentProfile>, index: number): AgentProfile {
  return {
    id: stringValue(agent.id, `agent-${index + 1}`),
    name: stringValue(agent.name, `Agent ${index + 1}`),
    baseUrl: stringValue(agent.baseUrl, DEFAULT_SETTINGS.baseUrl),
    model: stringValue(agent.model, DEFAULT_SETTINGS.model),
    transport: transportValue(agent.transport, DEFAULT_SETTINGS.transport),
    timeoutMs: clampNumber(agent.timeoutMs, DEFAULT_SETTINGS.timeoutMs, 1_000, 60_000),
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

function transportValue(value: unknown, fallback: Transport): Transport {
  return value === "responses" || value === "chat-completions" ? value : fallback;
}
