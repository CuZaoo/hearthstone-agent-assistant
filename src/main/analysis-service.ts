import { AgentClient } from "../core/agent-client.js";
import { validateSnapshotForAnalysis } from "../core/analysis-validator.js";
import type { CardCatalog } from "../core/card-catalog.js";
import type {
  AgentProfile,
  AnalysisResult,
  AppSettings,
  AppStatus,
  GameStateSnapshot,
  VisualValidationReport,
} from "../shared/types.js";
import { getActiveAgent } from "../shared/settings-model.js";
import { AgentAnalysisRunner } from "./agent-analysis-runner.js";
import { AgentFallbackSelector } from "./agent-fallback-selector.js";
import { snapshotSummary } from "./analysis-diagnostics.js";
import { delay } from "./analysis-timing.js";
import type { CredentialStore } from "./credential-store.js";
import { captureHearthstoneWindow } from "./hearthstone-window-capture.js";
import type { HistoryDatabase } from "./history-database.js";
import { VisualValidator } from "./visual-validator.js";
import type { WindowManager } from "./window-manager.js";
import { recordAdoption } from "./adoption-tracker.js";

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
  private lastAgentResponseText: string | undefined;
  private analysisAbortController: AbortController | undefined;
  private pendingAdoptionAnalysis: {
    snapshot: GameStateSnapshot;
    result: AnalysisResult;
    agent: AgentProfile;
    analysisId: number;
  } | undefined;
  private readonly agentSelector: AgentFallbackSelector;
  private readonly agentRunner: AgentAnalysisRunner;

  constructor(private readonly deps: AnalysisServiceDependencies) {
    this.agentSelector = new AgentFallbackSelector({
      getSettings: deps.getSettings,
      saveSettings: deps.saveSettings,
      credentialStore: deps.credentialStore,
      windowManager: deps.windowManager,
    });
    this.agentRunner = new AgentAnalysisRunner({
      getSettings: deps.getSettings,
      getCatalog: deps.getCatalog,
      credentialStore: deps.credentialStore,
      fallbackSelector: this.agentSelector,
      setStatusMessage: (message) => {
        this.statusMessage = message;
        this.deps.broadcastStatus();
      },
      diagnosticAgentEvent: (event) => this.diagnosticAgentEvent(event),
    });

    try {
      const latest = deps.historyDatabase.listAnalyses(1)[0];
      if (latest) {
        this.currentAnalysis = { ...latest, stale: true };
      }
    } catch {
      // no history yet
    }
  }

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

  getLastAgentResponse(): string | undefined {
    return this.lastAgentResponseText;
  }

  resetForLogChange(): void {
    this.currentAnalysis = undefined;
    this.visualValidation = undefined;
    this.pendingAdoptionAnalysis = undefined;
    this.clearPendingAutoAnalyze();
  }

  onSnapshotChanged(snapshot: GameStateSnapshot): void {
    if (this.currentAnalysis && this.currentAnalysis.snapshotRevision !== snapshot.revision) {
      this.currentAnalysis = { ...this.currentAnalysis, stale: true };
    }
    this.visualValidation = undefined;

    if (this.pendingAdoptionAnalysis) {
      const { snapshot: beforeSnapshot, result, agent, analysisId } = this.pendingAdoptionAnalysis;
      if (
        result.snapshotRevision !== snapshot.revision &&
        beforeSnapshot.activePlayer === "self" &&
        snapshot.activePlayer !== "self"
      ) {
        recordAdoption(
          this.deps.historyDatabase,
          result,
          analysisId,
          agent.id,
          agent.name,
          beforeSnapshot.turn,
          beforeSnapshot,
          snapshot,
        );
        this.pendingAdoptionAnalysis = undefined;
      }
    }

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
      const agent = this.agentSelector.activeAgent();
      const selectedAgent = await this.agentSelector.getApiKeyOrFallback(agent);
      if (!selectedAgent.model) {
        throw new Error("尚未配置 Agent 模型名称。");
      }
      const client = new AgentClient(
        {
          apiUrl: selectedAgent.apiUrl,
          model: selectedAgent.model,
          format: selectedAgent.format,
          timeoutMs: selectedAgent.timeoutMs,
          winRateEstimationEnabled: this.deps.getSettings().winRateEstimationEnabled,
        },
        selectedAgent.apiKey,
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

      const result = await this.agentRunner.run(
        snapshot,
        analysisStartedAt,
        cancelSignal,
      );

      const latestSnapshot = this.deps.getSnapshot();
      if (!latestSnapshot || latestSnapshot.revision !== result.snapshotRevision) {
        this.currentAnalysis = {
          ...result,
          gameId: snapshot.gameId,
          turn: snapshot.turn,
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
      this.currentAnalysis = { ...result, gameId: snapshot.gameId, turn: snapshot.turn };
      const analysisDbId = this.deps.historyDatabase.saveAnalysis(this.currentAnalysis);
      if (snapshot.activePlayer === "self") {
        const agent = getActiveAgent(this.deps.getSettings());
        this.pendingAdoptionAnalysis = { snapshot: snapshot, result, agent, analysisId: analysisDbId };
      }
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
      throw new Error("尚未从对局日志读取到有效局面。");
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
      throw new Error("尚未从对局日志读取到有效局面。");
    }
    return latest;
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
    if (event === "agent.analysis.raw_response") {
      this.lastAgentResponseText = data?.responseText as string | undefined;
    }
    this.writeDiagnostic(event, data ?? {});
  }

  private writeDiagnostic(event: string, data: Record<string, unknown> = {}): void {
    this.deps.writeDiagnostic(event, data);
  }

  private diagnosticSettings() {
    const settings = this.deps.getSettings();
    const agent = this.agentSelector.activeAgent();
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
}
