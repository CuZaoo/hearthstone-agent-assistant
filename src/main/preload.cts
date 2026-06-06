import { contextBridge, ipcRenderer } from "electron";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
} from "../shared/types.js";

const IPC = {
  getStatus: "app:get-status",
  saveSettings: "app:save-settings",
  setApiKey: "app:set-api-key",
  hasApiKey: "app:has-api-key",
  analyze: "app:analyze",
  testAgentConnection: "app:test-agent-connection",
  toggleOverlay: "app:toggle-overlay",
  listHistory: "app:list-history",
  statusChanged: "app:status-changed",
  getLastAgentRequest: "app:get-last-agent-request",
  stopAnalysis: "app:stop-analysis",
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
  listHistory: (): Promise<AnalysisResult[]> => ipcRenderer.invoke(IPC.listHistory),
  getLastAgentRequest: (): Promise<unknown> => ipcRenderer.invoke(IPC.getLastAgentRequest),
  stopAnalysis: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.stopAnalysis),
  onStatusChanged: (callback: (status: AppStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppStatus) =>
      callback(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
});
