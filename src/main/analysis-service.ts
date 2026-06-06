import { dialog } from "electron";
import { AgentClient } from "../core/agent-client.js";
import { validateSnapshotForAnalysis } from "../core/analysis-validator.js";
import type { CardCatalog } from "../core/card-catalog.js";
import type {
  AnalysisResult,
  AppSettings,
  AppStatus,
  AgentProfile,
  GameStateSnapshot,
  VisualValidationReport,
} from "../shared/types.js";
import { snapshotSummary } from "./analysis-diagnostics.js";
import { delay } from "./analysis-timing.js";
import type { CredentialStore } from "./credential-store.js";
import { captureHearthstoneWindow } from "./hearthstone-window-capture.js";
import type { HistoryDatabase } from "./history-database.js";
import { VisualValidator } from "./visual-validator.js";
import type { WindowManager } from "./window-manager.js";

type AnalysisSource = "manual" | "auto";

interface AnalysisServiceDependencies {
  getSettings(): AppSettings;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  getSnapshot(): GameStateSnapshot | undefined;
  refreshCurrentLog(): Promise<void>;
  getCatalog(): CardCatalog;
  credentialStore: CredentialStore;
  historyDatabase: HistoryDatabase;
  windowManager: WindowManager;
  getStatus(): AppStatus;
  broadcastStatus(): void;
  writeDiagnostic(event: string, data?: Record<string, unknown>): void;
}

export interface AnalysisServiceState {
  analysis?: AnalysisResult;
  visualValidation?: VisualValidationReport;
  busy: boolean;
  message?: string;
}

const AUTO_ANALYZE_STABLE_MS = 1_200;
const MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS = 2_500;
const ANALYSIS_SETTLE_POLL_MS = 250;
const VISUAL_SNAPSHOT_RETRY_LIMIT = 1;

export class AnalysisService {
  private currentAnalysis: AnalysisResult | undefined;
  private visualValidation: VisualValidationReport | undefined;
  private busy = false;
  private statusMessage: string | undefined;
  private lastAutoAnalyzedRevision: string | undefined;
  private pendingAutoAnalyzeTimer: NodeJS.Timeout | undefined;
  private pendingAutoAnalyzeRevision: string | undefined;
  private lastAgentRequestBody: unknown | undefined;
  private analysisAbortController: AbortController | undefined;

  constructor(private readonly deps: AnalysisServiceDependencies) {}

  state(): AnalysisServiceState {
    return {
      analysis: this.currentAnalysis,
      visualValidation: this.visualValidation,
      busy: this.busy,
      message: this.statusMessage,
    };
  }

  getLastAgentRequest(): unknown {
    return this.lastAgentRequestBody;
  }

  resetForLogChange(): void {
    this.currentAnalysis = undefined;
    this.visualValidation = undefined;
    this.clearPendingAutoAnalyze();
  }

  onSnapshotChanged(snapshot: GameStateSnapshot): void {
    if (this.currentAnalysis && this.currentAnalysis.snapshotRevision !== snapshot.revision) {
      this.currentAnalysis = { ...this.currentAnalysis, stale: true };
    }
    this.visualValidation = undefined;
    this.scheduleAutoAnalyze(snapshot);
  }

  stopAnalysis(): AppStatus {
    this.analysisAbortController?.abort();
    this.statusMessage = "用户取消了分析。";
    this.deps.broadcastStatus();
    return this.deps.getStatus();
  }

  dispose(): void {
    this.clearPendingAutoAnalyze();
    this.analysisAbortController?.abort();
  }

