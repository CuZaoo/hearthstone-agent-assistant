# Hearthstone Agent Assistant · 炉石对局 Agent 助手

<p align="center">
  <img src="public/icon.svg" width="120" alt="App Icon" />
</p>

<p align="center">
  <em>A read-only, privacy-first AI assistant for Hearthstone — analyze your board, get optimal play suggestions from LLMs.</em><br />
  <em>只读、隐私优先的炉石对局 AI 助手。解析局面、调用你选择的 AI 模型，获取回合建议。</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-34-blue?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?logo=vite" alt="Vite" />
  <img src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/status-alpha-yellow" alt="Status" />
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

**Hearthstone Agent Assistant** is a desktop application that reads Hearthstone's `Power.log` and your screen, builds a structured game state snapshot, and sends it to an LLM (Large Language Model) of your choice for strategic analysis. It is **read-only by design** — it never clicks, plays cards, injects into the game process, reads memory, or bypasses anti-cheat.

**炉石对局 Agent 助手** 是一款桌面应用，通过读取炉石传说的 `Power.log` 和屏幕截图，构建结构化局面快照，发送给你选择的 AI 模型进行战略分析。**设计上只读**——不点击、不出牌、不注入游戏进程、不读取内存、不绕过反作弊。

---

## ✨ Features · 功能特性

| | English | 中文 |
|---|---|---|
| 🔒 | **Read-Only & Privacy-First** — Only reads Power.log and screenshots locally. A dedicated sanitization layer strips player names, raw tags, and timestamps before any data reaches AI providers. Screenshots are used only for local visual validation and never transmitted. | **只读且隐私优先** ——仅读取本地 Power.log 和截图；专用脱敏层在数据发送前移除玩家名称、原始标签和时间戳；截图仅用于本地视觉校验，永不发送。 |
| 🤖 | **Multi-Provider AI** — Works with 9+ LLM providers including OpenAI, DeepSeek, Zhipu GLM, Qwen, Kimi, SiliconFlow, MiniMax, Doubao, and Ollama. Supports both Responses API and Chat Completions API. | **多 AI 服务商** ——支持 OpenAI、DeepSeek、智谱 GLM、Qwen、Kimi、硅基流动、MiniMax、豆包、Ollama 等 9+ 家服务商，兼容 Responses API 与 Chat Completions API。 |
| 🧠 | **Full Power.log Parser** — A hand-crafted state machine that parses Hearthstone's debug log format (TAG_CHANGE, SHOW_ENTITY, FULL_ENTITY, BLOCK_START/END). Handles multi-GB files, SHA1 deduplication, file rotation, and auto-discovery of the latest session log. | **完整 Power.log 解析器** ——手写状态机，解析炉石调试日志格式（TAG_CHANGE、SHOW_ENTITY、FULL_ENTITY、BLOCK_START/END），处理多 GB 文件、SHA1 去重、文件轮转和最新会话日志自动发现。 |
| 👁️ | **Visual Validation** — Captures screenshots of the Hearthstone window and validates card positions using difference hashing (dHash). Matches on-screen card art against the built-in card catalog to verify that log state matches what you actually see. | **视觉校验** ——截取炉石窗口截图，使用差分哈希（dHash）验证卡牌位置，将屏幕上的卡牌美术与内置卡牌目录比对，确保日志状态与画面一致。 |
| 📊 | **Adoption Tracking** — Automatically detects which of the AI's recommended actions you actually took by comparing pre-turn and post-turn snapshots. Track your adoption rate per agent over time. | **采纳追踪** ——通过对比回合前后的快照，自动识别你实际执行了 AI 的哪些推荐动作，追踪每个 Agent 的历史采纳率。 |
| 🧩 | **Multi-Agent Comparison** — Query multiple LLM providers in parallel, merge results ranked by confidence score, and see which agent suggested what. | **多 Agent 对比** ——并行查询多个 AI 模型，按置信度排序融合结果，直观对比各家的建议差异。 |
| 🛡️ | **Structured Output with Graceful Fallback** — Uses OpenAI-compatible `json_schema` structured output when available. Falls back to `json_object` for providers that don't support strict schemas, then validates everything locally. Three layers of reliability. | **结构化输出 + 优雅降级** ——优先使用 `json_schema` 结构化输出，对不支持严格 schema 的服务商自动降级为 `json_object`，最后用本地校验确保结果合法。三层可靠性保障。 |
| 🖥️ | **Triple-Window UI** — A full dashboard (frameless, resizable), a transparent overlay (always-on-top, pinned), and a minimized draggable ball. Hotkeys: `Ctrl+Shift+A` to analyze, `Ctrl+Shift+O` to toggle overlay. | **三窗口 UI** ——完整仪表盘（无边框、可缩放）、透明悬浮窗（置顶固定）和最小化拖拽球。快捷键：`Ctrl+Shift+A` 分析、`Ctrl+Shift+O` 切换悬浮窗。 |
| 🧹 | **Clean Architecture** — Separated into `core/` (pure logic, no Electron/React dependency), `main/` (Electron main process), `renderer/` (React UI), and `shared/` (types and defaults). Each layer has a single, well-defined responsibility. | **清晰架构** ——分为 `core/`（纯逻辑，无 Electron/React 依赖）、`main/`（Electron 主进程）、`renderer/`（React UI）和 `shared/`（类型与默认值）四层，各层职责单一。 |
| 🔑 | **Encrypted Credentials** — API keys are stored via Electron's safeStorage (Windows DPAPI). Never in plain-text settings files. | **凭据加密** ——API Key 通过 Electron safeStorage（Windows DPAPI）加密存储，永不以明文保存。 |

