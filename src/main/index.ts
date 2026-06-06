import {
  app,
  globalShortcut,
  Menu,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CardCatalog } from "../core/card-catalog.js";
import { PowerLogParser } from "../core/power-log-parser.js";
import { PowerLogWatcher } from "../core/power-log-watcher.js";
import { enrichSnapshotWithCatalog } from "../core/snapshot-enricher.js";
import type {
  AppSettings,
  AppStatus,
  AgentProfile,
  GameStateSnapshot,
  LogStatus,
} from "../shared/types.js";
import { AnalysisService } from "./analysis-service.js";
import { CredentialStore } from "./credential-store.js";
import { DiagnosticLog } from "./diagnostic-log.js";
import { HistoryDatabase } from "./history-database.js";
import { buildAppStatus } from "./app-status.js";
import {
  expandEnvironmentVariables,
  inspectPowerLog,
} from "./power-log-locator.js";
import { IPC, registerIpcHandlers } from "./ipc-handlers.js";
import { SettingsStore } from "./settings-store.js";
import { WindowManager } from "./window-manager.js";

const windowManager = new WindowManager();
let settingsStore: SettingsStore;
let credentialStore: CredentialStore;
let historyDatabase: HistoryDatabase;
let diagnosticLog: DiagnosticLog;
let analysisService: AnalysisService;
let catalog: CardCatalog;
let parser: PowerLogParser;
let watcher: PowerLogWatcher | undefined;
let logDiscoveryTimer: NodeJS.Timeout | undefined;
let settings: AppSettings;
let currentSnapshot: GameStateSnapshot | undefined;
let logStatus: LogStatus = {
  available: false,
  path: "",
  message: "尚未开始监听 Power.log。",
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}
app.on("second-instance", () => {
  windowManager.focusMainWindow();
});

app.whenReady().then(async () => {
  const userData = app.getPath("userData");
  await mkdir(userData, { recursive: true });
  settingsStore = new SettingsStore(join(userData, "settings.json"));
  credentialStore = new CredentialStore();
  historyDatabase = new HistoryDatabase(join(userData, "history.db"));
  diagnosticLog = new DiagnosticLog(join(userData, "diagnostics.jsonl"));
  settings = await settingsStore.load();
  catalog = await CardCatalog.load(resolveCatalogPath());
  catalog.setLanguage(settings.language);
  historyDatabase.setCardCatalogVersion(catalog.version);
  parser = new PowerLogParser();
  analysisService = new AnalysisService({
    getSettings: () => settings,
    saveSettings: async (nextSettings) => {
      settings = await settingsStore.save(nextSettings);
      return settings;
    },
    getSnapshot: () => currentSnapshot,
    refreshCurrentLog,
    getCatalog: () => catalog,
    credentialStore,
    historyDatabase,
    windowManager,
    getStatus,
    broadcastStatus,
    writeDiagnostic,
  });
  writeDiagnostic("app.ready", {
    userData,
    catalogVersion: catalog.version,
    catalogSize: catalog.size(),
    settings: diagnosticSettings(),
  });

  Menu.setApplicationMenu(null);
  windowManager.createWindows({ overlayVisible: settings.overlayVisible });
  registerIpcHandlers({
    refreshCurrentLog,
    getStatus,
    getActiveAgent: activeAgent,
    saveSettings,
    toggleOverlay,
    credentialStore,
    historyDatabase,
    analysisService,
    windowManager,
  });
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
  analysisService?.dispose();
  globalShortcut.unregisterAll();
  historyDatabase?.close();
});

function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(settings.hotkeys.analyze, () => void analysisService.analyze("manual"));
  } catch {
    globalShortcut.register("CommandOrControl+Shift+A", () => void analysisService.analyze("manual"));
  }
  try {
    globalShortcut.register(settings.hotkeys.toggleOverlay, () => toggleOverlay());
  } catch {
    globalShortcut.register("CommandOrControl+Shift+O", () => toggleOverlay());
  }
}

async function saveSettings(nextSettings: AppSettings): Promise<AppStatus> {
  catalog.setLanguage(nextSettings.language);
  settings = await settingsStore.save(nextSettings);
  await startWatcher();
  setOverlayVisible(settings.overlayVisible);
  registerShortcuts();
  broadcastStatus();
  return getStatus();
}

