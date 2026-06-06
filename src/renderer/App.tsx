import { useEffect, useState } from "react";
import type {
  AnalysisResult,
  AgentProfile,
  AppSettings,
  AppStatus,
  ActivePlayer,
  CardReference,
  CandidateLine,
} from "../shared/types";

export function App() {
  const overlay = new URLSearchParams(window.location.search).get("view") === "overlay";
  const [status, setStatus] = useState<AppStatus>();
  const [bootError, setBootError] = useState<string>();

  useEffect(() => {
    let active = true;
    const loadStatus = async () => {
      try {
        const nextStatus = await window.hearthstoneAgent.getStatus();
        if (active) setStatus(nextStatus);
      } catch (error: unknown) {
        if (active) setBootError(error instanceof Error ? error.message : "启动失败");
      }
    };
    void loadStatus();
    const unsubscribe = window.hearthstoneAgent.onStatusChanged((nextStatus) => {
      if (active) setStatus(nextStatus);
    });
    const timer = window.setInterval(() => void loadStatus(), 1_500);
    return () => {
      active = false;
      window.clearInterval(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (overlay) {
      document.body.style.background = "transparent";
      document.body.style.backgroundImage = "none";
    }
  }, [overlay]);

  if (bootError) {
    return <div className="app-shell"><div className="dashboard" style={{padding:40,textAlign:"center",color:"#d56c61"}}>启动失败：{bootError}</div></div>;
  }
  if (!status) {
    return <div className="app-shell"><div className="dashboard" style={{padding:40,textAlign:"center",color:"#8a7a66"}}>正在启动…</div></div>;
  }
  return overlay ? <OverlayBar status={status} /> : <Dashboard status={status} />;
}

/* ==================== DASHBOARD ==================== */

function Dashboard({ status }: { status: AppStatus }) {
  const [settings, setSettings] = useState(status.settings);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [history, setHistory] = useState<AnalysisResult[]>([]);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [guideOpen, setGuideOpen] = useState(!status.settings.guideDismissed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);
  const [expandedHistory, setExpandedHistory] = useState<string | null>(null);

  const activeAgent = getActiveAgent(settings);

  useEffect(() => setSettings(status.settings), [status.settings]);
  useEffect(() => {
    void window.hearthstoneAgent.hasApiKey(activeAgent.id).then(setHasApiKey);
    void window.hearthstoneAgent.listHistory().then(setHistory);
  }, [status.analysis, activeAgent.id]);
  useEffect(() => {
    if (!status.busy) { setBusyElapsed(0); return; }
    const id = setInterval(() => setBusyElapsed(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status.busy]);

  const save = async () => {
    const acceptedAt = settings.liveRecommendationsEnabled && !settings.liveRecommendationsRiskAcceptedAt
      ? new Date().toISOString()
      : settings.liveRecommendationsRiskAcceptedAt;
    await window.hearthstoneAgent.saveSettings({
      ...settings,
      liveRecommendationsRiskAcceptedAt: acceptedAt,
    });
    if (apiKey.trim()) {
      setHasApiKey(await window.hearthstoneAgent.setApiKey(apiKey, activeAgent.id));
      setApiKey("");
    }
  };

  const updateActiveAgent = (patch: Partial<AgentProfile>) => {
    setSettings(updateAgent(settings, activeAgent.id, patch));
  };

  const switchAgent = (agentId: string) => {
    const nextAgent = settings.agents.find(a => a.id === agentId);
    if (!nextAgent) return;
    setSettings(syncLegacyAgentFields({ ...settings, activeAgentId: agentId }, nextAgent));
    setApiKey("");
  };

  const addAgent = () => {
    const nextAgent: AgentProfile = {
      id: `agent-${Date.now()}`,
      name: `Agent ${settings.agents.length + 1}`,
      baseUrl: "http://127.0.0.1:8001",
      model: "",
      transport: "chat-completions",
      timeoutMs: activeAgent.timeoutMs,
    };
    setSettings(syncLegacyAgentFields({
      ...settings,
      agents: [...settings.agents, nextAgent],
      activeAgentId: nextAgent.id,
    }, nextAgent));
    setApiKey("");
  };

  const removeActiveAgent = () => {
    if (settings.agents.length <= 1) return;
    const remaining = settings.agents.filter(a => a.id !== activeAgent.id);
    setSettings(syncLegacyAgentFields({ ...settings, agents: remaining, activeAgentId: remaining[0]?.id }, remaining[0]));
    setApiKey("");
  };

  const dismissGuide = () => {
    setGuideOpen(false);
    if (!settings.guideDismissed) {
      window.hearthstoneAgent.saveSettings({ ...settings, guideDismissed: true }).catch(() => {});
    }
  };

  const snapshot = status.snapshot;
  const analysis = status.analysis;
  const turnLabel = turnOwnerLabel(snapshot?.activePlayer);
  const turnClass = turnOwnerClass(snapshot?.activePlayer);
  const handleCloseWindow = () => {
    setCloseConfirmOpen(true);
  };

  return (
    <div className="app-shell">
      <div className="dashboard">
        {/* Tavern Header */}
        <header className="tavern-header">
          <div className="logo">
            <div className="shield"><span>🛡</span></div>
            <div className="text">
              旅店老板的参谋
              <small>炉石对局分析助手</small>
            </div>
          </div>
          <div className="right">
            <button className={`btn-header-primary${status.busy ? " loading" : ""}`} onClick={() => void window.hearthstoneAgent.analyze()} disabled={status.busy}>
              {status.busy ? "分析中" : "⚔️ 召集参谋"}
            </button>
            <button className="btn-header-sm" onClick={() => setSettingsOpen(true)}>⚙️</button>
            <button className="btn-header-sm" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>🏷️</button>
            <button className="btn-guide" onClick={() => setGuideOpen(true)}>📖 旅店指南</button>
            <div className="candle-status">
              <span className={`flame${status.busy ? " busy" : ""}`} />
              <span>{status.busy ? "分析中" : "待命中"}</span>
            </div>
            <div className="window-controls">
              <button className="wc-btn wc-minimize" onClick={() => void window.hearthstoneAgent.minimizeWindow()} title="最小化">—</button>
              <button className="wc-btn wc-maximize" onClick={() => void window.hearthstoneAgent.maximizeWindow()} title="最大化">□</button>
              <button className="wc-btn wc-close" onClick={handleCloseWindow} title="关闭">×</button>
            </div>
          </div>
        </header>

        {/* Dossier */}
        <div className="dossier">
          <span className="item"><span className={`dot ${status.log.available ? "green" : "red"}`} /> <span className="val">局面采集</span> {status.log.available ? "已连接" : "未连接"}</span>
          <span className="item">📜 卡牌 <span className="val">{status.catalog.entryCount ?? "—"}</span></span>
          {snapshot && <span className="item">⚔️ 回合 <span className="val">{snapshot.turn}</span></span>}
          <span className={`item turn-item ${turnClass}`}>当前 <span className="val">{turnLabel}</span></span>
          {snapshot && <span className="item">⚡ <span className="val">{snapshot.self.mana}</span>/{snapshot.self.maxMana}</span>}
          <span className="item agent-item">Agent <span className="val">{activeAgent.name}</span></span>
          {status.visualValidation && (
            <span className="item">
              <span className={`dot ${status.visualValidation.ok ? "green" : status.visualValidation.errors.length > 0 ? "red" : "amber"}`} />
              视觉校验 <span className="val">{status.visualValidation.matchedEntityIds.length}/{status.visualValidation.matchedEntityIds.length}</span>
            </span>
          )}
          <span className="dossier-right">
            {status.busy && <span>⏱ {busyElapsed}s</span>}
          </span>
        </div>

        {/* Status Message */}
        {status.message && <div className="message-bar">{status.message}</div>}

        {/* Body: Battlefield + Advisor */}
        <div className="dash-body">
          {/* Battlefield Column */}
          <div className="battlefield">
            {!snapshot ? (
              <div className="empty-state">
                <p>等待 Power.log 产生对局事件</p>
                <small>启动炉石并进入对局后自动检测</small>
              </div>
            ) : (
              <>
                {/* Hand Zone */}
                <div className="zone">
                  <div className="zone-title">✋ 手牌 <span className="count">{snapshot.self.hand.length}</span></div>
                  <div className="zone-cards">
                    {snapshot.self.hand.map(card => (
                      <div className="zone-card" key={card.entityId}>
                        <span>{cardTitle(card)} <span className="cost-badge">{cardCost(card)}费</span></span>
                        <span className="stats">#{card.entityId}</span>
                      </div>
                    ))}
                    {snapshot.self.hand.length === 0 && <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>空手牌</div>}
                  </div>
                </div>

                {/* Self Board */}
                <div className="zone">
                  <div className="zone-title">🛡 己方战场 <span className="count">{snapshot.self.board.length}</span></div>
                  <div className="zone-cards">
                    {snapshot.self.board.map(card => (
                      <div className="zone-card" key={card.entityId}>
                        <span>{cardTitle(card)} {card.attack !== undefined && <span className="stats">{card.attack}/{card.health}</span>}</span>
                        <span className="stats">#{card.entityId}{card.taunt ? " [嘲讽]" : ""}{card.exhausted ? " [已行动]" : ""}</span>
                      </div>
                    ))}
                    {snapshot.self.board.length === 0 && <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>空场</div>}
                  </div>
                </div>

                {/* Opponent Board */}
                <div className="zone">
                  <div className="zone-title">👹 对手战场 <span className="count">{snapshot.opponent.board.length}</span></div>
                  <div className="zone-cards">
                    {snapshot.opponent.board.map(card => (
                      <div className="zone-card" key={card.entityId}>
                        <span>{cardTitle(card)} {card.attack !== undefined && <span className="stats">{card.attack}/{card.health}</span>}</span>
                        <span className="stats">#{card.entityId}{card.taunt ? <span className="tag-taunt"> [嘲讽]</span> : ""}</span>
                      </div>
                    ))}
                    {snapshot.opponent.board.length === 0 && <div className="zone-card" style={{color:"var(--text-muted)",fontSize:11,justifyContent:"center"}}>空场</div>}
                  </div>
                </div>

                {/* Action Strip */}
                <div className="action-strip">
                  {status.busy && (
                    <button className="btn-secondary" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>
                  )}
                  <span className="timer">⏱ 对手手牌 {snapshot.opponent.handCount} · 奥秘 {snapshot.opponent.secretCount}</span>
                </div>
              </>
            )}
          </div>

          {/* Advisor Column */}
          <div className="advisor">
            <div className="scroll-title">~ 谋略卷轴 ~</div>
            <div className="scroll-sub">参谋分析 · {activeAgent.name}</div>

            <div className="advisor-content">
              {!analysis ? (
                <div className="empty-state">
                  <p>{status.message ?? "按 Ctrl+Shift+A 分析当前局面"}</p>
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
                      onClick={() => setSelectedCandidate(selectedCandidate === candidate.rank ? null : candidate.rank)}
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
                        {candidate.actions.map((action, i) => (
                          <div key={i}>{i + 1}. {action.description}</div>
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
        </div>
      </div>

      {/* Guide Overlay */}
      {guideOpen && <GuideOverlay settings={settings} onClose={dismissGuide} />}

      {closeConfirmOpen && (
        <HearthstoneConfirm
          title="要离开旅店吗？"
          message="关闭主界面会退出对局助手，悬浮窗和日志监听也会一起停止。"
          confirmText="确认关闭"
          cancelText="继续使用"
          onCancel={() => setCloseConfirmOpen(false)}
          onConfirm={() => void window.hearthstoneAgent.closeWindow()}
        />
      )}

      {/* Settings Panel */}
      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          apiKey={apiKey}
          hasApiKey={hasApiKey}
          activeAgent={activeAgent}
          onUpdateSettings={setSettings}
          onSetApiKey={setApiKey}
          onSave={save}
          onClose={() => setSettingsOpen(false)}
          onSwitchAgent={switchAgent}
          onAddAgent={addAgent}
          onRemoveAgent={removeActiveAgent}
          onUpdateAgent={updateActiveAgent}
        />
      )}
    </div>
  );
}

/* ==================== OVERLAY BAR ==================== */

function OverlayBar({ status }: { status: AppStatus }) {
  const analysis = status.analysis;
  const candidates = analysis?.candidates ?? [];
  const activeAgent = getActiveAgent(status.settings);
  const turnLabel = turnOwnerLabel(status.snapshot?.activePlayer);
  const turnClass = turnOwnerClass(status.snapshot?.activePlayer);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [compact, setCompact] = useState(false);
  const [tickerIdx, setTickerIdx] = useState(0);
  const [tickerHover, setTickerHover] = useState(false);

  useEffect(() => {
    if (!status.busy) { setBusyElapsed(0); return; }
    const id = setInterval(() => setBusyElapsed(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [status.busy]);

  useEffect(() => {
    setTickerIdx(0);
  }, [analysis]);

  useEffect(() => {
    if (candidates.length < 2 || tickerHover || status.busy || !compact) return;
    const id = setInterval(() => setTickerIdx(i => (i + 1) % candidates.length), 4000);
    return () => clearInterval(id);
  }, [candidates.length, tickerHover, status.busy, compact]);

  const ticker = candidates[tickerIdx];

  /* ======== COMPACT TICKER ======== */
  if (compact) {
    return (
      <div className="overlay-shell" style={{justifyContent:"flex-end"}}>
        <div className="ol-ticker">
          <span className={`sign-icon${status.busy ? " busy" : ""}`}>
            {status.busy ? "⏳" : "🍺"}
          </span>

          {status.busy ? (
            <span className="ticker-text">分析中… {busyElapsed}s</span>
          ) : !analysis ? (
            <span className="ticker-text">{turnLabel} · {activeAgent.name} · {status.message ?? "按 Ctrl+Shift+A"}</span>
          ) : ticker ? (
            <div
              className="ticker-body"
              onMouseEnter={() => setTickerHover(true)}
              onMouseLeave={() => setTickerHover(false)}
              onClick={() => setTickerIdx(i => (i + 1) % candidates.length)}
            >
              <span className="ticker-rank">{labelForRank(ticker.rank)}</span>
              <span className="ticker-action">
                {extractAgentPrefix(ticker.rationale) && (
                  <span className="ticker-agent">[{extractAgentPrefix(ticker.rationale)}]</span>
                )}
                {ticker.actions[0]?.description ?? "—"}
              </span>
              {ticker.winRateBefore !== undefined && (
                <span className="ticker-wr">
                  {Math.round(ticker.winRateBefore * 100)}→{Math.round((ticker.winRateAfter ?? ticker.winRateBefore) * 100)}%
                </span>
              )}
              <span className={`ticker-pct${ticker.confidence < 0.6 ? " low" : ticker.confidence < 0.75 ? " med" : " high"}`}>
                {Math.round(ticker.confidence * 100)}%
              </span>
            </div>
          ) : null}

          {candidates.length > 1 && !status.busy && (
            <div className="ticker-dots">
              {candidates.map((_, i) => (
                <button key={i} className={`tdot${i === tickerIdx ? " act" : ""}`} onClick={() => setTickerIdx(i)} />
              ))}
            </div>
          )}

          {analysis?.stale && <span className="ticker-stale">已过期</span>}
          <span className={`ticker-meta ${turnClass}`}>{turnLabel} · {activeAgent.name}</span>

          <div className="ticker-actions">
            <button className={`btn-gold${status.busy ? " loading" : ""}`} onClick={() => void window.hearthstoneAgent.analyze()} disabled={status.busy}>
              {status.busy ? "分析中" : "分析"}
            </button>
            {status.busy && <button className="btn-dim" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>}
            <button className="btn-dim" onClick={() => setCompact(false)}>详细</button>
            <button className="btn-dim" onClick={() => void window.hearthstoneAgent.showMainWindow()}>主界面</button>
            <button className="btn-dim" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>隐藏</button>
          </div>
        </div>
      </div>
    );
  }

  /* ======== DETAILED PANEL ======== */
  return (
    <div className="overlay-shell">
      <div className="overlay-panel">
        {/* Header */}
        <div className="ol-header">
          <div className="ol-shield"><span>⚔</span></div>
          {status.busy ? (
            <span className="ol-title">分析中…</span>
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
          <span className="ol-agent-pill">Agent · {activeAgent.name}</span>
          <span className={`ol-turn ${turnClass}`}>{turnLabel}</span>
        </div>

        {/* Body */}
        {!analysis ? (
          status.busy ? (
            <div className="ol-center">
              <span>分析中… {busyElapsed}s</span>
            </div>
          ) : (
            <div className="ol-center">
              <button className="btn-start" onClick={() => void window.hearthstoneAgent.analyze()}>开始分析</button>
            </div>
          )
        ) : (
          <>
            {/* Summary */}
            {analysis.summary && (
              <div className="ol-summary">{analysis.summary}</div>
            )}

            {/* Candidate cards */}
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

            {/* Warnings */}
            {analysis.warnings.length > 0 && (
              <div className="ol-warnings">⚠ {analysis.warnings.join(" · ")}</div>
            )}

            {/* Footer */}
            <div className="ol-footer">
              <button className={`btn-gold${status.busy ? " loading" : ""}`} onClick={() => void window.hearthstoneAgent.analyze()} disabled={status.busy}>
                {status.busy ? "分析中" : "分析"}
              </button>
              {status.busy && <button className="btn-dim" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>}
              <button className="btn-dim" onClick={() => setCompact(true)}>简略</button>
              <button className="btn-dim" onClick={() => void window.hearthstoneAgent.showMainWindow()}>主界面</button>
              <button className="btn-dim" onClick={() => void window.hearthstoneAgent.toggleOverlay()}>隐藏</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ==================== GUIDE OVERLAY ==================== */

function HearthstoneConfirm({
  title,
  message,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="guide-overlay confirm-overlay" onClick={onCancel}>
      <div className="confirm-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
        <div className="confirm-sigil"><span>!</span></div>
        <div className="confirm-copy">
          <h2 id="close-confirm-title">{title}</h2>
          <p>{message}</p>
        </div>
        <div className="confirm-actions">
          <button className="btn-confirm-cancel" onClick={onCancel}>{cancelText}</button>
          <button className="btn-confirm-danger" onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

function GuideOverlay({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  return (
    <div className="guide-overlay" onClick={onClose}>
      <div className="guide-panel" onClick={e => e.stopPropagation()}>
        <div className="guide-header">
          <h2>~ 旅店指南 ~</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="guide-body">
          <GuideStep num={1} title="启动与连接">
            启动炉石进入对局后，程序自动读取 Power.log 并识别局面状态。
            确保已在炉石安装目录的 <kbd>options.txt</kbd> 中启用 debug 日志。
          </GuideStep>
          <GuideStep num={2} title="分析当前局面">
            点击 <kbd>⚔️ 召集参谋</kbd> 按钮或按快捷键 <kbd>{settings.hotkeys.analyze}</kbd> 发起分析。
            Agent 会根据可见局面返回候选路线。
          </GuideStep>
          <GuideStep num={3} title="查看候选路线">
            每条路线显示推荐动作、置信度和理由。点击路线可展开风险提示。
            顶部 "~ 谋略卷轴 ~" 区域会展示所有候选路线。
          </GuideStep>
          <GuideStep num={4} title="悬浮栏">
            按 <kbd>{settings.hotkeys.toggleOverlay}</kbd> 切换游戏内悬浮栏。
            悬浮栏精简显示当前推荐，无需切换到主窗口即可查看。
          </GuideStep>
          <GuideStep num={5} title="Agent 配置">
            在设置面板中可配置多个 Agent（如 OpenAI、DeepSeek 等），
            并开启自动分析、多 Agent 对比等高级功能。
          </GuideStep>
        </div>
        <div className="guide-footer">
          <button className="btn-guide" onClick={onClose}>开始使用</button>
        </div>
      </div>
    </div>
  );
}

function GuideStep({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div className="guide-step" style={{animationDelay: `${num * 0.06}s`}}>
      <div className="step-num">{num}</div>
      <div className="step-content">
        <h3>{title}</h3>
        <p>{children}</p>
      </div>
    </div>
  );
}

/* ==================== SETTINGS PANEL ==================== */

function SettingsPanel({
  settings, apiKey, hasApiKey, activeAgent,
  onUpdateSettings, onSetApiKey, onSave, onClose,
  onSwitchAgent, onAddAgent, onRemoveAgent, onUpdateAgent,
}: {
  settings: AppSettings; apiKey: string; hasApiKey: boolean; activeAgent: AgentProfile;
  onUpdateSettings: (s: AppSettings) => void; onSetApiKey: (k: string) => void;
  onSave: () => void; onClose: () => void;
  onSwitchAgent: (id: string) => void; onAddAgent: () => void; onRemoveAgent: () => void;
  onUpdateAgent: (patch: Partial<AgentProfile>) => void;
}) {
  return (
    <div className="guide-overlay" onClick={onClose} style={{zIndex:99}}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ 设置</h2>
          <button className="close-btn" style={{
            background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
            width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }} onClick={onClose}>×</button>
        </div>
        <div className="settings-body">
          {/* Agent Settings */}
          <div className="settings-group">
            <div className="group-label">Agent 配置</div>
            <div className="field-row">
              <label>当前 Agent</label>
              <select value={activeAgent.id} onChange={e => onSwitchAgent(e.target.value)}>
                {settings.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="field-row">
              <label>名称</label>
              <input value={activeAgent.name} onChange={e => onUpdateAgent({ name: e.target.value })} />
            </div>
            <div className="field-row">
              <label>接口地址</label>
              <input value={activeAgent.baseUrl} onChange={e => onUpdateAgent({ baseUrl: e.target.value })} />
            </div>
            <div className="field-row">
              <label>模型</label>
              <input value={activeAgent.model} placeholder="由供应商提供" onChange={e => onUpdateAgent({ model: e.target.value })} />
            </div>
            <div className="field-row">
              <label>API Key {hasApiKey ? "（已保存）" : "（未保存）"}</label>
              <input type="password" value={apiKey} placeholder="仅保存到凭据管理器" onChange={e => onSetApiKey(e.target.value)} />
            </div>
            <div className="field-row">
              <label>传输协议</label>
              <select value={activeAgent.transport} onChange={e => onUpdateAgent({ transport: e.target.value as AppSettings["transport"] })}>
                <option value="responses">Responses API</option>
                <option value="chat-completions">Chat Completions API</option>
              </select>
            </div>
            <div className="field-row">
              <label>超时 (ms)</label>
              <input type="number" value={activeAgent.timeoutMs} onChange={e => onUpdateAgent({ timeoutMs: Number(e.target.value) })} />
            </div>
            <div className="settings-actions">
              <button className="btn-save" onClick={onAddAgent}>新增 Agent</button>
              <button className="btn-test" onClick={onRemoveAgent} disabled={settings.agents.length <= 1}>删除</button>
            </div>
          </div>

          {/* General Settings */}
          <div className="settings-group">
            <div className="group-label">通用</div>
            <div className="field-row">
              <label>Power.log 路径</label>
              <input value={settings.powerLogPath} onChange={e => onUpdateSettings({ ...settings, powerLogPath: e.target.value })} />
            </div>
            <div className="field-row">
              <label>候选路线数</label>
              <input type="number" min={1} max={5} value={settings.maxCandidates} onChange={e => onUpdateSettings({ ...settings, maxCandidates: Number(e.target.value) })} />
            </div>
            <div className="field-row">
              <label>语言</label>
              <select value={settings.language} onChange={e => onUpdateSettings({ ...settings, language: e.target.value as "zhCN" | "enUS" })}>
                <option value="zhCN">中文</option>
                <option value="enUS">English</option>
              </select>
            </div>
          </div>

          {/* Toggles */}
          <div className="settings-group">
            <div className="group-label">功能开关</div>
            <div className="toggle-row">
              <span className="toggle-label">自动分析</span>
              <div className={`toggle${settings.autoAnalyze ? " on" : ""}`} onClick={() => {
                const next = { ...settings, autoAnalyze: !settings.autoAnalyze };
                onUpdateSettings(next);
                window.hearthstoneAgent.saveSettings(next).catch(() => {});
              }} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">实时建议</span>
              <div className={`toggle${settings.liveRecommendationsEnabled ? " on" : ""}`} onClick={() => onUpdateSettings({ ...settings, liveRecommendationsEnabled: !settings.liveRecommendationsEnabled })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">多 Agent 对比</span>
              <div className={`toggle${settings.multiAgentCompareEnabled ? " on" : ""}`} onClick={() => onUpdateSettings({ ...settings, multiAgentCompareEnabled: !settings.multiAgentCompareEnabled })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">胜率估算</span>
              <div className={`toggle${settings.winRateEstimationEnabled ? " on" : ""}`} onClick={() => onUpdateSettings({ ...settings, winRateEstimationEnabled: !settings.winRateEstimationEnabled })} />
            </div>
          </div>

          {/* Hotkeys */}
          <div className="settings-group">
            <div className="group-label">快捷键</div>
            <div className="field-row">
              <label>分析</label>
              <div className="hotkey-input">
                <kbd>{settings.hotkeys.analyze.replace("CommandOrControl", "Ctrl")}</kbd>
              </div>
            </div>
            <div className="field-row">
              <label>切换悬浮栏</label>
              <div className="hotkey-input">
                <kbd>{settings.hotkeys.toggleOverlay.replace("CommandOrControl", "Ctrl")}</kbd>
              </div>
            </div>
          </div>

          {/* Save & Test */}
          <div className="settings-actions" style={{padding:"0 4px",marginTop:4}}>
            <button className="btn-save" onClick={onSave}>保存设置</button>
            <button className="btn-test" onClick={() => void window.hearthstoneAgent.testAgentConnection()}>测试连接</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ==================== HELPERS ==================== */

function getActiveAgent(settings: AppSettings): AgentProfile {
  return settings.agents.find(a => a.id === settings.activeAgentId) ??
    settings.agents[0] ?? {
      id: "default", name: "默认 Agent",
      baseUrl: settings.baseUrl, model: settings.model,
      transport: settings.transport, timeoutMs: settings.timeoutMs,
    };
}

function updateAgent(settings: AppSettings, agentId: string, patch: Partial<AgentProfile>): AppSettings {
  const agents = settings.agents.map(a => a.id === agentId ? { ...a, ...patch } : a);
  const activeAgent = agents.find(a => a.id === agentId);
  return activeAgent ? syncLegacyAgentFields({ ...settings, agents }, activeAgent) : { ...settings, agents };
}

function syncLegacyAgentFields(settings: AppSettings, agent?: AgentProfile): AppSettings {
  if (!agent) return settings;
  return {
    ...settings,
    activeAgentId: agent.id,
    baseUrl: agent.baseUrl,
    model: agent.model,
    transport: agent.transport,
    timeoutMs: agent.timeoutMs,
  };
}

function cardTitle(card: CardReference): string {
  return card.name ?? card.cardId ?? `#${card.entityId}`;
}

function cardCost(card: CardReference): number {
  return card.cost ?? 0;
}

function turnOwnerLabel(activePlayer?: ActivePlayer): string {
  if (activePlayer === "self") return "己方回合";
  if (activePlayer === "opponent") return "对手回合";
  return "回合未知";
}

function turnOwnerClass(activePlayer?: ActivePlayer): string {
  if (activePlayer === "self") return "self-turn";
  if (activePlayer === "opponent") return "opponent-turn";
  return "unknown-turn";
}

function extractAgentLabel(rationale: string): string {
  const match = rationale.match(/^\[(.+?)\]\s*/);
  if (match) return `[${match[1]}] ${rationale.slice(match[0].length).slice(0, 30)}`;
  return rationale.slice(0, 30);
}

function extractAgentPrefix(rationale: string): string | undefined {
  const match = rationale.match(/^\[(.+?)\]\s*/);
  return match?.[1];
}

function labelForRank(rank: number): string {
  const map = ["", "Ⅰ", "Ⅱ", "Ⅲ", "Ⅳ", "Ⅴ"];
  return map[rank] ?? `#${rank}`;
}
