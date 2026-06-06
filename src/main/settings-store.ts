import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_SETTINGS } from "../shared/defaults.js";
import type { AgentProfile, AppSettings } from "../shared/types.js";

export class SettingsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
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

function normalizeSettings(settings: AppSettings): AppSettings {
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
  return {
    ...settings,
    agents,
    activeAgentId: activeAgent.id,
    baseUrl: activeAgent.baseUrl,
    model: activeAgent.model,
    transport: activeAgent.transport,
    timeoutMs: activeAgent.timeoutMs,
    maxCandidates: Math.min(5, Math.max(1, settings.maxCandidates)),
    guideDismissed: settings.guideDismissed ?? DEFAULT_SETTINGS.guideDismissed,
    language: settings.language ?? DEFAULT_SETTINGS.language,
    multiAgentCompareEnabled: settings.multiAgentCompareEnabled ?? DEFAULT_SETTINGS.multiAgentCompareEnabled,
    winRateEstimationEnabled: settings.winRateEstimationEnabled ?? DEFAULT_SETTINGS.winRateEstimationEnabled,
    hotkeys: settings.hotkeys ?? DEFAULT_SETTINGS.hotkeys,
  };
}

function normalizeAgents(settings: AppSettings): AgentProfile[] {
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
  return sourceAgents.map((agent, index) => ({
    id: agent.id?.trim() || `agent-${index + 1}`,
    name: agent.name?.trim() || `Agent ${index + 1}`,
    baseUrl: agent.baseUrl.trim(),
    model: agent.model.trim(),
    transport: agent.transport,
    timeoutMs: Math.min(60_000, Math.max(1_000, agent.timeoutMs)),
  }));
}
