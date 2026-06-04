import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentClient } from "../core/agent-client.js";
import { validateSnapshotForAnalysis } from "../core/analysis-validator.js";
import { CardCatalog } from "../core/card-catalog.js";
import { PowerLogParser } from "../core/power-log-parser.js";
import { PowerLogWatcher } from "../core/power-log-watcher.js";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  GameStateSnapshot,
  LogStatus,
  VisualValidationReport,
} from "../shared/types.js";
import { CredentialStore } from "./credential-store.js";
import { HistoryDatabase } from "./history-database.js";
import { SettingsStore } from "./settings-store.js";
import { VisualValidator } from "./visual-validator.js";

let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore;
let credentialStore: CredentialStore;
let historyDatabase: HistoryDatabase;
let catalog: CardCatalog;
let parser: PowerLogParser;
let watcher: PowerLogWatcher | undefined;
let settings: AppSettings;
let currentSnapshot: GameStateSnapshot | undefined;
let currentAnalysis: AnalysisResult | undefined;
let logStatus: LogStatus = {
  available: false,
  path: "",
  message: "尚未开始监听 Power.log。",
};
let visualValidation: VisualValidationReport | undefined;
let busy = false;
let statusMessage: string | undefined;

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

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  await mkdir(userData, { recursive: true });
  settingsStore = new SettingsStore(join(userData, "settings.json"));
  credentialStore = new CredentialStore();
  historyDatabase = new HistoryDatabase(join(userData, "history.db"));
  settings = await settingsStore.load();
  catalog = await CardCatalog.load(resolveCatalogPath());
  historyDatabase.setCardCatalogVersion(catalog.version);
  parser = new PowerLogParser();

  createWindows();
  registerIpc();
  registerShortcuts();
  startWatcher();
  broadcastStatus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  watcher?.stop();
  globalShortcut.unregisterAll();
  historyDatabase?.close();
});

