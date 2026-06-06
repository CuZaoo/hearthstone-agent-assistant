import { useEffect, useState } from "react";
import { AdvisorPanel } from "./AdvisorPanel";
import { BattlefieldPanel } from "./BattlefieldPanel";
import { DashboardHeader } from "./DashboardHeader";
import { DossierBar } from "./DossierBar";
import { HearthstoneConfirm } from "./HearthstoneConfirm";
import { GuideOverlay } from "./GuideOverlay";
import { SettingsPanel } from "./SettingsPanel";
import type { AgentProfile, AppStatus } from "../../shared/types";
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
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<number | null>(null);

  const activeAgent = getActiveAgent(settings);

  useEffect(() => setSettings(status.settings), [status.settings]);
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

  return (
    <div className="app-shell">
      <div className="dashboard">
        <DashboardHeader
          busy={status.busy}
          onAnalyze={() => void window.hearthstoneAgent.analyze()}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggleOverlay={() => void window.hearthstoneAgent.toggleOverlay()}
          onOpenGuide={() => setGuideOpen(true)}
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
