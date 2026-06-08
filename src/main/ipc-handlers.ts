import { ipcMain, shell } from "electron";
import { readFile } from "node:fs/promises";
import type { AdoptionStats, AppSettings, AppStatus, AgentProfile, DiagnosticLogEntry, GameInfo } from "../shared/types.js";
import type { AnalysisService } from "./analysis-service.js";
import type { CredentialStore } from "./credential-store.js";
import type { HistoryDatabase } from "./history-database.js";
import { enablePowerLoggingInOptionsFile } from "./power-log-locator.js";
import type { WindowManager } from "./window-manager.js";
import { resolveFallbackFromRenderer } from "./agent-fallback-selector.js";

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
  listGames: "app:list-games",
  listAnalysesByGame: "app:list-analyses-by-game",
  getAdoptionStats: "app:get-adoption-stats",
  statusChanged: "app:status-changed",
  getLastAgentRequest: "app:get-last-agent-request",
  getLastAgentResponse: "app:get-last-agent-response",
  stopAnalysis: "app:stop-analysis",
  windowMinimize: "app:window-minimize",
  windowMaximize: "app:window-maximize",
  windowClose: "app:window-close",
  getDiagnosticLogs: "app:get-diagnostic-logs",
  openDiagnosticLog: "app:open-diagnostic-log",
  enablePowerLogging: "app:enable-power-logging",
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
  diagnosticLogPath: string;
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
  ipcMain.handle(IPC.listGames, () => deps.historyDatabase.listGames());
  ipcMain.handle(IPC.listAnalysesByGame, (_event, gameId: string) => deps.historyDatabase.listAnalysesByGame(gameId));
  ipcMain.handle(IPC.getAdoptionStats, (_event, agentId?: string) => deps.historyDatabase.getAdoptionStats(agentId));
  ipcMain.handle(IPC.getLastAgentRequest, () => deps.analysisService.getLastAgentRequest());
  ipcMain.handle(IPC.getLastAgentResponse, () => deps.analysisService.getLastAgentResponse());
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
  ipcMain.handle(IPC.getDiagnosticLogs, async (_event, count: number = 100): Promise<DiagnosticLogEntry[]> => {
    try {
      const raw = await readFile(deps.diagnosticLogPath, "utf8");
      const lines = raw.trim().split("\n");
      const tail = lines.slice(-count);
      return tail
        .map((line) => {
          try {
            return JSON.parse(line) as DiagnosticLogEntry;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is DiagnosticLogEntry => entry !== null)
        .reverse();
    } catch {
      return [];
    }
  });
  ipcMain.handle(IPC.openDiagnosticLog, async () => {
    await shell.openPath(deps.diagnosticLogPath);
  });
  ipcMain.handle(IPC.enablePowerLogging, () => enablePowerLoggingInOptionsFile());
  ipcMain.handle("app:fallback-prompt-respond", (_event, useFallback: boolean) => {
    resolveFallbackFromRenderer(useFallback);
    return true;
  });
}