  async testConnection(): Promise<AppStatus> {
    if (this.busy) {
      return this.deps.getStatus();
    }
    this.busy = true;
    this.statusMessage = "正在测试 Agent 连接…";
    this.deps.broadcastStatus();
    this.writeDiagnostic("agent.connection_test.start", {
      settings: this.diagnosticSettings(),
    });

    try {
      let agent = this.activeAgent();
      let apiKey = await this.deps.credentialStore.getApiKey(agent.id);
      if (!apiKey) {
        const fallback = await this.chooseFallbackAgent(agent, "尚未配置 Agent API Key。");
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
          winRateEstimationEnabled: this.deps.getSettings().winRateEstimationEnabled,
        },
        apiKey,
        this.deps.getCatalog(),
        (event) => this.diagnosticAgentEvent(event),
      );
      const message = await client.testConnection();
      this.statusMessage = `Agent 连接测试通过：${message}`;
      this.writeDiagnostic("agent.connection_test.ok", { message });
    } catch (error) {
      this.statusMessage =
        error instanceof Error ? error.message : "Agent 连接测试失败。";
      this.writeDiagnostic("agent.connection_test.failed", {
        error: this.statusMessage,
      });
    } finally {
      this.busy = false;
      this.deps.broadcastStatus();
    }
    return this.deps.getStatus();
  }

  async analyze(source: AnalysisSource = "manual"): Promise<AppStatus> {
    if (this.busy) {
      return this.deps.getStatus();
    }
    if (source === "manual") {
      this.clearPendingAutoAnalyze();
    }
    const analysisStartedAt = Date.now();
    this.analysisAbortController = new AbortController();
    const cancelSignal = this.analysisAbortController.signal;
    this.busy = true;
    this.statusMessage = "正在读取并校验当前局面…";
    this.deps.broadcastStatus();
    this.writeDiagnostic("analysis.start", {
      settings: this.diagnosticSettings(),
    });

    try {
      this.assertLiveRecommendationsEnabled();
      const snapshot = await this.prepareSnapshotForAnalysis(source, cancelSignal);

      cancelSignal.throwIfAborted();

      const result = this.deps.getSettings().multiAgentCompareEnabled
        ? await this.runMultiAgentComparison(snapshot, analysisStartedAt, cancelSignal)
        : await this.runSingleAgentAnalysis(snapshot, analysisStartedAt, cancelSignal);

      const latestSnapshot = this.deps.getSnapshot();
      if (!latestSnapshot || latestSnapshot.revision !== result.snapshotRevision) {
        this.currentAnalysis = {
          ...result,
          stale: true,
          warnings: [
            ...result.warnings,
            "局面已发生变化，本次建议基于旧快照，仅供回看。",
          ],
        };
        this.deps.historyDatabase.saveAnalysis(this.currentAnalysis);
        this.statusMessage = "局面已发生变化，本次建议已显示为过期。";
        this.writeDiagnostic("analysis.completed_stale", {
          snapshotRevision: result.snapshotRevision,
          currentRevision: latestSnapshot?.revision,
          candidateCount: result.candidates.length,
        });
        return this.deps.getStatus();
      }
      this.currentAnalysis = result;
      this.deps.historyDatabase.saveAnalysis(result);
      this.statusMessage = "分析完成。";
      this.writeDiagnostic("analysis.completed", {
        snapshotRevision: result.snapshotRevision,
        candidateCount: result.candidates.length,
        summary: result.summary,
        warnings: result.warnings,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        this.statusMessage = "用户取消了分析。";
      } else {
        this.statusMessage = error instanceof Error ? error.message : "分析失败。";
      }
      this.writeDiagnostic("analysis.failed", {
        error: this.statusMessage,
      });
    } finally {
      this.busy = false;
      this.analysisAbortController = undefined;
      this.deps.broadcastStatus();
      if (source === "auto") {
        this.scheduleAutoAnalyze(this.deps.getSnapshot());
      }
    }
    return this.deps.getStatus();
  }

  private scheduleAutoAnalyze(snapshot: GameStateSnapshot | undefined): void {
    this.clearPendingAutoAnalyze();
    if (!snapshot || !this.shouldAutoAnalyzeSnapshot(snapshot)) {
      this.pendingAutoAnalyzeRevision = undefined;
      return;
    }

    this.pendingAutoAnalyzeRevision = snapshot.revision;
    this.pendingAutoAnalyzeTimer = setTimeout(() => {
      this.pendingAutoAnalyzeTimer = undefined;
      const latest = this.deps.getSnapshot();
      if (
        !latest ||
        latest.revision !== this.pendingAutoAnalyzeRevision ||
        !this.shouldAutoAnalyzeSnapshot(latest)
      ) {
        return;
      }
      this.lastAutoAnalyzedRevision = latest.revision;
      void this.analyze("auto");
    }, AUTO_ANALYZE_STABLE_MS);
  }

  private shouldAutoAnalyzeSnapshot(snapshot: GameStateSnapshot): boolean {
    const settings = this.deps.getSettings();
    return Boolean(
      settings.autoAnalyze &&
        snapshot.activePlayer === "self" &&
        !snapshot.animationPending &&
        snapshot.revision !== this.lastAutoAnalyzedRevision &&
        !this.busy &&
        settings.liveRecommendationsEnabled &&
        settings.liveRecommendationsRiskAcceptedAt,
    );
  }

  private clearPendingAutoAnalyze(): void {
    if (this.pendingAutoAnalyzeTimer) {
      clearTimeout(this.pendingAutoAnalyzeTimer);
      this.pendingAutoAnalyzeTimer = undefined;
    }
    this.pendingAutoAnalyzeRevision = undefined;
  }

  private async prepareSnapshotForAnalysis(
    source: AnalysisSource,
    signal: AbortSignal,
  ): Promise<GameStateSnapshot> {
    for (let attempt = 0; attempt <= VISUAL_SNAPSHOT_RETRY_LIMIT; attempt += 1) {
      const snapshot = await this.readSnapshotForAnalysis(source, signal);
      this.writeDiagnostic("analysis.snapshot", snapshotSummary(snapshot));
      signal.throwIfAborted();
      const snapshotReport = validateSnapshotForAnalysis(snapshot, this.deps.getCatalog());
      if (!snapshotReport.ok) {
        this.writeDiagnostic("analysis.snapshot_rejected", {
          errors: snapshotReport.errors,
          warnings: snapshotReport.warnings,
        });
        throw new Error(snapshotReport.errors.join("；"));
      }

      signal.throwIfAborted();
      const screenshot = await captureHearthstoneWindow();
      this.visualValidation = new VisualValidator().validate(
        screenshot,
        snapshot,
        this.deps.getCatalog(),
      );
      this.writeDiagnostic("analysis.visual_validation", {
        ok: this.visualValidation.ok,
        errors: this.visualValidation.errors,
        warnings: this.visualValidation.warnings,
        resolution: this.visualValidation.resolution,
        matchedEntityIds: this.visualValidation.matchedEntityIds,
      });
      if (!this.visualValidation.ok) {
        throw new Error(this.visualValidation.errors.join("；"));
      }
      if (this.deps.getSnapshot()?.revision === snapshot.revision) {
        return snapshot;
      }
      if (attempt < VISUAL_SNAPSHOT_RETRY_LIMIT) {
        this.writeDiagnostic("analysis.snapshot_changed_retry", {
          requestedRevision: snapshot.revision,
          currentRevision: this.deps.getSnapshot()?.revision,
        });
        this.statusMessage = "局面刚发生变化，正在重新读取…";
        this.deps.broadcastStatus();
        await delay(ANALYSIS_SETTLE_POLL_MS, signal);
        continue;
      }
      throw new Error("视觉校验期间局面已发生变化，请重新分析。");
    }
    throw new Error("无法读取稳定局面，请稍后重试。");
  }

  private async readSnapshotForAnalysis(
    source: AnalysisSource,
    signal: AbortSignal,
  ): Promise<GameStateSnapshot> {
    await this.deps.refreshCurrentLog();
    const snapshot = this.deps.getSnapshot();
    if (!snapshot) {
      throw new Error("尚未从 Power.log 读取到有效局面。");
    }
    if (source === "manual" && snapshot.animationPending) {
      const deadline = Date.now() + MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS;
      this.writeDiagnostic("analysis.wait_for_stable_snapshot", {
        revision: snapshot.revision,
        timeoutMs: MANUAL_ANALYSIS_SETTLE_TIMEOUT_MS,
      });
      this.statusMessage = "检测到动画或日志事件，正在等待局面稳定…";
      this.deps.broadcastStatus();
      while (this.deps.getSnapshot()?.animationPending && Date.now() < deadline) {
        await delay(ANALYSIS_SETTLE_POLL_MS, signal);
        signal.throwIfAborted();
        await this.deps.refreshCurrentLog();
      }
      this.statusMessage = "正在读取并校验当前局面…";
      this.deps.broadcastStatus();
    }
    const latest = this.deps.getSnapshot();
    if (!latest) {
      throw new Error("尚未从 Power.log 读取到有效局面。");
    }
    return latest;
  }

  private async requestAnalysisWithFallback({
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
      return await this.requestAnalysisFromAgent(agent, apiKey, snapshot, timeoutMs, signal);
    } catch (error) {
      const originalMessage =
        error instanceof Error ? error.message : `${agent.name} 分析失败。`;
      const fallback = await this.chooseFallbackAgent(agent, originalMessage);
      if (!fallback) {
        throw error;
      }
      this.statusMessage = `正在切换到 ${fallback.name} 重新分析…`;
      this.deps.broadcastStatus();
      return this.requestAnalysisFromAgent(
        fallback,
        fallback.apiKey,
        snapshot,
        timeoutMs,
        signal,
      );
    }
  }

  private async requestAnalysisFromAgent(
    agent: AgentProfile,
    apiKey: string,
    snapshot: GameStateSnapshot,
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const settings = this.deps.getSettings();
    const client = new AgentClient(
      {
        baseUrl: agent.baseUrl,
        model: agent.model,
        transport: agent.transport,
        timeoutMs,
        winRateEstimationEnabled: settings.winRateEstimationEnabled,
      },
      apiKey,
      this.deps.getCatalog(),
      (event) => this.diagnosticAgentEvent(event),
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

  private async runSingleAgentAnalysis(
    snapshot: GameStateSnapshot,
    analysisStartedAt: number,
    cancelSignal: AbortSignal,
  ): Promise<AnalysisResult> {
    let agent = this.activeAgent();
    let apiKey = await this.deps.credentialStore.getApiKey(agent.id);
    if (!apiKey) {
      const fallback = await this.chooseFallbackAgent(agent, "尚未配置 Agent API Key。");
      if (!fallback) throw new Error("尚未配置 Agent API Key。");
      agent = fallback;
      apiKey = fallback.apiKey;
    }
    if (!agent.model) throw new Error("尚未配置 Agent 模型名称。");
    this.statusMessage = `正在请求 ${agent.name} 分析…`;
    this.deps.broadcastStatus();
    const elapsed = Date.now() - analysisStartedAt;
    const remainingMs = agent.timeoutMs - elapsed;
    if (remainingMs < 1_000) {
      throw new Error(`分析准备阶段已超过 ${agent.timeoutMs}ms 总预算。`);
    }
    return this.requestAnalysisWithFallback({
      agent,
      apiKey,
      snapshot,
      timeoutMs: remainingMs,
      signal: cancelSignal,
    });
  }

  private async runMultiAgentComparison(
    snapshot: GameStateSnapshot,
    analysisStartedAt: number,
    cancelSignal: AbortSignal,
  ): Promise<AnalysisResult> {
    const settings = this.deps.getSettings();
    const eligible: Array<AgentProfile & { apiKey: string }> = [];
    for (const agent of settings.agents) {
      if (!agent.model) continue;
      const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
      if (apiKey) eligible.push({ ...agent, apiKey });
    }
    if (eligible.length === 0) {
      return this.runSingleAgentAnalysis(snapshot, analysisStartedAt, cancelSignal);
    }
    this.statusMessage = `正在并行请求 ${eligible.length} 个 Agent 分析…`;
    this.deps.broadcastStatus();

    const elapsed = Date.now() - analysisStartedAt;
    const perAgentMs = Math.max(4_000, settings.agents[0]?.timeoutMs ?? 8_000) - elapsed;

    const results = await Promise.allSettled(
      eligible.map((agent) =>
        this.requestAnalysisFromAgent(agent, agent.apiKey, snapshot, Math.max(2_000, perAgentMs), cancelSignal),
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
    const mergedCandidates = primary.result.candidates.map((candidate) => ({
      ...candidate,
      rationale: `[${primary.agentName}] ${candidate.rationale}`,
    }));
    const extraCandidates = successes.slice(1).flatMap((success) =>
      success.result.candidates.map((candidate) => ({
        ...candidate,
        rank: mergedCandidates.length + candidate.rank,
        rationale: `[${success.agentName}] ${candidate.rationale}`,
      })),
    );
    mergedCandidates.push(...extraCandidates);
    mergedCandidates.sort((a, b) => b.confidence - a.confidence);
    mergedCandidates.forEach((candidate, index) => {
      candidate.rank = index + 1;
    });

    const warnings: string[] = [...primary.result.warnings];
    for (const success of successes.slice(1)) {
      warnings.push(...success.result.warnings);
    }
    warnings.push(...errors.map((error) => `Agent 对比：${error}`));

    return {
      snapshotRevision: primary.result.snapshotRevision,
      summary: `多 Agent 对比 · ${successes.length} 个成功${errors.length > 0 ? ` · ${errors.length} 个失败` : ""}`,
      candidates: mergedCandidates.slice(0, settings.maxCandidates * successes.length),
      warnings,
      createdAt: new Date().toISOString(),
    };
  }

  private async chooseFallbackAgent(
    failedAgent: AgentProfile,
    reason: string,
  ): Promise<(AgentProfile & { apiKey: string }) | undefined> {
    const settings = this.deps.getSettings();
    const candidates: Array<AgentProfile & { apiKey: string }> = [];
    for (const agent of settings.agents) {
      if (agent.id === failedAgent.id || !agent.model) {
        continue;
      }
      const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
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
    const mainWindow = this.deps.windowManager.getMainWindow();
    const response = mainWindow
      ? await dialog.showMessageBox(mainWindow, dialogOptions)
      : await dialog.showMessageBox(dialogOptions);
    if (response.response !== 0) {
      return undefined;
    }
    await this.deps.saveSettings({
      ...settings,
      activeAgentId: fallback.id,
    });
    return fallback;
  }

  private assertLiveRecommendationsEnabled(): void {
    const settings = this.deps.getSettings();
    if (
      !settings.liveRecommendationsEnabled ||
      !settings.liveRecommendationsRiskAcceptedAt
    ) {
      throw new Error("正式对局实时建议默认禁用，请先在设置页确认已获授权并接受风险。");
    }
  }

  private diagnosticAgentEvent({
    event,
    data,
  }: {
    event: string;
    data?: Record<string, unknown>;
  }): void {
    if (event === "agent.analysis.request_payload") {
      this.lastAgentRequestBody = data?.body;
    }
    this.writeDiagnostic(event, data ?? {});
  }

  private writeDiagnostic(event: string, data: Record<string, unknown> = {}): void {
    this.deps.writeDiagnostic(event, data);
  }

  private diagnosticSettings() {
    const settings = this.deps.getSettings();
    const agent = this.activeAgent();
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

  private activeAgent(): AgentProfile {
    const settings = this.deps.getSettings();
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
}
