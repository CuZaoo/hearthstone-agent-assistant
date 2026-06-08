import { getActiveAgent } from "../shared/settings-model.js";
import type { AgentProfile, AppSettings } from "../shared/types.js";
import type { CredentialStore } from "./credential-store.js";
import type { WindowManager } from "./window-manager.js";

export type AgentWithApiKey = AgentProfile & { apiKey: string };

let fallbackResolver: ((useFallback: boolean) => void) | null = null;

export function resolveFallbackFromRenderer(useFallback: boolean): void {
  fallbackResolver?.(useFallback);
  fallbackResolver = null;
}

interface AgentFallbackSelectorDependencies {
  getSettings(): AppSettings;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  credentialStore: CredentialStore;
  windowManager: WindowManager;
}

export class AgentFallbackSelector {
  constructor(private readonly deps: AgentFallbackSelectorDependencies) {}

  activeAgent(): AgentProfile {
    return getActiveAgent(this.deps.getSettings());
  }

  async getApiKeyOrFallback(
    agent: AgentProfile,
  ): Promise<AgentWithApiKey> {
    const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
    return { ...agent, apiKey: apiKey ?? "" };
  }

  async chooseFallbackAgent(
    failedAgent: AgentProfile,
    reason: string,
  ): Promise<AgentWithApiKey | undefined> {
    const settings = this.deps.getSettings();
    const candidates: AgentWithApiKey[] = [];
    for (const agent of settings.agents) {
      if (agent.id === failedAgent.id || !agent.model) {
        continue;
      }
      const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
      candidates.push({ ...agent, apiKey: apiKey ?? "" });
    }
    const fallback = candidates[0];
    if (!fallback) {
      return undefined;
    }

    const mainWindow = this.deps.windowManager.getMainWindow();
    if (!mainWindow) return undefined;

    mainWindow.webContents.send("app:show-fallback-prompt-ui", {
      failedAgentName: failedAgent.name,
      fallbackAgentName: fallback.name,
      reason,
    });

    const useFallback = await new Promise<boolean>((resolve) => {
      fallbackResolver = resolve;
    });

    if (!useFallback) {
      return undefined;
    }
    await this.deps.saveSettings({
      ...settings,
      activeAgentId: fallback.id,
    });
    return fallback;
  }
}
