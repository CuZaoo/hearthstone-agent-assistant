import { useEffect, useState } from "react";
import type { AdoptionRecord, AnalysisResult, GameInfo } from "../../shared/types";

interface HistoryPanelProps {
  onClose: () => void;
}

export function HistoryPanel({ onClose }: HistoryPanelProps) {
  const [games, setGames] = useState<GameInfo[]>([]);
  const [analysesByGame, setAnalysesByGame] = useState<Map<string, AnalysisResult[]>>(new Map());
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null);
  const [expandedAnalysisIdx, setExpandedAnalysisIdx] = useState<number | null>(null);

  useEffect(() => {
    void window.hearthstoneAgent.listGames().then(async (gameList) => {
      setGames(gameList);
      const map = new Map<string, AnalysisResult[]>();
      for (const game of gameList) {
        const analyses = await window.hearthstoneAgent.listAnalysesByGame(game.gameId);
        map.set(game.gameId, analyses);
      }
      setAnalysesByGame(map);
    });
  }, []);

  const handleGameToggle = (gameId: string) => {
    if (expandedGameId === gameId) {
      setExpandedGameId(null);
      setExpandedAnalysisIdx(null);
    } else {
      setExpandedGameId(gameId);
      setExpandedAnalysisIdx(0);
    }
  };

  return (
    <div className="guide-overlay">
      <div className="history-panel">
        <div className="settings-header">
          <h2>📜 分析记录</h2>
          <button className="close-btn" style={{
            background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
            width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }} onClick={onClose}>×</button>
        </div>
        <div className="history-list">
          {games.length === 0 && (
            <div className="history-empty">暂无分析记录</div>
          )}
          {games.map((game) => {
            const analyses = analysesByGame.get(game.gameId) ?? [];
            const isGameExpanded = expandedGameId === game.gameId;
            return (
              <div key={game.gameId} className="history-game">
                <div
                  className="history-game-header"
                  onClick={() => handleGameToggle(game.gameId)}
                >
                  <div className="history-game-header-top">
                    <span className="history-game-icon">{isGameExpanded ? "▼" : "▶"}</span>
                    <span className="history-game-title">
                      {game.heroClass} vs {game.opponentClass}
                    </span>
                  </div>
                  <div className="history-game-meta">
                    {new Date(game.startedAt).toLocaleString()} · {game.analysisCount}次分析
                  </div>
                </div>
                {isGameExpanded && (
                  <div className="history-game-analyses">
                    {analyses.map((a, i) => (
                      <div
                        key={a.createdAt ?? i}
                        className={`history-entry${expandedAnalysisIdx === i ? " expanded" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedAnalysisIdx(expandedAnalysisIdx === i ? null : i);
                        }}
                      >
                        <div className="history-entry-header">
                          <span className="history-summary">{a.summary}</span>
                          <span className="history-meta">
                            {a.createdAt && new Date(a.createdAt).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="history-meta-line">
                          回合{a.turn ?? a.snapshotRevision} · {a.candidates.length}条路线
                          {a.durationMs != null && ` · ${(a.durationMs / 1000).toFixed(1)}s`}
                          {a.usage?.totalTokens != null && ` · Token ${a.usage.totalTokens}`}
                        </div>
                        {expandedAnalysisIdx === i && (
                          <div className="history-detail">
                            {a.candidates.map(c => (
                              <div key={c.rank} className="history-candidate">
                                <div className="history-cand-head">
                                  <span className="ol-rank">{["Ⅰ","Ⅱ","Ⅲ","Ⅳ","Ⅴ"][c.rank - 1] ?? `#${c.rank}`}</span>
                                  <span className="history-action">{c.actions[0]?.description ?? "—"}</span>
                                  <span className={`ol-pct${c.confidence < 0.6 ? " low" : c.confidence < 0.75 ? " med" : " high"}`}>
                                    {Math.round(c.confidence * 100)}%
                                  </span>
                                </div>
                                <div className="history-rationale">{c.rationale}</div>
                                {c.risks.length > 0 && (
                                  <div className="history-risks">⚠ {c.risks.join(" · ")}</div>
                                )}
                              </div>
                            ))}
                            {a.warnings.length > 0 && (
                              <div className="history-warnings">⚠ {a.warnings.join(" · ")}</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