---

## 🖼️ Screenshots · 界面预览

<p align="center">
  <em><!-- Screenshots placeholder — replace with actual images --></em><br />
  <em><!-- 截图占位 —— 请替换为实际图片 --></em>
</p>

```
  ┌─ Dashboard ─────────────────────────────────┐
  │  [Status Bar]  │  Turn 5  │  Mana 4/5      │
  ├─────────────────────────────────────────────┤
  │  Hand: [Card] [Card] [Card] [Card]          │
  │  Board: [Minion] [Minion]                   │
  │  Opponent: [Minion] [Minion] [Secret]       │
  ├─────────────────────────────────────────────┤
  │  ┌─ Advisor ──────────────────────────────┐ │
  │  │  #1  Pyroblast to Face   ★ 0.85  70% │ │
  │  │  #2  Trade + Hero Power  ★ 0.72  62% │ │
  │  └───────────────────────────────────────┘ │
  └─────────────────────────────────────────────┘
```

---

## 🎯 How It Works · 工作原理

```
  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
  │ Power.log│───▶│  Parser  │───▶│Snapshot  │───▶│Sanitizer│───▶│   LLM    │───▶│   UI     │
  │ (Watcher)│    │(State    │    │+Enrich   │    │(Privacy) │    │(Agent)   │    │(React)   │
  └──────────┘    │ Machine) │    └──────────┘    └──────────┘    └──────────┘    └──────────┘
                  └──────────┘                                                    │
  ┌──────────┐                                                                ┌──▼─────────┐
  │Screenshot│───────────────────────────────────────────────────────────────▶│  Validator │
  │ (dHash)  │  (local only, never sent to AI)                               │(Local Check)│
  └──────────┘                                                                └────────────┘
```

| Step | What happens | 发生了什么 |
|------|-------------|-----------|
| 1 | The file watcher reads `Power.log` incrementally, parsing TAG_CHANGE, SHOW_ENTITY, FULL_ENTITY events through a state machine | 日志监视器增量读取 Power.log，通过状态机解析事件 |
| 2 | The parser builds a structured `GameStateSnapshot` — who the player is, hand cards, board minions, mana, secrets, weapon, turn count, etc. | 解析器构建结构化 `GameStateSnapshot`——玩家身份、手牌、场面随从、法力水晶、奥秘、武器、回合数等 |
| 3 | A screenshot is captured and validated locally via dHash against the card catalog (never sent to any AI provider) | 截取本地截图，通过 dHash 与卡牌目录比对校验（绝不发送给 AI） |
| 4 | The snapshot is sanitized: raw entity tags, player names, and timestamps are stripped. Only whitelisted, catalog-enriched data leaves your machine | 快照脱敏：移除原始标签、玩家名称和时间戳，仅白名单数据离开本机 |
| 5 | The sanitized snapshot is sent to your configured LLM (OpenAI, DeepSeek, etc.) with a structured prompt requesting candidate play lines with confidence scores and win rate estimates | 脱敏后的快照发送给你配置的 AI 模型，附带结构化提示词请求候选路线 |
| 6 | The AI response is parsed, validated locally (mana cost, taunt priority, board capacity, entity existence, etc.), and displayed as ranked candidates in the UI | 解析 AI 回复，本地校验（费用、嘲讽、场面容量、实体存在性等），在 UI 中以排名展示 |

