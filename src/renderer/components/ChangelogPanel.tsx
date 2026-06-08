interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

const CHANGELOG: ChangelogEntry[] = [
  {
    version: "1.3.0",
    date: "2026-06-08",
    items: [
      "提示词配置面板：系统提示词段落独立开关，支持自定义用户提示词追加到末尾",
      "胜率估算段落独立控制，可在提示词配置中单独启用/禁用",
      "新增悬浮球视图（BallView），全局拖拽定位",
      "新增调试面板，实时查看内部状态与诊断信息",
      "新增对局日志面板，实时浏览 Power.log 解析内容",
      "新增分析历史浏览面板，支持展开查看完整 AI 回复",
      "新增采纳统计面板，显示全局与分 Agent 统计",
      "新增版本更新日志面板",
      "设置面板全面重写：Agent 配置 + 提示词配置分组布局",
      "样式系统大规模翻新：黄金主题配色、卡片式布局、统一暗色风格",
      "Agent 客户端、Prompt 构建器、分析管线等模块解耦提取",
      "提供商 fallback 选择器增强，API 超时与错误处理完善",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-06-07",
    items: [
      "分析请求改用 json_schema 优先，兼容不支持 strict schema 的提供商自动降级到 json_object",
      "默认超时调整，max_tokens 从 2000 优化至 1200",
      "悬浮窗每次打开默认回到屏幕左侧居中位置（距左 10px）",
      "采纳统计扩容为三列布局，新增「建议总数」和「已匹配操作」卡片",
      "AI 响应时间记录与展示（分析记录页 + 悬浮窗）",
      "分析记录面板放宽至 640px",
      "所有 UI 中「Power.log」改为「对局日志」",
      "采纳统计 per-agent 行增加采纳次数字段",
    ],
  },
  {
    version: "1.1.0",
    date: "2026-06-01",
    items: [
      "新增采纳跟踪系统：快照 diff 检测玩家操作，匹配 AI 候选路线",
      "分析记录浏览面板（📜），支持展开查看完整 AI 回复",
      "采纳统计面板（📊），显示全局采纳率及分 Agent 统计",
      "Overlay 悬浮栏支持切换 Agent、显示 Token 使用量",
      "分析按钮显示等待时间（分析中 Ns）",
      "Overlay 文字修复（pre-wrap 代替 nowrap，避免截断）",
      "API 密钥改用 Electron safeStorage 加密存储",
      "提供商预设模板支持一键配置 9 家厂商",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-05-28",
    items: [
      "初始版本：局面采集与分析",
      "Agent 多配置文件管理",
      "悬浮栏 Overlay 窗口",
      "本地校验 + JSON 修复重试",
      "视觉特征校验",
    ],
  },
];

interface ChangelogPanelProps {
  onClose: () => void;
}

export function ChangelogPanel({ onClose }: ChangelogPanelProps) {
  return (
    <div className="guide-overlay">
      <div className="changelog-panel">
        <div className="settings-header">
          <h2>📰 更新日志</h2>
          <button className="close-btn" style={{
            background:"transparent",border:"1px solid rgba(201,160,74,0.12)",color:"var(--text-muted)",
            width:28,height:28,borderRadius:"50%",fontSize:14,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"
          }} onClick={onClose}>×</button>
        </div>
        <div className="changelog-list">
          {CHANGELOG.map(entry => (
            <div key={entry.version} className="changelog-entry">
              <div className="changelog-version">{entry.version} <span className="changelog-date">· {entry.date}</span></div>
              <ul className="changelog-items">
                {entry.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
