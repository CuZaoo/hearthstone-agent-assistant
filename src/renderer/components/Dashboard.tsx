import { useEffect, useState } from "react";
import { AdvisorPanel } from "./AdvisorPanel";
import { BattlefieldPanel } from "./BattlefieldPanel";
import { DashboardHeader } from "./DashboardHeader";
import { DossierBar } from "./DossierBar";
import { GuideOverlay } from "./GuideOverlay";
import { HearthstoneConfirm } from "./HearthstoneConfirm";
import { HistoryPanel } from "./HistoryPanel";
import { DebugPanel } from "./DebugPanel";
import { LogPanel } from "./LogPanel";
import { SettingsPanel } from "./SettingsPanel";
import { StatsPanel } from "./StatsPanel";
import { ChangelogPanel } from "./ChangelogPanel";
import type { AgentProfile, AppSettings, AppStatus, ProviderPreset } from "../../shared/types";
import { DEFAULT_PROMPT_CONFIG } from "../../shared/defaults";
import {
  getActiveAgent,
  syncLegacyAgentFields,
  updateAgent,
} from "../view-model";

export function Dashboard({ status }: { status: AppStatus }) {
  const [settings, setSettings] = useState(status.settings);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(false);
  const [busyElapsed, setBusyElapsed] = useState(0);
  const [guideOpen, setGuideOpen] = useState(!status.settings.guideDismissed);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logsOpen, setLogsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);

  const activeAgent = getActiveAgent(settings);

  useEffect(() => {
    void window.hearthstoneAgent.hasApiKey(activeAgent.id).then(setHasApiKey);
  }, [activeAgent.id]);
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
    const next = updateAgent(settings, activeAgent.id, patch);
    setSettings(next);
    void window.hearthstoneAgent.saveSettings(next);
  };

  const updateSettings = (next: AppSettings) => {
    setSettings(next);
    void window.hearthstoneAgent.saveSettings(next);
  };

  const switchAgent = (agentId: string) => {
    const nextAgent = settings.agents.find(agent => agent.id === agentId);
    if (!nextAgent) return;
    const next = syncLegacyAgentFields({ ...settings, activeAgentId: agentId }, nextAgent);
    setSettings(next);
    void window.hearthstoneAgent.saveSettings(next);
    setApiKey("");
  };

  const addAgent = (preset?: ProviderPreset) => {
    const nextAgent: AgentProfile = {
      id: `agent-${Date.now()}`,
      name: preset?.label ?? `Agent ${settings.agents.length + 1}`,
      apiUrl: preset?.apiUrl ?? "http://127.0.0.1:8001/v1/chat/completions",
      model: preset?.model ?? "",
      format: preset?.format ?? "chat-completions",
      timeoutMs: activeAgent.timeoutMs,
      promptConfig: { ...DEFAULT_PROMPT_CONFIG },
    };
    const next = syncLegacyAgentFields({
      ...settings,
      agents: [...settings.agents, nextAgent],
      activeAgentId: nextAgent.id,
    }, nextAgent);
    setSettings(next);
    void window.hearthstoneAgent.saveSettings(next);
    setApiKey("");
  };

  const doRemoveActiveAgent = () => {
    const remaining = settings.agents.filter(agent => agent.id !== activeAgent.id);
    const next = syncLegacyAgentFields({ ...settings, agents: remaining, activeAgentId: remaining[0]?.id }, remaining[0]);
    setSettings(next);
    setApiKey("");
    setDeleteConfirmOpen(false);
    void window.hearthstoneAgent.saveSettings(next);
  };

  const requestRemoveAgent = () => {
    if (settings.agents.length <= 1) return;
    setDeleteConfirmOpen(true);
  };

  const dismissGuide = () => {
    setGuideOpen(false);
    if (!settings.guideDismissed) {
      window.hearthstoneAgent.saveSettings({ ...settings, guideDismissed: true }).catch(() => {});
    }
  };

  const snapshot = status.snapshot;
  const analysis = status.analysis;

  return (
    <div className="app-shell">
      <div className="dashboard">
        <DashboardHeader
          busy={status.busy}
          onAnalyze={() => void window.hearthstoneAgent.analyze()}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleOverlay={() => void window.hearthstoneAgent.toggleOverlay()}
          onOpenGuide={() => setGuideOpen(true)}
          onOpenLogs={() => setLogsOpen(true)}
          onOpenDebug={() => setDebugOpen(true)}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenStats={() => setStatsOpen(true)}
          onMinimize={() => void window.hearthstoneAgent.minimizeWindow()}
          onMaximize={() => void window.hearthstoneAgent.maximizeWindow()}
          onClose={() => setCloseConfirmOpen(true)}
        />

        <DossierBar status={status} activeAgent={activeAgent} busyElapsed={busyElapsed} />

        {status.message && <div className="message-bar">{status.message}</div>}

        <div className="dash-body">
          <BattlefieldPanel
            snapshot={snapshot}
            busy={status.busy}
            onStopAnalysis={() => void window.hearthstoneAgent.stopAnalysis()}
          />
          <AdvisorPanel
            analysis={analysis}
            settings={settings}
            activeAgent={activeAgent}
            message={status.message}
            selectedCandidate={selectedCandidate}
            onSelectCandidate={setSelectedCandidate}
          />
        </div>
        <div className="dashboard-footer">
          <span className="changelog-link" onClick={() => setChangelogOpen(true)}>v1.3.0</span>
        </div>
      </div>

      {guideOpen && <GuideOverlay settings={settings} powerLogConfig={status.powerLogConfig} onClose={dismissGuide} />}

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

      {deleteConfirmOpen && (
        <HearthstoneConfirm
          title={`删除 Agent「${activeAgent.name}」`}
          message="删除后该 Agent 的配置将被移除，此操作不可撤销。"
          confirmText="确认删除"
          cancelText="取消"
          onCancel={() => setDeleteConfirmOpen(false)}
          onConfirm={doRemoveActiveAgent}
        />
      )}

      {logsOpen && <LogPanel onClose={() => setLogsOpen(false)} />}

      {debugOpen && <DebugPanel onClose={() => setDebugOpen(false)} />}

      {historyOpen && <HistoryPanel onClose={() => setHistoryOpen(false)} />}

      {statsOpen && <StatsPanel onClose={() => setStatsOpen(false)} />}

      {changelogOpen && <ChangelogPanel onClose={() => setChangelogOpen(false)} />}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          apiKey={apiKey}
          hasApiKey={hasApiKey}
          activeAgent={activeAgent}
          onUpdateSettings={updateSettings}
          onSetApiKey={setApiKey}
          onSave={save}
          onClose={() => setSettingsOpen(false)}
          onSwitchAgent={switchAgent}
          onAddAgent={addAgent}
          onRemoveAgent={requestRemoveAgent}
          onUpdateAgent={updateActiveAgent}
        />
      )}
    </div>
  );
}