---

## 🏗️ Architecture · 项目架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                     src/  (project source)                          │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      renderer/  (React UI)                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │   │
│  │  │Dashboard │ │OverlayBar│ │ BallView │ │ + 13 more      │  │   │
│  │  │  (main)  │ │(overlay) │ │(minimized)│ │   components   │  │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │   │
│  │  ┌────────────────────────────────────────────────────────┐  │   │
│  │  │  styles.css (2761 lines — Hearthstone dark theme)     │  │   │
│  │  └────────────────────────────────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          ↕  IPC (contextBridge)                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      main/  (Electron)                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │   │
│  │  │WindowManager│ │Analysis     │ │PowerLogRuntime          │ │   │
│  │  │ (3 windows) │ │Service      │ │ (Watcher + Parser)      │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘ │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────────────────┐ │   │
│  │  │SettingsStore│ │Credential   │ │HistoryDatabase (SQLite) │ │   │
│  │  │             │ │Store (DPAPI)│ │AdoptionTracker          │ │   │
│  │  └─────────────┘ └─────────────┘ └─────────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          ↕  direct calls                            │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      core/  (Pure Logic)                      │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐  │   │
│  │  │PowerLogParser  │ │ PowerLogWatcher│ │CardCatalog       │  │   │
│  │  │(524 lines —    │ │ (polling,      │ │ (JSON, build     │  │   │
│  │  │ state machine) │ │  file rotation)│ │  match, dHash)   │  │   │
│  │  └────────────────┘ └────────────────┘ └──────────────────┘  │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐  │   │
│  │  │AgentClient     │ │AgentPrompt     │ │AnalysisValidator │  │   │
│  │  │(retry, fallback│ │(system prompt  │ │(pre/post checks) │  │   │
│  │  │ JSON parsing)  │ │ builder)       │ │                  │  │   │
│  │  └────────────────┘ └────────────────┘ └──────────────────┘  │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐  │   │
│  │  │Snapshot        │ │Snapshot        │ │ActionValidator   │  │   │
│  │  │Sanitizer       │ │Enricher        │ │(mana, taunt,     │  │   │
│  │  │(privacy layer) │ │(catalog data)  │ │ board capacity)  │  │   │
│  │  └────────────────┘ └────────────────┘ └──────────────────┘  │   │
│  │  ┌────────────────┐ ┌────────────────┐                        │   │
│  │  │ActionHints     │ │VisualValidator │                        │   │
│  │  │(legal actions) │ │(dHash matching)│                        │   │
│  │  └────────────────┘ └────────────────┘                        │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                      shared/  (Types & Defaults)              │   │
│  │  ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐  │   │
│  │  │types.ts        │ │defaults.ts     │ │settings-model.ts │  │   │
│  │  │(43 interfaces) │ │(9 providers)   │ │(agent mgmt)      │  │   │
│  │  └────────────────┘ └────────────────┘ └──────────────────┘  │   │
│  └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Why This Architecture · 为什么这样分层

| Layer | Depends On | Responsibility | 职责 |
|-------|-----------|----------------|------|
| **`core/`** | Nothing (pure TS) | Business logic: parsing, validation, prompting, AI communication | 业务逻辑：解析、校验、提示词构建、AI 通信 |
| **`main/`** | `core/` + Electron | Process orchestration: windows, IPC, file I/O, credentials, history | 进程编排：窗口管理、IPC、文件读写、凭据、历史记录 |
| **`renderer/`** | React | UI rendering: dashboard, overlay, ball, settings, analysis display | UI 渲染：仪表盘、悬浮窗、设置、分析展示 |
| **`shared/`** | Nothing (pure TS) | Shared types, defaults, and utilities imported by all layers | 共享类型、默认值和工具函数，各层共用 |

---

## 🚀 Getting Started · 快速开始

### Prerequisites · 前置要求

