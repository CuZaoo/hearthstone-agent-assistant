import { ipcMain } from "electron";
import type { AppSettings, AppStatus, AgentProfile } from "../shared/types.js";
import type { AnalysisService } from "./analysis-service.js";
import type { CredentialStore } from "./credential-store.js";
import type { HistoryDatabase } from "./history-database.js";
import type { WindowManager } from "./window-manager.js";

export const IPC = {
  getStatus: "app:get-status",
  saveSettings: "app:save-settings",
  setApiKey: "app:set-api-key",
  hasApiKey: "app:has-api-key",
  analyze: "app:analyze",
  testAgentConnection: "app:test-agent-connection",
  toggleOverlay: "app:toggle-overlay",
  showMainWindow: "app:show-main-window",
  listHistory: "app:list-history",
  statusChanged: "app:status-changed",
  getLastAgentRequest: "app:get-last-agent-request",
  stopAnalysis: "app:stop-analysis",
  windowMinimize: "app:window-minimize",
  windowMaximize: "app:window-maximize",
  windowClose: "app:window-close",
} as const;

export interface IpcHandlerDependencies {
  refreshCurrentLog(): Promise<void>;
  getStatus(): AppStatus;
  getActiveAgent(): AgentProfile;
  saveSettings(settings: AppSettings): Promise<AppStatus>;
  toggleOverlay(): AppStatus;
  credentialStore: CredentialStore;
  historyDatabase: HistoryDatabase;
  analysisService: AnalysisService;
  windowManager: WindowManager;
}

export function registerIpcHandlers(deps: IpcHandlerDependencies): void {
  ipcMain.handle(IPC.getStatus, async () => {
    await deps.refreshCurrentLog();
    return deps.getStatus();
  });
  ipcMain.handle(IPC.hasApiKey, (_event, agentId?: string) =>
    deps.credentialStore.getApiKey(agentId ?? deps.getActiveAgent().id).then(Boolean),
  );
  ipcMain.handle(IPC.listHistory, () => deps.historyDatabase.listAnalyses());
  ipcMain.handle(IPC.getLastAgentRequest, () => deps.analysisService.getLastAgentRequest());
  ipcMain.handle(IPC.stopAnalysis, () => deps.analysisService.stopAnalysis());
  ipcMain.handle(IPC.analyze, () => deps.analysisService.analyze("manual"));
  ipcMain.handle(IPC.testAgentConnection, () => deps.analysisService.testConnection());
  ipcMain.handle(IPC.toggleOverlay, () => deps.toggleOverlay());
  ipcMain.handle(IPC.showMainWindow, () => deps.windowManager.toggleMainWindow());
  ipcMain.handle(IPC.windowMinimize, () => deps.windowManager.minimizeMainWindow());
  ipcMain.handle(IPC.windowMaximize, () => deps.windowManager.toggleMainWindowMaximized());
  ipcMain.handle(IPC.windowClose, () => deps.windowManager.closeMainWindow());
  ipcMain.handle(IPC.setApiKey, async (_event, apiKey: string, agentId?: string) => {
    await deps.credentialStore.setApiKey(apiKey, agentId ?? deps.getActiveAgent().id);
    return Boolean(apiKey.trim());
  });
  ipcMain.handle(IPC.saveSettings, (_event, settings: AppSettings) =>
    deps.saveSettings(settings),
  );
}