function createWindows(): void {
  const preload = join(import.meta.dirname, "preload.js");
  const rendererUrl = process.env.VITE_DEV_SERVER_URL;
  const rendererFile = join(app.getAppPath(), "dist", "renderer", "index.html");

  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 820,
    minHeight: 640,
    title: "炉石对局 Agent 助手",
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlayWindow = new BrowserWindow({
    width: 420,
    height: 640,
    x: 24,
    y: 96,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: settings.overlayVisible,
    focusable: false,
    webPreferences: {
      preload,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  overlayWindow.setIgnoreMouseEvents(true);

  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
    void overlayWindow.loadURL(`${rendererUrl}?view=overlay`);
  } else {
    void mainWindow.loadFile(rendererFile);
    void overlayWindow.loadFile(rendererFile, { query: { view: "overlay" } });
  }
}

function registerShortcuts(): void {
  globalShortcut.register("CommandOrControl+Shift+A", () => void analyzeCurrentState());
  globalShortcut.register("CommandOrControl+Shift+O", () => toggleOverlay());
}

function registerIpc(): void {
  ipcMain.handle(IPC.getStatus, () => getStatus());
  ipcMain.handle(IPC.hasApiKey, () => credentialStore.getApiKey().then(Boolean));
  ipcMain.handle(IPC.listHistory, () => historyDatabase.listAnalyses());
  ipcMain.handle(IPC.analyze, () => analyzeCurrentState());
  ipcMain.handle(IPC.toggleOverlay, () => toggleOverlay());
  ipcMain.handle(IPC.setApiKey, async (_event, apiKey: string) => {
    await credentialStore.setApiKey(apiKey);
    return Boolean(apiKey.trim());
  });
  ipcMain.handle(
    IPC.saveSettings,
    async (_event, nextSettings: AppSettings) => {
      settings = nextSettings;
      await settingsStore.save(settings);
      startWatcher();
      setOverlayVisible(settings.overlayVisible);
      broadcastStatus();
      return getStatus();
    },
  );
}

function startWatcher(): void {
  watcher?.stop();
  const path = expandEnvironmentVariables(settings.powerLogPath);
  watcher = new PowerLogWatcher(path, parser);
  watcher.on("status", (nextStatus) => {
    logStatus = nextStatus;
    broadcastStatus();
  });
  watcher.on("change", () => {
    const next = parser.snapshot(catalog.version);
    if (currentAnalysis && currentAnalysis.snapshotRevision !== next.revision) {
      currentAnalysis = { ...currentAnalysis, stale: true };
    }
    currentSnapshot = next;
    historyDatabase.saveSnapshot(next);
    broadcastStatus();
  });
  watcher.on("error", (error) => {
    logStatus = {
      available: false,
      path,
      message: `日志监听失败：${error.message}`,
    };
    broadcastStatus();
  });
  watcher.start();
}

async function analyzeCurrentState(): Promise<AppStatus> {
  if (busy) {
    return getStatus();
  }
  busy = true;
  statusMessage = "正在读取并校验当前局面…";
  broadcastStatus();

  try {
    assertLiveRecommendationsEnabled();
    if (!currentSnapshot) {
      throw new Error("尚未从 Power.log 读取到有效局面。");
    }
    const snapshotReport = validateSnapshotForAnalysis(currentSnapshot, catalog);
    if (!snapshotReport.ok) {
      throw new Error(snapshotReport.errors.join("；"));
    }

    const screenshot = await captureHearthstoneWindow();
    visualValidation = new VisualValidator().validate(
      screenshot,
      currentSnapshot,
      catalog,
    );
    if (!visualValidation.ok) {
      throw new Error(visualValidation.errors.join("；"));
    }

    const apiKey = await credentialStore.getApiKey();
    if (!apiKey) {
      throw new Error("尚未配置 Agent API Key。");
    }
    if (!settings.model) {
      throw new Error("尚未配置 Agent 模型名称。");
    }

    statusMessage = "正在请求 Agent 分析…";
    broadcastStatus();
    const client = new AgentClient(settings, apiKey, catalog);
    const requestedRevision = currentSnapshot.revision;
    const result = await client.analyze({
      snapshot: currentSnapshot,
      objective: "recommend-current-turn",
      maxCandidates: settings.maxCandidates,
    });
    if (currentSnapshot.revision !== requestedRevision) {
      currentAnalysis = { ...result, stale: true };
      throw new Error("局面已发生变化，本次建议已标记为过期。");
    }
    currentAnalysis = result;
    historyDatabase.saveAnalysis(result);
    statusMessage = "分析完成。";
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : "分析失败。";
  } finally {
    busy = false;
    broadcastStatus();
  }
  return getStatus();
}

async function captureHearthstoneWindow() {
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false,
  });
  const source = sources.find((entry) => /hearthstone|炉石传说/i.test(entry.name));
  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("未找到炉石传说窗口，请使用窗口化或无边框模式。");
  }
  return source.thumbnail;
}

function assertLiveRecommendationsEnabled(): void {
  if (
    !settings.liveRecommendationsEnabled ||
    !settings.liveRecommendationsRiskAcceptedAt
  ) {
    throw new Error("正式对局实时建议默认禁用，请先在设置页确认已获授权并接受风险。");
  }
}

function toggleOverlay(): AppStatus {
  setOverlayVisible(!overlayWindow?.isVisible());
  settings = { ...settings, overlayVisible: Boolean(overlayWindow?.isVisible()) };
  void settingsStore.save(settings);
  broadcastStatus();
  return getStatus();
}

function setOverlayVisible(visible: boolean): void {
  if (visible) {
    overlayWindow?.showInactive();
  } else {
    overlayWindow?.hide();
  }
}

function getStatus(): AppStatus {
  return {
    settings,
    log: logStatus,
    snapshot: currentSnapshot,
    analysis: currentAnalysis,
    visualValidation,
    busy,
    message: statusMessage,
  };
}

function broadcastStatus(): void {
  const status = getStatus();
  mainWindow?.webContents.send(IPC.statusChanged, status);
  overlayWindow?.webContents.send(IPC.statusChanged, status);
}

function resolveCatalogPath(): string {
  const developmentPath = join(app.getAppPath(), "assets", "card-catalog.zhCN.json");
  const packagedPath = join(process.resourcesPath, "assets", "card-catalog.zhCN.json");
  return existsSync(developmentPath) ? developmentPath : packagedPath;
}

function expandEnvironmentVariables(path: string): string {
  return path.replace(/%([^%]+)%/g, (_match, name: string) => {
    return process.env[name] ?? process.env[name.toUpperCase()] ?? `%${name}%`;
  });
}

