import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
} from "electron";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { AgentClient } from "../core/agent-client.js";
import { validateSnapshotForAnalysis } from "../core/analysis-validator.js";
import { CardCatalog } from "../core/card-catalog.js";
import { PowerLogParser } from "../core/power-log-parser.js";
import { PowerLogWatcher } from "../core/power-log-watcher.js";
import { enrichSnapshotWithCatalog } from "../core/snapshot-enricher.js";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  AgentProfile,
  GameStateSnapshot,
  LogStatus,
  VisualValidationReport,
} from "../shared/types.js";
import { CredentialStore } from "./credential-store.js";
import { DiagnosticLog } from "./diagnostic-log.js";
import { HistoryDatabase } from "./history-database.js";
import {
  expandEnvironmentVariables,
  inspectPowerLog,
} from "./power-log-locator.js";
import { SettingsStore } from "./settings-store.js";
import { VisualValidator } from "./visual-validator.js";

let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let settingsStore: SettingsStore;
let credentialStore: CredentialStore;
let historyDatabase: HistoryDatabase;
let diagnosticLog: DiagnosticLog;
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
let lastAutoAnalyzedRevision: string | undefined;
let pendingAutoAnalyzeTimer: NodeJS.Timeout | undefined;
let pendingAutoAnalyzeRevision: string | undefined;
let lastAgentRequestBody: unknown | undefined;
let analysisAbortController: AbortController | undefined;

const AUTO_ANALYZE_STABLE_MS = 1_200;
const MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS = 2_500;
const ANALYSIS_SETTLE_POLL_MS = 250;
const VISUAL_SNAPSHOT_RETRY_LIMIT = 1;

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
  statusChanged: "app:status-changed",
  getLastAgentRequest: "app:get-last-agent-request",
  stopAnalysis: "app:stop-analysis",
  windowMinimize: "app:window-minimize",
  windowMaximize: "app:window-maximize",
  windowClose: "app:window-close",
} as const;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}
app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
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
  writeDiagnostic("app.ready", {
    userData,
    catalogVersion: catalog.version,
    catalogSize: catalog.size(),
    settings: diagnosticSettings(),
  });

  Menu.setApplicationMenu(null);
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
  if (pendingAutoAnalyzeTimer) {
    clearTimeout(pendingAutoAnalyzeTimer);
  }
  globalShortcut.unregisterAll();
  historyDatabase?.close();
});