- Windows 10/11
- [Node.js](https://nodejs.org/) >= 18
- Hearthstone with [Power.log enabled](https://github.com/HearthSim/Hearthstone-Deck-Tracker/wiki/Setting-up-the-log.config) (see below)
- An API key from your preferred LLM provider

### Install & Run · 安装与运行

```powershell
# Install dependencies
npm install

# Type-check (always a good start)
npm run typecheck

# Run tests
npm test

# Start development mode (Vite + tsc watch + Electron)
npm run dev
```

`npm run dev` starts Vite, the main process TypeScript watcher, and Electron simultaneously. The main process auto-restarts Electron on recompilation — much faster than rebuilding.

开发模式下同时启动 Vite、主进程 TypeScript watch 和 Electron；主进程重新编译后自动重启 Electron。

```powershell
# Build and run from compiled source
npm run build
npm run start:built

# Generate Windows installer
npm run package
```

### Diagnostics · 诊断日志

Logs are written to:

```
%APPDATA%\hearthstone-agent-assistant\diagnostics.jsonl
```

View recent analysis traces:

```powershell
Get-Content "$env:APPDATA\hearthstone-agent-assistant\diagnostics.jsonl" -Tail 80
```

---

## 🤖 AI Provider Setup · AI 服务商配置

The app comes with **9 pre-configured provider presets**. Select one in the settings panel and enter your API key — it's stored encrypted via Windows DPAPI, never in plain text.

应用内置 **9 个预置服务商**，在设置面板中选择后输入 API Key 即可——Key 通过 Windows DPAPI 加密存储。

| Provider | API URL | Model | Protocol |
|----------|---------|-------|----------|
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-chat` | Chat Completions |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o` | Responses API |
| **Zhipu GLM (智谱)** | `https://open.bigmodel.cn/api/paas/v4` | `glm-4-plus` | Chat Completions |
| **Qwen (千问)** | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | Chat Completions |
| **Kimi (月之暗面)** | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` | Chat Completions |
| **SiliconFlow (硅基流动)** | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3` | Chat Completions |
| **MiniMax** | `https://api.minimax.chat/v1` | `MiniMax-Text-01` | Chat Completions |
| **Doubao (豆包)** | `https://ark.cn-beijing.volces.com/api/v3` | (custom) | Chat Completions |
| **Ollama (local)** | `http://localhost:11434/v1` | `llama3` | Chat Completions |

### Structured Output Support · 结构化输出支持

If your Chat Completions provider doesn't support strict `json_schema`, the app automatically degrades to `json_object` mode, then validates the response locally — discarding any invalid candidate routes.

如果你的 Chat Completions 服务商不支持严格的 `json_schema`，应用会自动降级到 `json_object` 模式，再用本地校验拦截非法路线。

---

## 📋 Power.log Configuration · 日志配置

The app only reads Power.log — it does not modify Hearthstone's configuration automatically. Enable Power logging manually following [HDT's guide](https://github.com/HearthSim/Hearthstone-Deck-Tracker/wiki/Setting-up-the-log.config).

应用只读取 Power.log，不会自动修改炉石配置。请参考 HDT 的[日志配置说明](https://github.com/HearthSim/Hearthstone-Deck-Tracker/wiki/Setting-up-the-log.config)手动启用。

The app auto-discovers your Power.log across multiple locations:

应用自动在多个位置发现 Power.log：

- Configured path → `%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\Power.log`
- Hearthstone Deck Tracker config → Session directories (`Hearthstone_DateTime\Power.log`)
- Alternatively: reads HDT's config and switches to the latest session log

You can also diagnose any existing Power.log without installing dependencies:

```powershell
npm run log:diagnose -- `
  --log "E:\Hearthstone\Logs\Hearthstone_2026-06-08_12-00-00\Power.log"
```

This runs the app's `PowerLogParser` directly, outputting a summary of the latest game's mode, build, hand, and board.

---

## 🃏 Card Catalog · 卡牌目录

`assets/card-catalog.zhCN.json` ships with a built-in snapshot of Standard-mode cards in Chinese. The app blocks analysis if card metadata, visual features, or the Power.log build number don't match — preventing unreliable suggestions.

`assets/card-catalog.zhCN.json` 内置了简体中文标准模式卡牌快照。应用会在卡牌元数据、视觉特征或 Power.log build 不一致时阻止分析，避免输出不可靠建议。

Each card record stores: ID, name, text, cost, Standard flag, and a local dHash of its art. The distribution package does not include full card images.

每条记录包含：卡牌 ID、名称、文本、费用、标准模式标记和本地图像 dHash；发布包不包含完整卡图。

Build and validate locally:

```powershell
node scripts/build-card-catalog.mjs `
  --cards .\local-data\cards.latest.zhCN.json `
  --sets .\scripts\standard-sets.2026-06.json `
  --features .\local-data\image-features.combined.json `
  --game-build 243002 `
  --version hjson-243002-zhCN-2026-06-05 `
  --out .\assets\card-catalog.zhCN.json

npm run catalog:validate
```

---

## 🧪 Testing · 测试

The project uses [Vitest](https://vitest.dev/) with **11 test suites** covering core parsing, validation, client communication, and UI state.

```powershell
npm test        # Run all tests
npm run typecheck  # TypeScript type checking (both configs)
```

| Test Suite | What It Covers | 测试内容 |
|-----------|---------------|---------|
| `power-log-parser.test.ts` | Full log parsing, dedup, entity descriptions, player inference, card ID preservation | 完整日志解析、去重、实体描述、玩家推断 |
| `power-log-watcher.test.ts` | Polling, file rotation, truncation handling | 轮询、文件轮转、截断处理 |
| `power-log-locator.test.ts` | Log discovery across multiple sources | 多源日志发现 |
| `agent-client.test.ts` | Sanitization, action hints, retry, JSON parsing, transport fallback | 脱敏、动作提示、重试、JSON 解析 |
| `analysis-validator.test.ts` | Snapshot and result validation | 快照与结果校验 |
| `snapshot-sanitizer.test.ts` | Privacy boundary enforcement | 隐私边界保障 |
| `snapshot-enricher.test.ts` | Catalog data enrichment | 卡牌目录数据注入 |
| `visual-validator.test.ts` | dHash screenshot matching | dHash 截图匹配 |
| `card-catalog.test.ts` | Catalog loading and querying | 卡牌目录加载与查询 |
| `settings-store.test.ts` | Settings persistence and normalization | 设置持久化与归约 |
| `app-status.test.ts` | App status object construction | 应用状态构建 |

---

## 🔧 Development Scripts · 开发脚本

| Command | Description | 说明 |
|---------|------------|------|
| `npm run dev` | Start dev mode (Vite + tsc + Electron) | 启动开发模式 |
| `npm run build` | Build renderer + main process | 构建渲染进程和主进程 |
| `npm test` | Run all tests | 运行所有测试 |
| `npm run typecheck` | TypeScript type checking | TypeScript 类型检查 |
| `npm run package` | Build Windows NSIS installer | 生成 Windows 安装包 |
| `npm run catalog:build` | Build card catalog from HearthstoneJSON | 从 HearthstoneJSON 构建卡牌目录 |
| `npm run catalog:validate` | Validate card catalog integrity | 验证卡牌目录完整性 |
| `npm run catalog:import-hdt` | Import card defs from HDT | 从 HDT 导入卡牌定义 |
| `npm run features:build` | Build dHash visual features | 构建 dHash 视觉特征 |
| `npm run log:diagnose` | Diagnose a Power.log file | 诊断 Power.log 文件 |

---

## 🛡️ Privacy & Compliance · 隐私与合规

### Privacy · 隐私

- **Remote requests contain only sanitized, structured game state.** Player names, raw entity tags, and timestamps are stripped before transmission.
- **Screenshots are captured only for local dHash validation and are never sent to any AI provider.**
- **API keys are encrypted** via Electron's `safeStorage` (Windows DPAPI) — never stored in plain-text settings files.
- **SQLite history** resides in the Electron user data directory and is not uploaded anywhere.
- **Diagnostic logs** record snapshot summaries, visual validation results, agent responses, parsing errors, and validation errors — but never API keys or screenshots.

### Compliance · 合规

Real-time gameplay suggestions may be against Blizzard's terms of service. Before enabling live recommendations in official matches, verify with:

- [Blizzard EULA](https://www.blizzard.com/en-us/company/legal/eula.html)
- [Blizzard Anti-Cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung)

Live recommendations are disabled by default. Enable only after confirming authorization and accepting account and compliance risks.

---

## 📄 License · 许可

MIT

---

<p align="center">
  <sub>Built with ❤️ for the Hearthstone community · 为炉石社区打造</sub><br />
  <sub>This project is not affiliated with Blizzard Entertainment, Inc.</sub>
</p>
