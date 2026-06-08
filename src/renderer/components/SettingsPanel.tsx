import { Fragment, useCallback, useState } from "react";
import type { AgentProfile, AppSettings, PromptSections, ProviderPreset } from "../../shared/types";
import { DEFAULT_PROMPT_SECTIONS, PROVIDER_PRESETS } from "../../shared/defaults";
import { HearthstoneToast } from "./HearthstoneToast";
import { HearthstoneConfirm } from "./HearthstoneConfirm";

interface SettingsPanelProps {
  settings: AppSettings;
  apiKey: string;
  hasApiKey: boolean;
  activeAgent: AgentProfile;
  onUpdateSettings: (settings: AppSettings) => void;
  onSetApiKey: (apiKey: string) => void;
  onSave: () => void;
  onClose: () => void;
  onSwitchAgent: (id: string) => void;
  onAddAgent: (preset?: ProviderPreset) => void;
  onRemoveAgent: () => void;
  onUpdateAgent: (patch: Partial<AgentProfile>) => void;
}

export function SettingsPanel({
  settings,
  apiKey,
  hasApiKey,
  activeAgent,
  onUpdateSettings,
  onSetApiKey,
  onSave,
  onClose,
  onSwitchAgent,
  onAddAgent,
  onRemoveAgent,
  onUpdateAgent,
}: SettingsPanelProps) {
  const [dirty, setDirty] = useState(false);
  const [presetPickOpen, setPresetPickOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [confirmClosePending, setConfirmClosePending] = useState(false);
  const [promptModal, setPromptModal] = useState<{ body: string } | null>(null);

  const markDirty = useCallback(() => setDirty(true), []);

  const handleUpdateSettings = useCallback((next: AppSettings) => {
    setDirty(true);
    onUpdateSettings(next);
  }, [onUpdateSettings]);

  const handleUpdateAgent = useCallback((patch: Partial<AgentProfile>) => {
    setDirty(true);
    onUpdateAgent(patch);
  }, [onUpdateAgent]);

  const handleSetApiKey = useCallback((key: string) => {
    setDirty(true);
    onSetApiKey(key);
  }, [onSetApiKey]);

  const handleAddAgent = useCallback((preset?: ProviderPreset) => {
    setDirty(true);
    onAddAgent(preset);
  }, [onAddAgent]);

  const handleRemoveAgent = useCallback(() => {
    setDirty(true);
    onRemoveAgent();
  }, [onRemoveAgent]);

  const handleSave = useCallback(() => {
    onSave();
    setDirty(false);
    setToast({ message: "设置已保存", type: "success" });
  }, [onSave]);

  const handleClose = useCallback(() => {
    if (dirty) {
      setConfirmClosePending(true);
    } else {
      onClose();
    }
  }, [dirty, onClose]);

  return (
    <><div className="guide-overlay" onClick={handleClose} style={{zIndex:99}}>
      <div className="settings-panel" onClick={e => e.stopPropagation()}>
        <div className="settings-header">
          <h2>⚙️ 设置</h2>
          <button className="close-btn" style={{
            background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
            width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }} onClick={handleClose}>×</button>
        </div>
        <div className="settings-body">
          <div className="settings-group">
            <div className="group-label">Agent 配置</div>
            <div className="field-row">
              <label>当前 Agent</label>
              <select value={activeAgent.id} onChange={e => onSwitchAgent(e.target.value)}>
                {settings.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </div>
            {presetPickOpen && (
              <div className="guide-overlay" onClick={() => setPresetPickOpen(false)} style={{position:"absolute",inset:0,zIndex:110}}>
                <div className="preset-picker" onClick={e => e.stopPropagation()}>
                  <h3>选择厂商模板</h3>
                  <div className="preset-grid">
                    {PROVIDER_PRESETS.map(p => (
                      <button className="preset-btn" key={p.label} onClick={() => { handleAddAgent(p); setPresetPickOpen(false); }}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <div className="preset-actions">
                    <button className="preset-skip" onClick={() => { handleAddAgent(); setPresetPickOpen(false); }}>空白配置</button>
                    <button className="preset-cancel" onClick={() => setPresetPickOpen(false)}>取消</button>
                  </div>
                </div>
              </div>
            )}
            <div className="field-row">
              <label>名称</label>
              <input value={activeAgent.name} onChange={e => handleUpdateAgent({ name: e.target.value })} />
            </div>
            <div className="field-row">
              <label>接口地址</label>
              <input value={activeAgent.apiUrl} placeholder="完整 API 地址，如 https://api.openai.com/v1/chat/completions" onChange={e => handleUpdateAgent({ apiUrl: e.target.value })} />
            </div>
            <div className="field-row">
              <label>模型</label>
              <input value={activeAgent.model} placeholder="由供应商提供" onChange={e => handleUpdateAgent({ model: e.target.value })} />
            </div>
            <div className="field-row">
              <label>API Key {hasApiKey ? "（已保存）" : "（未保存）"}</label>
              <input type="password" value={apiKey} placeholder="留空则不使用 API Key" onChange={e => handleSetApiKey(e.target.value)} />
            </div>
            <div className="field-row">
              <label>超时 (ms)</label>
              <input type="number" value={activeAgent.timeoutMs} onChange={e => handleUpdateAgent({ timeoutMs: Number(e.target.value) })} />
            </div>
            <div className="settings-actions">
              <button className="btn-save" onClick={() => setPresetPickOpen(true)}>新增 Agent</button>
              <button className="btn-test" onClick={handleRemoveAgent} disabled={settings.agents.length <= 1}>删除</button>
            </div>
          </div>

          {activeAgent.promptConfig && (
            <div className="settings-group">
              <div className="group-label">提示词配置</div>
              <div className="section-hint">勾选要发送到 AI 的系统提示词段落</div>
              {([
                ["roleSetting", "角色设定"],
                ["infoConstraint", "信息边界"],
                ["goalDefinition", "目标定义"],
                ["refConstraint", "引用约束"],
                ["fieldConstraint", "字段规则"],
                ["descConstraint", "描述规则"],
                ["coinConstraint", "幸运币规则"],
                ["candidateConstraint", "路线约束"],
                ["formatConstraint", "输出格式"],
              ] as const).map(([key, label]) => (
                <div className="toggle-row" key={key}>
                  <span className="toggle-label">{label}</span>
                  <div
                    className={`toggle${activeAgent.promptConfig!.systemPromptSections[key] ? " on" : ""}`}
                    onClick={() => {
                      const updated = {
                        ...activeAgent,
                        promptConfig: {
                          ...activeAgent.promptConfig!,
                          systemPromptSections: {
                            ...activeAgent.promptConfig!.systemPromptSections,
                            [key]: !activeAgent.promptConfig!.systemPromptSections[key],
                          },
                        },
                      };
                      handleUpdateAgent(updated);
                    }}
                  />
                </div>
              ))}
              <div className="field-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
                <label style={{ minWidth: "unset" }}>自定义用户提示词（追加到请求末尾）</label>
                <textarea
                  className="prompt-textarea"
                  rows={4}
                  placeholder="输入自定义提示词内容…"
                  value={activeAgent.promptConfig.customUserPrompt}
                  onChange={e => {
                    handleUpdateAgent({
                      promptConfig: {
                        ...activeAgent.promptConfig!,
                        customUserPrompt: e.target.value,
                      },
                    });
                  }}
                />
              </div>
            </div>
          )}

          <div className="settings-group">
            <div className="group-label">通用</div>
            <div className="field-row">
              <label>对局日志路径</label>
              <input value={settings.powerLogPath} onChange={e => handleUpdateSettings({ ...settings, powerLogPath: e.target.value })} />
            </div>
            <div className="field-row">
              <label></label>
              <button
                className="btn-guide btn-guide-sm"
                onClick={async () => { try { const r = await window.hearthstoneAgent.enablePowerLogging(); setToast({ message: r.message, type: r.ok ? "success" : "error" }); } catch { setToast({ message: "操作失败", type: "error" }); } }}
              >
                ⚡ 自动配置 options.txt
              </button>
            </div>
            <div className="field-row">
              <label>候选路线数</label>
              <input type="number" min={1} max={5} value={settings.maxCandidates} onChange={e => handleUpdateSettings({ ...settings, maxCandidates: Number(e.target.value) })} />
            </div>
            <div className="field-row">
              <label>语言</label>
              <select value={settings.language} onChange={e => handleUpdateSettings({ ...settings, language: e.target.value as "zhCN" | "enUS" })}>
                <option value="zhCN">中文</option>
                <option value="enUS">English</option>
              </select>
            </div>
          </div>

          <div className="settings-group">
            <div className="group-label">功能开关</div>
            <div className="toggle-row">
              <span className="toggle-label">自动分析</span>
              <div className={`toggle${settings.autoAnalyze ? " on" : ""}`} onClick={() => {
                handleUpdateSettings({ ...settings, autoAnalyze: !settings.autoAnalyze });
              }} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">实时建议</span>
              <div className={`toggle${settings.liveRecommendationsEnabled ? " on" : ""}`} onClick={() => handleUpdateSettings({ ...settings, liveRecommendationsEnabled: !settings.liveRecommendationsEnabled })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">多 Agent 对比</span>
              <div className={`toggle${settings.multiAgentCompareEnabled ? " on" : ""}`} onClick={() => handleUpdateSettings({ ...settings, multiAgentCompareEnabled: !settings.multiAgentCompareEnabled })} />
            </div>
            <div className="toggle-row">
              <span className="toggle-label">胜率估算</span>
              <div className={`toggle${settings.winRateEstimationEnabled ? " on" : ""}`} onClick={() => handleUpdateSettings({ ...settings, winRateEstimationEnabled: !settings.winRateEstimationEnabled })} />
            </div>
          </div>

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

          <div className="settings-group">
            <div className="group-label">调试</div>
            <div className="field-row">
              <label></label>
              <button
                className="btn-guide btn-guide-sm"
                onClick={async () => {
                  try {
                    const data = await window.hearthstoneAgent.getLastAgentRequest();
                    setPromptModal({ body: data ? JSON.stringify(data, null, 2) : "暂无可用的请求记录——请先执行一次分析。" });
                  } catch {
                    setPromptModal({ body: "获取失败" });
                  }
                }}
              >
                📋 查看完整 Prompt
              </button>
            </div>
            <div className="field-row">
              <label></label>
              <button
                className="btn-guide btn-guide-sm"
                onClick={() => void window.hearthstoneAgent.openPowerLog()}
              >
                📄 查看 Power.log
              </button>
            </div>
          </div>

          <div className="settings-actions" style={{padding:"0 4px",marginTop:4}}>
            <button className="btn-save" onClick={handleSave}>保存设置</button>
            <button className="btn-test" onClick={async () => {
              try {
                const s = await window.hearthstoneAgent.testAgentConnection();
                setToast({ message: s.message ?? "连接成功", type: "success" });
              } catch {
                setToast({ message: "连接失败", type: "error" });
              }
            }}>测试连接</button>
          </div>
        </div>
      </div>
    </div>

    {promptModal && (
      <div className="guide-overlay" onClick={() => setPromptModal(null)} style={{zIndex:120}}>
        <div className="prompt-modal" onClick={e => e.stopPropagation()}>
          <div className="prompt-modal-header">
            <h3>完整 Prompt</h3>
            <button className="close-btn" onClick={() => setPromptModal(null)} style={{
              background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
              width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
            }}>×</button>
          </div>
          <textarea className="prompt-viewer" readOnly value={promptModal.body} spellCheck={false} />
        </div>
      </div>
    )}

    {toast && (
      <HearthstoneToast message={toast.message} type={toast.type} onClose={() => setToast(null)} />
    )}

    {confirmClosePending && (
      <HearthstoneConfirm
        title="放弃更改？"
        message="当前设置尚未保存，离开后更改将丢失。"
        confirmText="放弃"
        cancelText="继续编辑"
        onCancel={() => setConfirmClosePending(false)}
        onConfirm={() => { setConfirmClosePending(false); onClose(); }}
      />
    )}
  </>);
}