function createWindows(): void {
  const preload = join(import.meta.dirname, "preload.cjs");
  const rendererUrl = process.env.VITE_DEV_SERVER_URL;
  const rendererFile = join(app.getAppPath(), "dist", "renderer", "index.html");

  mainWindow = new BrowserWindow({
    width: 960,
    height: 700,
    minWidth: 820,
    minHeight: 640,
    frame: false,
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
    height: 540,
    x: mainWindow.getPosition()[0] - 420,
    y: mainWindow.getPosition()[1] + 30,
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
  globalShortcut.unregisterAll();
  try {
    globalShortcut.register(settings.hotkeys.analyze, () => void analyzeCurrentState("manual"));
  } catch {
    globalShortcut.register("CommandOrControl+Shift+A", () => void analyzeCurrentState("manual"));
  }
  try {
    globalShortcut.register(settings.hotkeys.toggleOverlay, () => toggleOverlay());
  } catch {
    globalShortcut.register("CommandOrControl+Shift+O", () => toggleOverlay());
  }
}

function registerIpc(): void {
  ipcMain.handle(IPC.getStatus, async () => {
    await refreshCurrentLog();
    return getStatus();
  });
  ipcMain.handle(IPC.hasApiKey, (_event, agentId?: string) =>
    credentialStore.getApiKey(agentId ?? activeAgent().id).then(Boolean),
  );
  ipcMain.handle(IPC.listHistory, () => historyDatabase.listAnalyses());
  ipcMain.handle(IPC.getLastAgentRequest, () => lastAgentRequestBody);
  ipcMain.handle(IPC.stopAnalysis, () => {
    analysisAbortController?.abort();
    statusMessage = "用户取消了分析。";
    broadcastStatus();
    return getStatus();
  });
  ipcMain.handle(IPC.analyze, () => analyzeCurrentState("manual"));
  ipcMain.handle(IPC.testAgentConnection, () => testAgentConnection());
  ipcMain.handle(IPC.toggleOverlay, () => toggleOverlay());
  ipcMain.handle(IPC.showMainWindow, () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  ipcMain.handle(IPC.windowMinimize, () => mainWindow?.minimize());
  ipcMain.handle(IPC.windowMaximize, () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
  });
  ipcMain.handle(IPC.windowClose, () => mainWindow?.close());
  ipcMain.handle(IPC.setApiKey, async (_event, apiKey: string, agentId?: string) => {
    await credentialStore.setApiKey(apiKey, agentId ?? activeAgent().id);
    return Boolean(apiKey.trim());
  });
  ipcMain.handle(
    IPC.saveSettings,
    async (_event, nextSettings: AppSettings) => {
      catalog.setLanguage(nextSettings.language);
      settings = await settingsStore.save(nextSettings);
      await startWatcher();
      setOverlayVisible(settings.overlayVisible);
      registerShortcuts();
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
  const inspection = await inspectPowerLog(settings.powerLogPath);
  const location = inspection.location;
  const path = location?.path ?? inspection.expectedPath;
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
    if (currentAnalysis && currentAnalysis.snapshotRevision !== next.revision) {
      currentAnalysis = { ...currentAnalysis, stale: true };
    }
    visualValidation = undefined;
    currentSnapshot = next;
    historyDatabase.saveSnapshot(next);
    broadcastStatus();
    scheduleAutoAnalyze(next);
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

async function testAgentConnection(): Promise<AppStatus> {
  if (busy) {
    return getStatus();
  }
  busy = true;
  statusMessage = "正在测试 Agent 连接…";
  broadcastStatus();
  writeDiagnostic("agent.connection_test.start", {
    settings: diagnosticSettings(),
  });

  try {
    let agent = activeAgent();
    let apiKey = await credentialStore.getApiKey(agent.id);
    if (!apiKey) {
      const fallback = await chooseFallbackAgent(agent, "尚未配置 Agent API Key。");
      if (!fallback) {
        throw new Error("尚未配置 Agent API Key。");
      }
      agent = fallback;
      apiKey = fallback.apiKey;
    }
    if (!agent.model) {
      throw new Error("尚未配置 Agent 模型名称。");
    }
    const client = new AgentClient(
      {
        baseUrl: agent.baseUrl,
        model: agent.model,
        transport: agent.transport,
        timeoutMs: agent.timeoutMs,
        winRateEstimationEnabled: settings.winRateEstimationEnabled,
      },
      apiKey,
      catalog,
      diagnosticAgentEvent,
    );
    const message = await client.testConnection();
    statusMessage = `Agent 连接测试通过：${message}`;
    writeDiagnostic("agent.connection_test.ok", { message });
  } catch (error) {
    statusMessage =
      error instanceof Error ? error.message : "Agent 连接测试失败。";
    writeDiagnostic("agent.connection_test.failed", {
      error: statusMessage,
    });
  } finally {
    busy = false;
    broadcastStatus();
  }
  return getStatus();
}

function scheduleAutoAnalyze(snapshot: GameStateSnapshot | undefined): void {
  if (pendingAutoAnalyzeTimer) {
    clearTimeout(pendingAutoAnalyzeTimer);
    pendingAutoAnalyzeTimer = undefined;
  }
  if (!snapshot || !shouldAutoAnalyzeSnapshot(snapshot)) {
    pendingAutoAnalyzeRevision = undefined;
    return;
  }

  pendingAutoAnalyzeRevision = snapshot.revision;
  pendingAutoAnalyzeTimer = setTimeout(() => {
    pendingAutoAnalyzeTimer = undefined;
    const latest = currentSnapshot;
    if (
      !latest ||
      latest.revision !== pendingAutoAnalyzeRevision ||
      !shouldAutoAnalyzeSnapshot(latest)
    ) {
      return;
    }
    lastAutoAnalyzedRevision = latest.revision;
    void analyzeCurrentState("auto");
  }, AUTO_ANALYZE_STABLE_MS);
}

function shouldAutoAnalyzeSnapshot(snapshot: GameStateSnapshot): boolean {
  return Boolean(
    settings.autoAnalyze &&
      snapshot.activePlayer === "self" &&
      !snapshot.animationPending &&
      snapshot.revision !== lastAutoAnalyzedRevision &&
      !busy &&
      settings.liveRecommendationsEnabled &&
      settings.liveRecommendationsRiskAcceptedAt,
  );
}

async function analyzeCurrentState(source: "manual" | "auto" = "manual"): Promise<AppStatus> {
  if (busy) {
    return getStatus();
  }
  if (source === "manual" && pendingAutoAnalyzeTimer) {
    clearTimeout(pendingAutoAnalyzeTimer);
    pendingAutoAnalyzeTimer = undefined;
    pendingAutoAnalyzeRevision = undefined;
  }
  const analysisStartedAt = Date.now();
  analysisAbortController = new AbortController();
  const cancelSignal = analysisAbortController.signal;
  busy = true;
  statusMessage = "正在读取并校验当前局面…";
  broadcastStatus();
  writeDiagnostic("analysis.start", {
    settings: diagnosticSettings(),
  });

  try {
    assertLiveRecommendationsEnabled();
    const snapshot = await prepareSnapshotForAnalysis(source, cancelSignal);

    cancelSignal.throwIfAborted();

    const result = settings.multiAgentCompareEnabled
      ? await runMultiAgentComparison(snapshot, analysisStartedAt, cancelSignal)
      : await runSingleAgentAnalysis(snapshot, analysisStartedAt, cancelSignal);

    const latestSnapshot = currentSnapshot;
    if (!latestSnapshot || latestSnapshot.revision !== result.snapshotRevision) {
      currentAnalysis = {
        ...result,
        stale: true,
        warnings: [
          ...result.warnings,
          "局面已发生变化，本次建议基于旧快照，仅供回看。",
        ],
      };
      historyDatabase.saveAnalysis(currentAnalysis);
      statusMessage = "局面已发生变化，本次建议已显示为过期。";
      writeDiagnostic("analysis.completed_stale", {
        snapshotRevision: result.snapshotRevision,
        currentRevision: latestSnapshot?.revision,
        candidateCount: result.candidates.length,
      });
      return getStatus();
    }
    currentAnalysis = result;
    historyDatabase.saveAnalysis(result);
    statusMessage = "分析完成。";
    writeDiagnostic("analysis.completed", {
      snapshotRevision: result.snapshotRevision,
      candidateCount: result.candidates.length,
      summary: result.summary,
      warnings: result.warnings,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      statusMessage = "用户取消了分析。";
    } else {
      statusMessage = error instanceof Error ? error.message : "分析失败。";
    }
    writeDiagnostic("analysis.failed", {
      error: statusMessage,
    });
  } finally {
    busy = false;
    analysisAbortController = undefined;
    broadcastStatus();
    if (source === "auto") {
      scheduleAutoAnalyze(currentSnapshot);
    }
  }
  return getStatus();
}

async function prepareSnapshotForAnalysis(
  source: "manual" | "auto",
  signal: AbortSignal,
): Promise<GameStateSnapshot> {
  for (let attempt = 0; attempt <= VISUAL_SNAPSHOT_RETRY_LIMIT; attempt += 1) {
    const snapshot = await readSnapshotForAnalysis(source, signal);
    writeDiagnostic("analysis.snapshot", snapshotSummary(snapshot));
    signal.throwIfAborted();
    const snapshotReport = validateSnapshotForAnalysis(snapshot, catalog);
    if (!snapshotReport.ok) {
      writeDiagnostic("analysis.snapshot_rejected", {
        errors: snapshotReport.errors,
        warnings: snapshotReport.warnings,
      });
      throw new Error(snapshotReport.errors.join("；"));
    }

    signal.throwIfAborted();
    const screenshot = await captureHearthstoneWindow();
    visualValidation = new VisualValidator().validate(
      screenshot,
      snapshot,
      catalog,
    );
    writeDiagnostic("analysis.visual_validation", {
      ok: visualValidation.ok,
      errors: visualValidation.errors,
      warnings: visualValidation.warnings,
      resolution: visualValidation.resolution,
      matchedEntityIds: visualValidation.matchedEntityIds,
    });
    if (!visualValidation.ok) {
      throw new Error(visualValidation.errors.join("；"));
    }
    if (currentSnapshot?.revision === snapshot.revision) {
      return snapshot;
    }
    if (attempt < VISUAL_SNAPSHOT_RETRY_LIMIT) {
      writeDiagnostic("analysis.snapshot_changed_retry", {
        requestedRevision: snapshot.revision,
        currentRevision: currentSnapshot?.revision,
      });
      statusMessage = "局面刚发生变化，正在重新读取…";
      broadcastStatus();
      await delay(ANALYSIS_SETTLE_POLL_MS, signal);
      continue;
    }
    throw new Error("视觉校验期间局面已发生变化，请重新分析。");
  }
  throw new Error("无法读取稳定局面，请稍后重试。");
}

async function readSnapshotForAnalysis(
  source: "manual" | "auto",
  signal: AbortSignal,
): Promise<GameStateSnapshot> {
  await refreshCurrentLog();
  if (!currentSnapshot) {
    throw new Error("尚未从 Power.log 读取到有效局面。");
  }
  if (source === "manual" && currentSnapshot.animationPending) {
    const deadline = Date.now() + MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS;
    writeDiagnostic("analysis.wait_for_stable_snapshot", {
      revision: currentSnapshot.revision,
      timeoutMs: MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS,
    });
    statusMessage = "检测到动画或日志事件，正在等待局面稳定…";
    broadcastStatus();
    while (currentSnapshot?.animationPending && Date.now() < deadline) {
      await delay(ANALYSIS_SETTLE_POLL_MS, signal);
      signal.throwIfAborted();
      await refreshCurrentLog();
    }
    statusMessage = "正在读取并校验当前局面…";
    broadcastStatus();
  }
  if (!currentSnapshot) {
    throw new Error("尚未从 Power.log 读取到有效局面。");
  }
  return currentSnapshot;
}

async function requestAnalysisWithFallback({
  agent,
  apiKey,
  snapshot,
  timeoutMs,
  signal,
}: {
  agent: AgentProfile;
  apiKey: string;
  snapshot: GameStateSnapshot;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<AnalysisResult> {
  try {
    return await requestAnalysisFromAgent(agent, apiKey, snapshot, timeoutMs, signal);
  } catch (error) {
    const originalMessage =
      error instanceof Error ? error.message : `${agent.name} 分析失败。`;
    const fallback = await chooseFallbackAgent(agent, originalMessage);
    if (!fallback) {
      throw error;
    }
    statusMessage = `正在切换到 ${fallback.name} 重新分析…`;
    broadcastStatus();
    return requestAnalysisFromAgent(
      fallback,
      fallback.apiKey,
      snapshot,
      timeoutMs,
      signal,
    );
  }
}

async function requestAnalysisFromAgent(
  agent: AgentProfile,
  apiKey: string,
  snapshot: GameStateSnapshot,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<AnalysisResult> {
  const client = new AgentClient(
    {
      baseUrl: agent.baseUrl,
      model: agent.model,
      transport: agent.transport,
      timeoutMs,
      winRateEstimationEnabled: settings.winRateEstimationEnabled,
    },
    apiKey,
    catalog,
    diagnosticAgentEvent,
  );
  return client.analyze(
    {
      snapshot,
      objective: "recommend-current-turn",
      maxCandidates: settings.maxCandidates,
    },
    signal,
  );
}

async function runSingleAgentAnalysis(
  snapshot: GameStateSnapshot,
  analysisStartedAt: number,
  cancelSignal: AbortSignal,
): Promise<AnalysisResult> {
  let agent = activeAgent();
  let apiKey = await credentialStore.getApiKey(agent.id);
  if (!apiKey) {
    const fallback = await chooseFallbackAgent(agent, "尚未配置 Agent API Key。");
    if (!fallback) throw new Error("尚未配置 Agent API Key。");
    agent = fallback;
    apiKey = fallback.apiKey;
  }
  if (!agent.model) throw new Error("尚未配置 Agent 模型名称。");
  statusMessage = `正在请求 ${agent.name} 分析…`;
  broadcastStatus();
  const elapsed = Date.now() - analysisStartedAt;
  const remainingMs = agent.timeoutMs - elapsed;
  if (remainingMs < 1_000) throw new Error(`分析准备阶段已超过 ${agent.timeoutMs}ms 总预算。`);
  return requestAnalysisWithFallback({ agent, apiKey, snapshot, timeoutMs: remainingMs, signal: cancelSignal });
}

async function runMultiAgentComparison(
  snapshot: GameStateSnapshot,
  analysisStartedAt: number,
  cancelSignal: AbortSignal,
): Promise<AnalysisResult> {
  const eligible: Array<AgentProfile & { apiKey: string }> = [];
  for (const agent of settings.agents) {
    if (!agent.model) continue;
    const apiKey = await credentialStore.getApiKey(agent.id);
    if (apiKey) eligible.push({ ...agent, apiKey });
  }
  if (eligible.length === 0) {
    return runSingleAgentAnalysis(snapshot, analysisStartedAt, cancelSignal);
  }
  statusMessage = `正在并行请求 ${eligible.length} 个 Agent 分析…`;
  broadcastStatus();

  const elapsed = Date.now() - analysisStartedAt;
  const perAgentMs = Math.max(4_000, settings.agents[0]?.timeoutMs ?? 8_000) - elapsed;

  const results = await Promise.allSettled(
    eligible.map((agent) =>
      requestAnalysisFromAgent(agent, agent.apiKey, snapshot, Math.max(2_000, perAgentMs), cancelSignal),
    ),
  );

  const successes: Array<{ agentName: string; result: AnalysisResult }> = [];
  const errors: string[] = [];

  for (const [index, settled] of results.entries()) {
    const agent = eligible[index]!;
    if (settled.status === "fulfilled") {
      successes.push({ agentName: agent.name, result: settled.value });
    } else {
      errors.push(`${agent.name}: ${settled.reason instanceof Error ? settled.reason.message : "失败"}`);
    }
  }

  if (successes.length === 0) {
    throw new Error(`所有 Agent 分析均失败：${errors.join("；")}`);
  }

  const primary = successes[0]!;
  const mergedCandidates = primary.result.candidates.map((c) => ({
    ...c,
    rationale: `[${primary.agentName}] ${c.rationale}`,
  }));
  const extraCandidates = successes.slice(1).flatMap((s) =>
    s.result.candidates.map((c) => ({
      ...c,
      rank: mergedCandidates.length + c.rank,
      rationale: `[${s.agentName}] ${c.rationale}`,
    })),
  );
  mergedCandidates.push(...extraCandidates);
  mergedCandidates.sort((a, b) => b.confidence - a.confidence);
  mergedCandidates.forEach((c, i) => { c.rank = i + 1; });

  const warnings: string[] = [...primary.result.warnings];
  for (const s of successes.slice(1)) {
    warnings.push(...s.result.warnings);
  }
  warnings.push(...errors.map((e) => `Agent 对比：${e}`));

  return {
    snapshotRevision: primary.result.snapshotRevision,
    summary: `多 Agent 对比 · ${successes.length} 个成功` + (errors.length > 0 ? ` · ${errors.length} 个失败` : ""),
    candidates: mergedCandidates.slice(0, settings.maxCandidates * successes.length),
    warnings,
    createdAt: new Date().toISOString(),
  };
}

async function chooseFallbackAgent(
  failedAgent: AgentProfile,
  reason: string,
): Promise<(AgentProfile & { apiKey: string }) | undefined> {
  const candidates: Array<AgentProfile & { apiKey: string }> = [];
  for (const agent of settings.agents) {
    if (agent.id === failedAgent.id || !agent.model) {
      continue;
    }
    const apiKey = await credentialStore.getApiKey(agent.id);
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
  const response = mainWindow
    ? await dialog.showMessageBox(mainWindow, dialogOptions)
    : await dialog.showMessageBox(dialogOptions);
  if (response.response !== 0) {
    return undefined;
  }
  settings = await settingsStore.save({
    ...settings,
    activeAgentId: fallback.id,
  });
  return fallback;
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

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
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

function diagnosticAgentEvent({
  event,
  data,
}: {
  event: string;
  data?: Record<string, unknown>;
}): void {
  if (event === "agent.analysis.request_payload") {
    lastAgentRequestBody = data?.body;
  }
  writeDiagnostic(event, data ?? {});
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

function snapshotSummary(snapshot: GameStateSnapshot) {
  return {
    revision: snapshot.revision,
    gameMode: snapshot.gameMode,
    gameType: snapshot.gameType,
    turn: snapshot.turn,
    activePlayer: snapshot.activePlayer,
    animationPending: snapshot.animationPending,
    self: {
      hero: snapshot.self.hero.name ?? snapshot.self.hero.cardId,
      health: snapshot.self.hero.health,
      mana: `${snapshot.self.mana}/${snapshot.self.maxMana}`,
      hand: snapshot.self.hand.map((card) => ({
        entityId: card.entityId,
        cardId: card.cardId,
        name: card.name,
        cost: card.cost,
      })),
      board: snapshot.self.board.map(cardSummary),
    },
    opponent: {
      hero: snapshot.opponent.hero.name ?? snapshot.opponent.hero.cardId,
      health: snapshot.opponent.hero.health,
      handCount: snapshot.opponent.handCount,
      board: snapshot.opponent.board.map(cardSummary),
    },
    uncertainties: snapshot.uncertainties,
  };
}

function cardSummary(card: GameStateSnapshot["self"]["board"][number]) {
  return {
    entityId: card.entityId,
    cardId: card.cardId,
    name: card.name,
    cost: card.cost,
    attack: card.attack,
    health: card.health,
    damage: card.damage,
    exhausted: card.exhausted,
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
