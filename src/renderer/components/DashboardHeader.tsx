interface DashboardHeaderProps {
  busy: boolean;
  onAnalyze: () => void;
  onOpenSettings: () => void;
  onToggleOverlay: () => void;
  onOpenGuide: () => void;
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
  onMinimize,
  onMaximize,
  onClose,
}: DashboardHeaderProps) {
  return (
    <header className="tavern-header">
      <div className="logo">
        <div className="shield"><span>🛡</span></div>
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
        <button className="btn-guide" onClick={onOpenGuide}>📖 旅店指南</button>
        <div className="candle-status">
          <span className={`flame${busy ? " busy" : ""}`} />
          <span>{busy ? "分析中" : "待命中"}</span>
        </div>
        <div className="window-controls">
          <button className="wc-btn wc-minimize" onClick={onMinimize} title="最小化">—</button>
          <button className="wc-btn wc-maximize" onClick={onMaximize} title="最大化">□</button>
          <button className="wc-btn wc-close" onClick={onClose} title="关闭">×</button>
        </div>
      </div>
    </header>
  );
}
