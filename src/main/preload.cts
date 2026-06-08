import { contextBridge, ipcRenderer } from "electron";
import type {
  AdoptionStats,
  AnalysisResult,
  AppSettings,
  AppStatus,
  DiagnosticLogEntry,
  GameInfo,
} from "../shared/types.js";

const IPC = {
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
  openPowerLog: "app:open-power-log",
  enablePowerLogging: "app:enable-power-logging",
} as const;

contextBridge.exposeInMainWorld("hearthstoneAgent", {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.getStatus),
  saveSettings: (settings: AppSettings): Promise<AppStatus> =>
    ipcRenderer.invoke(IPC.saveSettings, settings),
  setApiKey: (apiKey: string, agentId?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setApiKey, apiKey, agentId),
  hasApiKey: (agentId?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.hasApiKey, agentId),
  analyze: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.analyze),
  testAgentConnection: (): Promise<AppStatus> =>
    ipcRenderer.invoke(IPC.testAgentConnection),
  toggleOverlay: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.toggleOverlay),
  showMainWindow: (): Promise<void> => ipcRenderer.invoke(IPC.showMainWindow),
  listHistory: (): Promise<AnalysisResult[]> => ipcRenderer.invoke(IPC.listHistory),
  listGames: (): Promise<GameInfo[]> => ipcRenderer.invoke(IPC.listGames),
  listAnalysesByGame: (gameId: string): Promise<AnalysisResult[]> => ipcRenderer.invoke(IPC.listAnalysesByGame, gameId),
  getAdoptionStats: (agentId?: string): Promise<AdoptionStats> => ipcRenderer.invoke(IPC.getAdoptionStats, agentId),
  getLastAgentRequest: (): Promise<unknown> => ipcRenderer.invoke(IPC.getLastAgentRequest),
  getLastAgentResponse: (): Promise<string | undefined> => ipcRenderer.invoke(IPC.getLastAgentResponse),
  stopAnalysis: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.stopAnalysis),
  minimizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMinimize),
  maximizeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowMaximize),
  closeWindow: (): Promise<void> => ipcRenderer.invoke(IPC.windowClose),
  getDiagnosticLogs: (count?: number): Promise<DiagnosticLogEntry[]> =>
    ipcRenderer.invoke(IPC.getDiagnosticLogs, count),
  openDiagnosticLog: (): Promise<void> => ipcRenderer.invoke(IPC.openDiagnosticLog),
  openPowerLog: (): Promise<void> => ipcRenderer.invoke(IPC.openPowerLog),
  enablePowerLogging: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke(IPC.enablePowerLogging),
  onStatusChanged: (callback: (status: AppStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppStatus) =>
      callback(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
  onFallbackPrompt: (callback: (data: { failedAgentName: string; fallbackAgentName: string; reason: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { failedAgentName: string; fallbackAgentName: string; reason: string }) =>
      callback(data);
    ipcRenderer.on("app:show-fallback-prompt-ui", listener);
    return () => ipcRenderer.removeListener("app:show-fallback-prompt-ui", listener);
  },
  fallbackPromptRespond: (useFallback: boolean): Promise<boolean> =>
    ipcRenderer.invoke("app:fallback-prompt-respond", useFallback),
});
