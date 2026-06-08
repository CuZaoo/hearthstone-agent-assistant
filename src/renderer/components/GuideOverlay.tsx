import { useState, type ReactNode } from "react";
import type { AppSettings } from "../../shared/types";
import { PROVIDER_PRESETS } from "../../shared/defaults";

export function GuideOverlay({
  settings,
  powerLogConfig,
  onClose,
}: {
  settings: AppSettings;
  powerLogConfig?: { ok: boolean; message: string };
  onClose: () => void;
}) {
  const [configResult, setConfigResult] = useState<{ ok: boolean; message: string } | undefined>(powerLogConfig);
  const [configuring, setConfiguring] = useState(false);

  const handleConfigure = async () => {
    setConfiguring(true);
    try {
      const result = await window.hearthstoneAgent.enablePowerLogging();
      setConfigResult(result);
    } catch {
      setConfigResult({ ok: false, message: "操作失败，请检查权限后重试。" });
    } finally {
      setConfiguring(false);
    }
  };

  return (
    <div className="guide-overlay" onClick={onClose}>
      <div className="guide-panel" onClick={e => e.stopPropagation()}>
        <div className="guide-header">
          <h2>~ 旅店指南 ~</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        <div className="guide-body">
          <GuideStep num={1} title="启动与连接">
            启动炉石进入对局后，程序自动读取对局日志并识别局面状态。
            <br /><br />
            {configResult === undefined ? (
              <button
                className="btn-guide btn-guide-sm"
                onClick={handleConfigure}
                disabled={configuring}
              >
                {configuring ? "正在配置…" : "⚡ 自动配置对局日志"}
              </button>
            ) : configResult.ok ? (
              <span style={{ color: "var(--green)" }}>✓ {configResult.message}</span>
            ) : (
              <>
                <span style={{ color: "var(--amber)" }}>⚠ {configResult.message}</span>
                <br /><br />
                <button
                  className="btn-guide btn-guide-sm"
                  onClick={handleConfigure}
                  disabled={configuring}
                >
                  {configuring ? "正在重试…" : "🔄 重试"}
                </button>
                <br /><br />
                也可以手动在炉石安装目录的 <kbd>options.txt</kbd> 中添加 <kbd>displaypowerlog=1</kbd>。
              </>
            )}
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
              在设置面板中配置 AI 提供商，支持配置多个 Agent 并切换使用。
              <br /><br />
              <strong>使用厂商模板快速配置：</strong><br />
              在设置 → Agent 配置 → <kbd>厂商模板</kbd> 下拉中选择你的提供商，
              系统将自动填入完整接口地址和模型，只需再填写 API Key 即可。
               <br /><br />
               支持以下提供商模板：{PROVIDER_PRESETS.map(p => p.label).join("、")}。
               <br /><br />
               <strong>💡 提示：</strong>智谱 AI (GLM) 提供免费的 <kbd>glm-4-flash</kbd> 模型，
               已设为默认 API，零成本即可体验。
               <br /><br />
               配置完成后点击"测试连接"确认连通性，然后保存设置。
            </GuideStep>
        </div>
        <div className="guide-footer">
          <button className="btn-guide" onClick={onClose}>开始使用</button>
        </div>
      </div>
    </div>
  );
}

function GuideStep({ num, title, children }: { num: number; title: string; children: ReactNode }) {
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
