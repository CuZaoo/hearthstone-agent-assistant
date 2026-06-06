import type { AgentProfile, AnalysisResult, AppSettings } from "../../shared/types";
import { extractAgentLabel, labelForRank } from "../view-model";

interface AdvisorPanelProps {
  analysis?: AnalysisResult;
  settings: AppSettings;
  activeAgent: AgentProfile;
  message?: string;
  selectedCandidate: number | null;
  onSelectCandidate: (rank: number | null) => void;
}

export function AdvisorPanel({
  analysis,
  settings,
  activeAgent,
  message,
  selectedCandidate,
  onSelectCandidate,
}: AdvisorPanelProps) {
  return (
    <div className="advisor">
      <div className="scroll-title">~ 谋略卷轴 ~</div>
      <div className="scroll-sub">参谋分析 · {activeAgent.name}</div>

      <div className="advisor-content">
        {!analysis ? (
          <div className="empty-state">
            <p>{message ?? "按 Ctrl+Shift+A 分析当前局面"}</p>
            <small>{settings.hotkeys.analyze} 分析 · {settings.hotkeys.toggleOverlay} 切换悬浮栏</small>
          </div>
        ) : (
          <>
            <p style={{color:"var(--gold-light)",fontSize:13,lineHeight:1.5,marginBottom:12}}>
              {analysis.summary}
              {analysis.stale && <span style={{color:"var(--red)",marginLeft:8,fontSize:11}}>(已过期)</span>}
            </p>
            {analysis.candidates.map(candidate => (
              <div
                key={candidate.rank}
                className={`vote-card${selectedCandidate === candidate.rank ? " selected" : ""}`}
                onClick={() => onSelectCandidate(selectedCandidate === candidate.rank ? null : candidate.rank)}
              >
                <div className="vc-head">
                  <span className="vc-title">
                    {labelForRank(candidate.rank)}. {extractAgentLabel(candidate.rationale)}
                  </span>
                  <span className={`vc-conf${candidate.confidence < 0.6 ? " low" : candidate.confidence < 0.75 ? " med" : ""}`}>
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </div>
                {candidate.winRateBefore !== undefined && (
                  <div style={{fontSize:10,color:"var(--text-muted)",marginBottom:4}}>
                    胜率 {Math.round(candidate.winRateBefore * 100)}% → {Math.round((candidate.winRateAfter ?? candidate.winRateBefore) * 100)}%
                  </div>
                )}
                <div className="vc-actions">
                  {candidate.actions.map((action, index) => (
                    <div key={index}>{index + 1}. {action.description}</div>
                  ))}
                </div>
                <div className="vc-foot">{candidate.rationale}</div>
                {selectedCandidate === candidate.rank && candidate.risks.length > 0 && (
                  <div className="vc-risks">⚠ 风险：{candidate.risks.join("；")}</div>
                )}
              </div>
            ))}
            {analysis.warnings.length > 0 && (
              <div className="warnings">{analysis.warnings.join(" · ")}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
