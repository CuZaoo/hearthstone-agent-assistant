import { useEffect, useState } from "react";
import type { AdoptionStats } from "../../shared/types";

interface StatsPanelProps {
  onClose: () => void;
}

export function StatsPanel({ onClose }: StatsPanelProps) {
  const [stats, setStats] = useState<AdoptionStats | null>(null);

  useEffect(() => {
    void window.hearthstoneAgent.getAdoptionStats().then(setStats);
  }, []);

  return (
    <div className="guide-overlay">
      <div className="stats-panel">
        <div className="settings-header">
          <h2>📊 采纳统计</h2>
          <button className="close-btn" style={{
            background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
            width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }} onClick={onClose}>×</button>
        </div>
        {!stats ? (
          <div className="stats-empty">暂无数据</div>
        ) : (
          <div className="stats-body">
            <div className="stats-section">
              <div className="stats-section-title">全局统计</div>
              <div className="stats-grid">
                <div className="stats-card">
                  <div className="stats-value">{stats.totalAnalyses}</div>
                  <div className="stats-label">分析次数</div>
                </div>
                <div className="stats-card">
                  <div className="stats-value">{stats.totalAdopted}</div>
                  <div className="stats-label">采纳次数</div>
                </div>
                <div className="stats-card highlight">
                  <div className="stats-value">{stats.adoptionRate}%</div>
                  <div className="stats-label">采纳率</div>
                </div>
                <div className="stats-card">
                  <div className="stats-value">{stats.actionMatchRate}%</div>
                  <div className="stats-label">操作匹配率</div>
                </div>
                <div className="stats-card">
                  <div className="stats-value">{stats.actionsTotal}</div>
                  <div className="stats-label">建议总数</div>
                </div>
                <div className="stats-card">
                  <div className="stats-value">{stats.actionsMatched}</div>
                  <div className="stats-label">已匹配操作</div>
                </div>
              </div>
            </div>

            {stats.perAgent.length > 1 && (
              <div className="stats-section">
                <div className="stats-section-title">分 Agent 统计</div>
                <div className="stats-agent-list">
                  {stats.perAgent.map(a => (
                    <div key={a.agentId} className="stats-agent-row">
                      <span className="stats-agent-name">{a.agentName}</span>
                      <span className="stats-agent-rate">{a.adoptionRate}%</span>
                      <span className="stats-agent-bar">
                        <span className="stats-agent-fill" style={{width:`${a.adoptionRate}%`}} />
                      </span>
                      <span className="stats-agent-count">{a.adopted}/{a.analyses} 次采纳</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
