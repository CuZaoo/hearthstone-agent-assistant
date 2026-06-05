# 炉石对局 Agent 助手

Windows 11 桌面应用原型。应用只读取 `Power.log`、本地截图和用户配置，不会点击、出牌、注入游戏进程、读取内存或绕过反作弊。

## 当前范围

- Electron + TypeScript + React
- 标准构筑、简体中文客户端、16:9 单屏
- `Ctrl+Shift+A` 分析当前局面
- `Ctrl+Shift+O` 显示或隐藏置顶悬浮窗
- OpenAI 兼容的 Responses API 与 Chat Completions API
- 可配置接口地址、模型、传输协议、超时与候选路线数量
- API Key 仅保存到 Windows 凭据管理器
- 截图仅用于本地校验，不发送给远程 Agent

DeepSeek 可使用：

```text
接口地址: https://api.deepseek.com
模型名称: deepseek-chat
传输协议: Chat Completions API
```

如果 Chat Completions 服务不支持严格 `json_schema`，应用会自动降级到
`json_object`，再用本地校验拦截非法路线。

正式对局实时建议默认禁用。启用前必须确认已获得授权并接受账号与合规风险。

## 本地开发

依赖已按 Wang 授权安装。常用命令：

```powershell
npm install
npm run typecheck
npm test
npm run dev
```

生成 Windows 测试安装器：

```powershell
npm run package
```

## Power.log

应用只检测和读取日志，不会自动修改炉石配置。请参考
[Hearthstone Deck Tracker 的日志配置说明](https://github.com/HearthSim/Hearthstone-Deck-Tracker/wiki/Setting-up-the-log.config)
手动启用 `Power.log`。

可填写 `Power.log` 文件路径、炉石安装目录，或炉石安装目录下的 `Logs`
目录。参考 AutoHS 的新版定位方式，当前炉石会话日志通常位于：

```text
<炉石安装目录>\Logs\Hearthstone_日期时间\Power.log
```

默认路径：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\Power.log
```

应用也会自动读取 Hearthstone Deck Tracker 的本地配置，并在炉石安装目录的
`Logs\Hearthstone_日期时间\Power.log` 会话目录中切换到最新日志。

如果应用提示“已发现最新炉石日志目录，但其中没有 Power.log”，说明当前炉石
会话日志目录存在，但 `Power.log` 尚未生成。常见原因是尚未进入对局，或
`log.config` 未手动启用 Power 日志。

无需安装项目依赖即可诊断现有日志：

```powershell
npm run log:diagnose -- `
  --log "E:\Hearthstone\Logs\Hearthstone_日期时间\Power.log"
```

诊断命令直接调用应用中的 `PowerLogParser`，输出最近对局的模式、build、手牌和场面摘要。

## 卡牌快照

`assets/card-catalog.zhCN.json` 已内置 `zhCN` 标准模式卡牌快照。应用会在缺少卡牌元数据、视觉特征或 `Power.log` build 与快照不一致时阻止分析，避免输出不可靠建议。

快照记录卡牌 ID、名称、文本、费用、标准模式标记和本地图像特征哈希；发布包不包含完整卡图。

当前快照使用 HearthstoneJSON `243002` `zhCN` 卡牌数据和 `scripts/standard-sets.2026-06.json` 标准卡池清单生成：

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

- `cards.zhCN.json` 可以是官方卡牌 API 返回的 `cards` 数组或包含该数组的对象。
- `standard-sets.2026-06.json` 是标准卡池的 set 名称数组，也兼容 set ID 数组。
- `image-features.json` 是 `cardId` 到 16 位十六进制 dHash 的对象。
- `game-build` 必须与当前 `Power.log` 中的 `BuildNumber` 一致，否则应用会阻止分析。
- 构建脚本只读取本地文件，不会下载资源。

如果本机已安装 Hearthstone Deck Tracker，也可以直接从其现有
`CardDefs.base.xml` 生成元数据：

```powershell
npm run catalog:import-hdt -- `
  --xml "$env:APPDATA\HearthstoneDeckTracker\CardDefs\CardDefs.base.xml" `
  --sets .\local-data\standard-set-ids.json `
  --features .\local-data\image-features.json `
  --out .\assets\card-catalog.zhCN.json
```

如果已经有按 `cardId` 命名的本地卡牌美术图片目录，可生成视觉特征：

```powershell
npm run features:build -- `
  --images .\local-data\card-art `
  --out .\local-data\image-features.json
```

视觉特征工具只读取本地图片并写入哈希，不会把图片打包进应用。

Windows 环境下也提供 PowerShell 批处理脚本，可合并已有特征并按 `cardId` 模板下载缺失卡牌瓦片生成 dHash：

```powershell
.\scripts\build-image-features.ps1 `
  -Merge .\local-data\image-features.cardtiles.json `
  -CardIds .\local-data\missing-feature-card-ids.json `
  -UrlTemplate "https://art.hearthstonejson.com/v1/tiles/{cardId}.jpg" `
  -Out .\local-data\image-features.combined.json
```

## 隐私

- 远程请求只包含经过白名单处理的结构化局面。
- 不发送截图、原始日志、玩家名称或 API Key。
- SQLite 历史位于 Electron 用户数据目录。
- 普通设置文件不包含 API Key。

## 合规

实时玩法建议可能违反游戏规则或带来账号风险。小范围测试前应重新核对：

- [Blizzard EULA](https://www.blizzard.com/en-us/company/legal/eula.html)
- [Blizzard Anti-Cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung)
