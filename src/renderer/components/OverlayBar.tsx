import { useCallback, useEffect, useState } from "react";
import type { AppStatus } from "../../shared/types";
import {
  extractAgentPrefix,
  getActiveAgent,
  labelForRank,
  syncLegacyAgentFields,
  turnOwnerClass,
  turnOwnerLabel,
} from "../view-model";

export function OverlayBar({ status }: { status: AppStatus }) {
  const analysis = status.analysis;
  const candidates = analysis?.candidates ?? [];
  const activeAgent = getActiveAgent(status.settings);
  const turnLabel = turnOwnerLabel(status.snapshot?.activePlayer);
  const turnClass = turnOwnerClass(status.snapshot?.activePlayer);
  const [busyElapsed, setBusyElapsed] = useState(0);

  useEffect(() => {
    if (!status.busy) { setBusyElapsed(0); return; }
    const id = setInterval(() => setBusyElapsed(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status.busy]);

  const handleSwitchAgent = useCallback((agentId: string) => {
    const agent = status.settings.agents.find(a => a.id === agentId);
    if (!agent) return;
    const next = syncLegacyAgentFields(
      { ...status.settings, activeAgentId: agentId },
      agent,
    );
    void window.hearthstoneAgent.saveSettings(next);
  }, [status.settings]);

  const handleToggleAutoAnalyze = useCallback(() => {
    const next = { ...status.settings, autoAnalyze: !status.settings.autoAnalyze };
    void window.hearthstoneAgent.saveSettings(next);
  }, [status.settings]);

  return (
    <div className="overlay-shell">
      <div className="overlay-panel">
        <div className="ol-header">
          <div className="ol-shield"><span>⚔</span></div>
          {status.busy ? (
             <span className="ol-title">分析中… {busyElapsed}s</span>
          ) : !analysis ? (
            <span className="ol-title">{status.message ?? "按 Ctrl+Shift+A 分析"}</span>
          ) : (
            <>
              <span className="ol-title">
                参谋分析
                <span className="ol-agent"> · {activeAgent.name}</span>
              </span>
              {analysis.stale && <span className="ol-stale">已过期</span>}
            </>
          )}
          <select className="ol-agent-select" value={activeAgent.id} onChange={e => handleSwitchAgent(e.target.value)}>
            {status.settings.agents.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <span className={`ol-turn ${turnClass}`}>{turnLabel}</span>
        </div>

        {!analysis ? (
          status.busy ? (
            <>
              <div className="ol-candidates" style={{ justifyContent: "center", alignItems: "center" }}>
                <span>分析中… {busyElapsed}s</span>
              </div>
              <div className="ol-footer">
                 <button className="btn-gold loading">分析中 {busyElapsed}s</button>
                {status.busy && <button className="btn-dim" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>}
                <button className={`btn-dim${status.settings.autoAnalyze ? " active" : ""}`} onClick={handleToggleAutoAnalyze}>自动</button>
                <button className="btn-dim" onClick={() => void window.hearthstoneAgent.showMainWindow()}>主界面</button>
                <button className="btn-dim" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>隐藏</button>
              </div>
            </>
          ) : (
            <>
              <div className="ol-candidates" style={{ justifyContent: "center", alignItems: "center" }}>
                <div style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
                    {turnLabel} · {activeAgent.name}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {status.message ?? "按 Ctrl+Shift+A 分析当前局面"}
                  </div>
                </div>
              </div>
              <div className="ol-footer">
                <button className="btn-gold" onClick={() => void window.hearthstoneAgent.analyze()}>分析</button>
                <button className={`btn-dim${status.settings.autoAnalyze ? " active" : ""}`} onClick={handleToggleAutoAnalyze}>自动</button>
                <button className="btn-dim" onClick={() => void window.hearthstoneAgent.showMainWindow()}>主界面</button>
                <button className="btn-dim" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>隐藏</button>
              </div>
            </>
          )
        ) : (
          <>
            {analysis.summary && (
              <div className="ol-summary">{analysis.summary}</div>
            )}

            <div className="ol-candidates">
              {candidates.map(candidate => (
                <div key={candidate.rank} className="ol-candidate">
                  <div className="ol-cand-head">
                    <span className="ol-rank">{labelForRank(candidate.rank)}</span>
                    <span className="ol-action">
                      {extractAgentPrefix(candidate.rationale) && (
                        <span className="ol-agent-tag">[{extractAgentPrefix(candidate.rationale)}]</span>
                      )}
                      {candidate.actions[0]?.description ?? "—"}
                    </span>
                    {candidate.winRateBefore !== undefined && (
                      <span className="ol-winrate">
                        {Math.round(candidate.winRateBefore * 100)}%→{Math.round((candidate.winRateAfter ?? candidate.winRateBefore) * 100)}%
                      </span>
                    )}
                    <span className={`ol-pct${candidate.confidence < 0.6 ? " low" : candidate.confidence < 0.75 ? " med" : " high"}`}>
                      {Math.round(candidate.confidence * 100)}%
                    </span>
                  </div>
                  <div className="ol-rationale">{candidate.rationale}</div>
                  {candidate.risks.length > 0 && (
                    <div className="ol-risks">⚠ {candidate.risks.join(" · ")}</div>
                  )}
                </div>
              ))}
            </div>

            {analysis.warnings.length > 0 && (
              <div className="ol-warnings">⚠ {analysis.warnings.join(" · ")}</div>
            )}

            <div className="ol-footer">
              <button className={`btn-gold${status.busy ? " loading" : ""}`} onClick={() => void window.hearthstoneAgent.analyze()} disabled={status.busy}>
                {status.busy ? `分析中 ${busyElapsed}s` : "分析"}
              </button>
              {status.busy && <button className="btn-dim" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>}
              <button className={`btn-dim${status.settings.autoAnalyze ? " active" : ""}`} onClick={handleToggleAutoAnalyze}>自动</button>
              <button className="btn-dim" onClick={() => void window.hearthstoneAgent.showMainWindow()}>主界面</button>
              <button className="btn-dim" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>隐藏</button>
              {analysis?.usage?.totalTokens != null && (
                <span className="ol-tokens">Token: {analysis.usage.totalTokens}{analysis.durationMs != null ? ` · ${(analysis.durationMs / 1000).toFixed(1)}s` : ""}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
