# 提示词配置功能设计

## 目标

在 Agent 设置中提供提示词的可配置能力：
1. **段落开关** — System Prompt 中各规则段落可独立勾选是否发送
2. **自定义用户提示词** — 用户可编写自定义 prompt 追加到 user content 末尾

## 数据模型

```typescript
// 新增：src/shared/types.ts
export interface PromptConfig {
  systemPromptSections: PromptSections;
  customUserPrompt: string;
}

export interface PromptSections {
  roleSetting: boolean;        // "你是炉石传说对局分析助手。"
  infoConstraint: boolean;     // "不得假设对手手牌、牌库顺序或随机结果。"
  goalDefinition: boolean;     // "提供当前回合的高质量候选路线，不得声称最优。"
  refConstraint: boolean;      // "每条路线必须引用请求中存在的实体 ID..."
  fieldConstraint: boolean;    // "sourceCardId 必须与 sourceEntityId 对应…"
  descConstraint: boolean;     // "description 只描述动作本身..."
  coinConstraint: boolean;     // "幸运币或其他'本回合获得法力'的牌..."
  candidateConstraint: boolean;// "不满足约束的路线不要返回。"
  formatConstraint: boolean;   // "只返回 JSON，不要 Markdown..."
}

// 改动：AgentProfile 新增字段
export interface AgentProfile {
  // ... 现有字段
  promptConfig?: PromptConfig;
}
```

## 默认值

所有 `PromptSections` 字段默认 `true`，`customUserPrompt` 默认空字符串，保证向后兼容。

## 修改文件

| 文件 | 改动 |
|------|------|
| `src/shared/types.ts` | 新增 `PromptConfig`、`PromptSections` 接口，`AgentProfile` 加 `promptConfig?` |
| `src/shared/defaults.ts` | 导出 `DEFAULT_PROMPT_SECTIONS`、`DEFAULT_PROMPT_CONFIG` |
| `src/shared/settings-model.ts` | 无改动（`updateAgent` 通过解构自动携带新字段） |
| `src/main/settings-store.ts` | `normalizeAgent()` 处理 `promptConfig` 的 fallback 和归约 |
| `src/core/agent-prompt.ts` | `systemPrompt()` 接受 `PromptSections` 参数过滤段落；`buildUserContent()` 接受 `customUserPrompt` 追加 |
| `src/core/agent-client.ts` | 构造函数 Pick 增加 `promptConfig`，透传给 prompt 函数 |
| `src/main/agent-analysis-runner.ts` | 从 `agent.promptConfig` 传入 `AgentClient` |
| `src/renderer/components/SettingsPanel.tsx` | 新增"提示词配置"分组 UI：复选框列表 + 多行文本域 |
| `src/renderer/styles.css` | 复选框和文本域样式 |

## UI 布局

在设置面板的"Agent 配置"下方新增"提示词配置"分组：

```
┌─ 提示词配置 ──────────────────────────────┐
│                                            │
│  勾选要发送到 AI 的系统提示词段落：          │
│  ☑ 角色设定                                │
│  ☑ 信息边界                                │
│  ☑ 目标定义                                │
│  ☑ 引用约束                                │
│  ☑ 字段规则                                │
│  ☑ 描述规则                                │
│  ☑ 幸运币规则                              │
│  ☑ 路线约束                                │
│  ☑ 输出格式                                │
│                                            │
│  自定义用户提示词（追加到请求末尾）：         │
│  ┌────────────────────────────────────┐    │
│  │                                    │    │
│  │  (多行文本域)                       │    │
│  │                                    │    │
│  └────────────────────────────────────┘    │
└────────────────────────────────────────────┘
```

## 核心逻辑

### systemPrompt 改造

```typescript
function systemPrompt(
  sections: PromptSections,
  winRateEstimationEnabled: boolean,
): string {
  const lines: string[] = [];
  if (sections.roleSetting) lines.push("你是炉石传说对局分析助手。");
  if (sections.infoConstraint) lines.push("你只能使用请求中明确提供的可见信息，不得假设对手手牌、牌库顺序或随机结果。");
  if (sections.goalDefinition) lines.push("你的目标是提供当前回合的高质量候选路线，不得声称路线是数学最优。");
  if (sections.refConstraint) lines.push("每条路线必须引用请求中存在的实体 ID，并说明理由、主要风险与置信度。");
  if (winRateEstimationEnabled) lines.push("对每条路线估算 winRateBefore（执行前胜率）和 winRateAfter（执行后胜率），范围 0~1。");
  if (sections.fieldConstraint) lines.push("sourceCardId 必须与 sourceEntityId 对应实体的 cardId 完全一致；end-turn 不得携带来源或目标。");
  if (sections.descConstraint) lines.push("description 只描述动作本身，例如"打出神圣新星"或"卡多雷女祭司攻击敌方英雄"，不得把法术写成战吼，不得编造卡牌文本外的效果。");
  if (sections.coinConstraint) lines.push("幸运币或其他"本回合获得法力"的牌只能在后续动作会立刻使用这点法力时打出；不得推荐"打出幸运币，然后结束回合"。");
  if (sections.candidateConstraint) lines.push("如果某条路线无法满足实体、费用、攻击、目标和场面容量约束，就不要返回这条路线。");
  if (sections.formatConstraint) lines.push("只返回一个 JSON 对象，不要 Markdown，不要代码块，不要解释性前后缀。");
  return lines.join("\n");
}
```

### user content 改造

在 `buildUserContent()` 末尾追加 `customUserPrompt`（如果非空）。

### AgentClient 改造

Pick 增加 `promptConfig` 字段，调用 prompt 函数时从中提取 `systemPromptSections` 和 `customUserPrompt`。

## 向后兼容

- 持久化数据中 `promptConfig` 不存在 → 全部段落启用，无自定义内容
- `normalizeAgent()` 中加 fallback：`promptConfig: asRecord(agent.promptConfig) ? normalizePromptConfig(agent.promptConfig) : undefined`
