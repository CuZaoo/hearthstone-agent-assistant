import {
  app,
  globalShortcut,
  Menu,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { CardCatalog } from "../core/card-catalog.js";
import { getActiveAgent } from "../shared/settings-model.js";
import type {
  AppSettings,
  AppStatus,
  AgentProfile,
} from "../shared/types.js";
import { AnalysisService } from "./analysis-service.js";
import { CredentialStore } from "./credential-store.js";
import { DiagnosticLog } from "./diagnostic-log.js";
import { HistoryDatabase } from "./history-database.js";
import { buildAppStatus } from "./app-status.js";
import { IPC, registerIpcHandlers } from "./ipc-handlers.js";
import { PowerLogRuntime } from "./power-log-runtime.js";
import { SettingsStore } from "./settings-store.js";
import { enablePowerLoggingInOptionsFile } from "./power-log-locator.js";
import { WindowManager } from "./window-manager.js";

const windowManager = new WindowManager();
let settingsStore: SettingsStore;
let credentialStore: CredentialStore;
let historyDatabase: HistoryDatabase;
let diagnosticLog: DiagnosticLog;
let analysisService: AnalysisService;
let powerLogRuntime: PowerLogRuntime;
let catalog: CardCatalog;
let settings: AppSettings;
let powerLogConfig: AppStatus["powerLogConfig"];

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
  credentialStore = new CredentialStore(userData);
  historyDatabase = new HistoryDatabase(join(userData, "history.db"));
  diagnosticLog = new DiagnosticLog(join(userData, "diagnostics.jsonl"));
  settings = await settingsStore.load();
  const catalogPath = resolveCatalogPath();
  if (!existsSync(catalogPath)) {
    console.error(
      "\n  ❌ 卡牌图鉴文件缺失！请先运行以下命令下载：\n" +
      "     npm run catalog:download\n" +
      "  或手动下载后放置到 assets/card-catalog.zhCN.json\n",
    );
    app.quit();
    return;
  }
  catalog = await CardCatalog.load(catalogPath);
  catalog.setLanguage(settings.language);
  historyDatabase.setCardCatalogVersion(catalog.version);

  if (!settings.guideDismissed) {
    powerLogConfig = await enablePowerLoggingInOptionsFile();
    writeDiagnostic("power_log.auto_config", powerLogConfig);
  }

  powerLogRuntime = new PowerLogRuntime({
    getSettings: () => settings,
    getCatalog: () => catalog,
    historyDatabase,
    onLogSourceChanged: () => analysisService.resetForLogChange(),
    onSnapshotChanged: (snapshot) => analysisService.onSnapshotChanged(snapshot),
    broadcastStatus,
    writeDiagnostic,
  });
  analysisService = new AnalysisService({
    getSettings: () => settings,
    saveSettings: async (nextSettings) => {
      settings = await settingsStore.save(nextSettings);
      return settings;
    },
    getSnapshot: () => powerLogRuntime.snapshot(),
    refreshCurrentLog: () => powerLogRuntime.refreshCurrentLog(),
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
  windowManager.createTray(toggleOverlay);
  registerIpcHandlers({
    refreshCurrentLog: () => powerLogRuntime.refreshCurrentLog(),
    getStatus,
    getActiveAgent: activeAgent,
    saveSettings,
    toggleOverlay,
    credentialStore,
    historyDatabase,
    analysisService,
    windowManager,
    diagnosticLogPath: diagnosticLog.path,
  });
  registerShortcuts();
  await powerLogRuntime.start();
  broadcastStatus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  powerLogRuntime?.dispose();
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
  await powerLogRuntime.start();
  setOverlayVisible(settings.overlayVisible);
  registerShortcuts();
  broadcastStatus();
  return getStatus();
}

function toggleOverlay(): AppStatus {
  const before = settings.overlayVisible;
  settings = { ...settings, overlayVisible: windowManager.toggleOverlayVisible() };
  void settingsStore.save(settings);
  writeDiagnostic("overlay.toggle", {
    before,
    after: settings.overlayVisible,
    windowExists: Boolean(windowManager["overlayWindow"]),
  });
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
    logStatus: powerLogRuntime.status(),
    catalog,
    snapshot: powerLogRuntime.snapshot(),
    analysis: analysisState.analysis,
    visualValidation: analysisState.visualValidation,
    busy: analysisState.busy,
    message: analysisState.message,
    powerLogConfig,
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
    apiUrl: agent.apiUrl,
    model: agent.model,
    format: agent.format,
    timeoutMs: agent.timeoutMs,
    maxCandidates: settings.maxCandidates,
    liveRecommendationsEnabled: settings.liveRecommendationsEnabled,
    liveRecommendationsRiskAccepted: Boolean(
      settings.liveRecommendationsRiskAcceptedAt,
    ),
  };
}

function activeAgent(): AgentProfile {
  return getActiveAgent(settings);
}

function broadcastStatus(): void {
  windowManager.broadcast(IPC.statusChanged, getStatus());
}

function resolveCatalogPath(): string {
  const developmentPath = join(app.getAppPath(), "assets", "card-catalog.zhCN.json");
  const packagedPath = join(process.resourcesPath, "assets", "card-catalog.zhCN.json");
  return existsSync(developmentPath) ? developmentPath : packagedPath;
}
