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
import {
  expandEnvironmentVariables,
  locatePowerLog,
} from "./power-log-locator.js";
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
let logDiscoveryTimer: NodeJS.Timeout | undefined;
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
  await startWatcher();
  broadcastStatus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  watcher?.stop();
  if (logDiscoveryTimer) {
    clearInterval(logDiscoveryTimer);
  }
  globalShortcut.unregisterAll();
  historyDatabase?.close();
});

function createWindows(): void {
  const preload = join(import.meta.dirname, "preload.cjs");
  const rendererUrl =
    process.env.VITE_DEV_SERVER_URL ??
    (!app.isPackaged ? "http://localhost:5173" : undefined);
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
  mainWindow.on("closed", () => {
    mainWindow = undefined;
    app.quit();
  });
  overlayWindow.on("closed", () => {
    overlayWindow = undefined;
  });

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
      settings = await settingsStore.save(nextSettings);
      await startWatcher();
      setOverlayVisible(settings.overlayVisible);
      broadcastStatus();
      return getStatus();
    },
  );
}

async function startWatcher(): Promise<void> {
  if (logDiscoveryTimer) {
    clearInterval(logDiscoveryTimer);
  }
  await refreshWatcher();
  logDiscoveryTimer = setInterval(() => void refreshWatcher(), 2_000);
}

async function refreshWatcher(): Promise<void> {
  const location = await locatePowerLog(settings.powerLogPath);
  const path =
    location?.path ?? expandEnvironmentVariables(settings.powerLogPath);
  if (watcher?.path === path) {
    return;
  }

  watcher?.stop();
  parser.reset();
  currentSnapshot = undefined;
  currentAnalysis = undefined;
  visualValidation = undefined;
  logStatus = {
    available: Boolean(location),
    path,
    message: location
      ? `已发现 Power.log：${location.source}`
      : "未找到 Power.log，请启动炉石并确认已手动启用日志。",
  };
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
    visualValidation = undefined;
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
  broadcastStatus();
}

async function analyzeCurrentState(): Promise<AppStatus> {
  if (busy) {
    return getStatus();
  }
  const analysisStartedAt = Date.now();
  busy = true;
  statusMessage = "正在读取并校验当前局面…";
  broadcastStatus();

  try {
    assertLiveRecommendationsEnabled();
    if (!currentSnapshot) {
      throw new Error("尚未从 Power.log 读取到有效局面。");
    }
    const snapshot = currentSnapshot;
    const snapshotReport = validateSnapshotForAnalysis(snapshot, catalog);
    if (!snapshotReport.ok) {
      throw new Error(snapshotReport.errors.join("；"));
    }

    const screenshot = await captureHearthstoneWindow();
    visualValidation = new VisualValidator().validate(
      screenshot,
      snapshot,
      catalog,
    );
    if (!visualValidation.ok) {
      throw new Error(visualValidation.errors.join("；"));
    }
    if (currentSnapshot?.revision !== snapshot.revision) {
      throw new Error("视觉校验期间局面已发生变化，请重新分析。");
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
    const remainingMs = settings.timeoutMs - (Date.now() - analysisStartedAt);
    if (remainingMs < 1_000) {
      throw new Error(`分析准备阶段已超过 ${settings.timeoutMs}ms 总预算。`);
    }
    const client = new AgentClient(
      {
        baseUrl: settings.baseUrl,
        model: settings.model,
        transport: settings.transport,
        timeoutMs: remainingMs,
      },
      apiKey,
      catalog,
    );
    const requestedRevision = snapshot.revision;
    const result = await client.analyze({
      snapshot,
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
    thumbnailSize: { width: 2560, height: 1440 },
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
    catalog: {
      ready: catalog.isReady(),
      version: catalog.version,
      entryCount: catalog.size(),
      gameBuild: catalog.gameBuild,
    },
    snapshot: currentSnapshot,
    analysis: currentAnalysis,
    visualValidation,
    busy,
    message: statusMessage,
  };
}

function broadcastStatus(): void {
  const status = getStatus();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.statusChanged, status);
  }
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send(IPC.statusChanged, status);
  }
}

function resolveCatalogPath(): string {
  const developmentPath = join(app.getAppPath(), "assets", "card-catalog.zhCN.json");
  const packagedPath = join(process.resourcesPath, "assets", "card-catalog.zhCN.json");
  return existsSync(developmentPath) ? developmentPath : packagedPath;
}
