import { dialog } from "electron";
import { getActiveAgent } from "../shared/settings-model.js";
import type { AgentProfile, AppSettings } from "../shared/types.js";
import type { CredentialStore } from "./credential-store.js";
import type { WindowManager } from "./window-manager.js";

export type AgentWithApiKey = AgentProfile & { apiKey: string };

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
    reason: string,
  ): Promise<AgentWithApiKey | undefined> {
    const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
    if (apiKey) {
      return { ...agent, apiKey };
    }
    return this.chooseFallbackAgent(agent, reason);
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
      if (apiKey) {
        candidates.push({ ...agent, apiKey });
      }
    }
    const fallback = candidates[0];
    if (!fallback) {
      return undefined;
    }

    const dialogOptions: Electron.MessageBoxOptions = {
      type: "warning",
      buttons: [`使用 ${fallback.name}`, "取消"],
      defaultId: 0,
      cancelId: 1,
      title: "Agent 分析失败",
      message: `${failedAgent.name} 分析失败。是否切换到备用 Agent？`,
      detail: reason,
    };
    const mainWindow = this.deps.windowManager.getMainWindow();
    const response = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    if (response.response !== 0) {
      return undefined;
    }
    await this.deps.saveSettings({
      ...settings,
      activeAgentId: fallback.id,
    });
    return fallback;
  }
}
