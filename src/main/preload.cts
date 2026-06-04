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
  toggleOverlay: "app:toggle-overlay",
  listHistory: "app:list-history",
  statusChanged: "app:status-changed",
} as const;

contextBridge.exposeInMainWorld("hearthstoneAgent", {
  getStatus: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.getStatus),
  saveSettings: (settings: AppSettings): Promise<AppStatus> =>
    ipcRenderer.invoke(IPC.saveSettings, settings),
  setApiKey: (apiKey: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setApiKey, apiKey),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke(IPC.hasApiKey),
  analyze: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.analyze),
  toggleOverlay: (): Promise<AppStatus> => ipcRenderer.invoke(IPC.toggleOverlay),
  listHistory: (): Promise<AnalysisResult[]> => ipcRenderer.invoke(IPC.listHistory),
  onStatusChanged: (callback: (status: AppStatus) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: AppStatus) =>
      callback(status);
    ipcRenderer.on(IPC.statusChanged, listener);
    return () => ipcRenderer.removeListener(IPC.statusChanged, listener);
  },
});
