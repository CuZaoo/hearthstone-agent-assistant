import type { AgentProfile, AppSettings } from "../../shared/types";

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
  onAddAgent: () => void;
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
          <div className="settings-group">
            <div className="group-label">Agent 配置</div>
            <div className="field-row">
              <label>当前 Agent</label>
              <select value={activeAgent.id} onChange={e => onSwitchAgent(e.target.value)}>
                {settings.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
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

          <div className="settings-actions" style={{padding:"0 4px",marginTop:4}}>
            <button className="btn-save" onClick={onSave}>保存设置</button>
            <button className="btn-test" onClick={() => void window.hearthstoneAgent.testAgentConnection()}>测试连接</button>
          </div>
        </div>
      </div>
    </div>
  );
}
