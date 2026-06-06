import { useEffect, useState } from "react";
import { HearthstoneConfirm } from "./HearthstoneConfirm";
import { GuideOverlay } from "./GuideOverlay";
import { SettingsPanel } from "./SettingsPanel";
import type {
  AnalysisResult,
  AgentProfile,
  AppStatus,
} from "../../shared/types";
import {
  cardCost,
  cardTitle,
  extractAgentLabel,
  getActiveAgent,
  labelForRank,
  syncLegacyAgentFields,
  turnOwnerClass,
  turnOwnerLabel,
  updateAgent,
} from "../view-model";

export function Dashboard({ status }: { status: AppStatus }) {
  const [settings, setSettings] = useState(status.settings);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [, setHistory] = useState<AnalysisResult[]>([]);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [guideOpen, setGuideOpen] = useState(!status.settings.guideDismissed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);

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
    const nextAgent = settings.agents.find(agent => agent.id === agentId);
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
    const remaining = settings.agents.filter(agent => agent.id !== activeAgent.id);
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

  return (
    <div className="app-shell">
      <div className="dashboard">
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
              <button className="wc-btn wc-close" onClick={() => setCloseConfirmOpen(true)} title="关闭">×</button>
            </div>
          </div>
        </header>

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

        {status.message && <div className="message-bar">{status.message}</div>}

        <div className="dash-body">
          <div className="battlefield">
            {!snapshot ? (
              <div className="empty-state">
                <p>等待 Power.log 产生对局事件</p>
                <small>启动炉石并进入对局后自动检测</small>
              </div>
            ) : (
              <>
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

                <div className="action-strip">
                  {status.busy && (
                    <button className="btn-secondary" onClick={() => void window.hearthstoneAgent.stopAnalysis()}>停止</button>
                  )}
                  <span className="timer">⏱ 对手手牌 {snapshot.opponent.handCount} · 奥秘 {snapshot.opponent.secretCount}</span>
                </div>
              </>
            )}
          </div>

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
        </div>
      </div>

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
