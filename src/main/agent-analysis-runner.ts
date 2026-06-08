import { AgentClient } from "../core/agent-client.js";
import type { CardCatalog } from "../core/card-catalog.js";
import type {
  AgentProfile,
  AnalysisResult,
  AppSettings,
  GameStateSnapshot,
} from "../shared/types.js";
import type { CredentialStore } from "./credential-store.js";
import type {
  AgentFallbackSelector,
  AgentWithApiKey,
} from "./agent-fallback-selector.js";

interface AgentAnalysisRunnerDependencies {
  getSettings(): AppSettings;
  getCatalog(): CardCatalog;
  credentialStore: CredentialStore;
  fallbackSelector: AgentFallbackSelector;
  setStatusMessage(message: string): void;
  diagnosticAgentEvent(event: { event: string; data?: Record<string, unknown> }): void;
}

export class AgentAnalysisRunner {
  constructor(private readonly deps: AgentAnalysisRunnerDependencies) {}

  async run(
    snapshot: GameStateSnapshot,
    analysisStartedAt: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    return this.deps.getSettings().multiAgentCompareEnabled
      ? this.runMultiAgentComparison(snapshot, analysisStartedAt, signal)
      : this.runSingleAgentAnalysis(snapshot, analysisStartedAt, signal);
  }

  private async runSingleAgentAnalysis(
    snapshot: GameStateSnapshot,
    analysisStartedAt: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const selected = await this.resolveSelectedAgent();
    this.deps.setStatusMessage(`正在请求 ${selected.name} 分析…`);
    const elapsed = Date.now() - analysisStartedAt;
    const remainingMs = selected.timeoutMs - elapsed;
    if (remainingMs < 1_000) {
      throw new Error(`分析准备阶段已超过 ${selected.timeoutMs}ms 总预算。`);
    }
    return this.requestAnalysisWithFallback({
      agent: selected,
      apiKey: selected.apiKey,
      snapshot,
      timeoutMs: remainingMs,
      signal,
    });
  }

  private async runMultiAgentComparison(
    snapshot: GameStateSnapshot,
    analysisStartedAt: number,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    const settings = this.deps.getSettings();
    const eligible: AgentWithApiKey[] = [];
    for (const agent of settings.agents) {
      if (!agent.model) continue;
      const apiKey = await this.deps.credentialStore.getApiKey(agent.id);
      eligible.push({ ...agent, apiKey: apiKey ?? "" });
    }
    if (eligible.length === 0) {
      return this.runSingleAgentAnalysis(snapshot, analysisStartedAt, signal);
    }
    this.deps.setStatusMessage(`正在并行请求 ${eligible.length} 个 Agent 分析…`);

    const elapsed = Date.now() - analysisStartedAt;
    const perAgentMs = Math.max(4_000, settings.agents[0]?.timeoutMs ?? 8_000) - elapsed;

    const results = await Promise.allSettled(
      eligible.map((agent) =>
        this.requestAnalysisFromAgent(agent, agent.apiKey, snapshot, Math.max(2_000, perAgentMs), signal),
      ),
    );

    return mergeAgentResults(results, eligible, settings.maxCandidates);
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
      const fallback = await this.deps.fallbackSelector.chooseFallbackAgent(
        agent,
        originalMessage,
      );
      if (!fallback) {
        throw error;
      }
      this.deps.setStatusMessage(`正在切换到 ${fallback.name} 重新分析…`);
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
        apiUrl: agent.apiUrl,
        model: agent.model,
        format: agent.format,
        timeoutMs,
        winRateEstimationEnabled: settings.winRateEstimationEnabled,
        promptConfig: agent.promptConfig,
      },
      apiKey,
      this.deps.getCatalog(),
      (event) => this.deps.diagnosticAgentEvent(event),
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

  private async resolveSelectedAgent(): Promise<AgentWithApiKey> {
    const agent = this.deps.fallbackSelector.activeAgent();
    const selected = await this.deps.fallbackSelector.getApiKeyOrFallback(agent);
    if (!selected.model) throw new Error("尚未配置 Agent 模型名称。");
    return selected;
  }
}

function mergeAgentResults(
  results: PromiseSettledResult<AnalysisResult>[],
  agents: AgentWithApiKey[],
  maxCandidates: number,
): AnalysisResult {
  const successes: Array<{ agentName: string; result: AnalysisResult }> = [];
  const errors: string[] = [];

  for (const [index, settled] of results.entries()) {
    const agent = agents[index]!;
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
    candidates: mergedCandidates.slice(0, maxCandidates * successes.length),
    warnings,
    createdAt: new Date().toISOString(),
  };
}