async function startWatcher(): Promise<void> {
  if (logDiscoveryTimer) {
    clearInterval(logDiscoveryTimer);
  }
  await refreshWatcher();
  logDiscoveryTimer = setInterval(() => void refreshWatcher(), 2_000);
}

async function refreshWatcher(): Promise<void> {
  const inspection = await inspectPowerLog(settings.powerLogPath);
  const location = inspection.location;
  const path = location?.path ?? inspection.expectedPath;
  if (watcher?.path === path) {
    return;
  }

  watcher?.stop();
  parser.reset();
  currentSnapshot = undefined;
  analysisService.resetForLogChange();
  logStatus = {
    available: Boolean(location),
    path,
    message: powerLogStatusMessage(inspection),
  };
  watcher = new PowerLogWatcher(path, parser);
  watcher.on("status", (nextStatus) => {
    logStatus = nextStatus;
    broadcastStatus();
  });
  watcher.on("change", () => {
    const next = enrichSnapshotWithCatalog(
      parser.snapshot(catalog.version),
      catalog,
    );
    currentSnapshot = next;
    analysisService.onSnapshotChanged(next);
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

function powerLogStatusMessage(
  inspection: Awaited<ReturnType<typeof inspectPowerLog>>,
): string {
  if (inspection.location) {
    return `已发现 Power.log：${inspection.location.source}`;
  }
  if (inspection.latestSession) {
    return `已发现最新炉石日志目录，但其中没有 Power.log：${inspection.latestSession.powerLogPath}。请确认已手动启用 Power.log；未进入对局时也可能暂未生成。`;
  }
  return "未找到 Power.log，请启动炉石并确认已手动启用日志。";
}

async function refreshCurrentLog(): Promise<void> {
  if (!watcher) {
    return;
  }
  try {
    await watcher.pollNow();
  } catch (error) {
    writeDiagnostic("power_log.refresh_failed", {
      error: error instanceof Error ? error.message : "刷新 Power.log 失败。",
    });
  }
}

function toggleOverlay(): AppStatus {
  settings = { ...settings, overlayVisible: windowManager.toggleOverlayVisible() };
  void settingsStore.save(settings);
  broadcastStatus();
  return getStatus();
}

function setOverlayVisible(visible: boolean): void {
  windowManager.setOverlayVisible(visible);
}

function getStatus(): AppStatus {
  const analysisState = analysisService.state();
  return buildAppStatus({
    settings,
    logStatus,
    catalog,
    snapshot: currentSnapshot,
    analysis: analysisState.analysis,
    visualValidation: analysisState.visualValidation,
    busy: analysisState.busy,
    message: analysisState.message,
  });
}

function writeDiagnostic(event: string, data: Record<string, unknown> = {}): void {
  void diagnosticLog?.write(event, data).catch((error) => {
    console.error("Failed to write diagnostic log", error);
  });
}

function diagnosticSettings() {
  const agent = activeAgent();
  return {
    powerLogPath: settings.powerLogPath,
    activeAgentId: agent.id,
    agentName: agent.name,
    baseUrl: agent.baseUrl,
    model: agent.model,
    transport: agent.transport,
    timeoutMs: agent.timeoutMs,
    maxCandidates: settings.maxCandidates,
    liveRecommendationsEnabled: settings.liveRecommendationsEnabled,
    liveRecommendationsRiskAccepted: Boolean(
      settings.liveRecommendationsRiskAcceptedAt,
    ),
  };
}

function activeAgent(): AgentProfile {
  return (
    settings.agents.find((agent) => agent.id === settings.activeAgentId) ??
    settings.agents[0] ?? {
      id: "default",
      name: "默认 Agent",
      baseUrl: settings.baseUrl,
      model: settings.model,
      transport: settings.transport,
      timeoutMs: settings.timeoutMs,
    }
  );
}

function broadcastStatus(): void {
  windowManager.broadcast(IPC.statusChanged, getStatus());
}

function resolveCatalogPath(): string {
  const developmentPath = join(app.getAppPath(), "assets", "card-catalog.zhCN.json");
  const packagedPath = join(process.resourcesPath, "assets", "card-catalog.zhCN.json");
  return existsSync(developmentPath) ? developmentPath : packagedPath;
}
