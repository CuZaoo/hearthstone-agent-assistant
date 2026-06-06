import type { ReactNode } from "react";
import type { AppSettings } from "../../shared/types";

export function GuideOverlay({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
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
