interface DashboardHeaderProps {
  busy: boolean;
  onAnalyze: () => void;
  onOpenSettings: () => void;
  onToggleOverlay: () => void;
  onOpenGuide: () => void;
  onOpenLogs: () => void;
  onOpenDebug: () => void;
  onOpenHistory: () => void;
  onOpenStats: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

export function DashboardHeader({
  busy,
  onAnalyze,
  onOpenSettings,
  onToggleOverlay,
  onOpenGuide,
  onOpenLogs,
  onOpenDebug,
  onOpenHistory,
  onOpenStats,
  onMinimize,
  onMaximize,
  onClose,
}: DashboardHeaderProps) {
  return (
    <header className="tavern-header">
      <div className="logo">
        <div className="shield"><img src="/icon.svg" alt="" className="shield-icon" /></div>
        <div className="text">
          旅店老板的参谋
          <small>炉石对局分析助手</small>
        </div>
      </div>
      <div className="right">
        <button className={`btn-header-primary${busy ? " loading" : ""}`} onClick={onAnalyze} disabled={busy}>
          {busy ? "分析中" : "⚔️ 召集参谋"}
        </button>
        <button className="btn-header-sm" onClick={onOpenSettings}>⚙️</button>
        <button className="btn-header-sm" onClick={onToggleOverlay}>🏷️</button>
        <button className="btn-header-sm" onClick={onOpenLogs}>📋</button>
        <button className="btn-header-sm" onClick={onOpenDebug} title="Prompt Debug">🔍</button>
        <button className="btn-header-sm" onClick={onOpenHistory}>📜</button>
        <button className="btn-header-sm" onClick={onOpenStats}>📊</button>
        <button className="btn-guide" onClick={onOpenGuide}>📖 旅店指南</button>
        <div className="candle-status">
          <span className={`flame${busy ? " busy" : ""}`} />
          <span>{busy ? "分析中" : "待命中"}</span>
        </div>
        <div className="window-controls">
          <button className="wc-btn wc-minimize" onClick={onMinimize} title="最小化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="5.5" width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className="wc-btn wc-maximize" onClick={onMaximize} title="最大化">
            <svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2"/></svg>
          </button>
          <button className="wc-btn wc-close" onClick={onClose} title="关闭">
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
