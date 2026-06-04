# 炉石对局 Agent 助手

Windows 11 桌面应用原型。应用只读取 `Power.log`、本地截图和用户配置，不会点击、出牌、注入游戏进程、读取内存或绕过反作弊。

## 当前范围

- Electron + TypeScript + React
- 标准构筑、简体中文客户端、16:9 单屏
- `Ctrl+Shift+A` 分析当前局面
- `Ctrl+Shift+O` 显示或隐藏置顶悬浮窗
- OpenAI 兼容的 Responses API 与 Chat Completions API
- API Key 仅保存到 Windows 凭据管理器
- 截图仅用于本地校验，不发送给远程 Agent

正式对局实时建议默认禁用。启用前必须确认已获得授权并接受账号与合规风险。

## 本地开发

依赖尚未自动安装。取得明确下载授权后执行：

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

默认路径：

```text
%LOCALAPPDATA%\Blizzard\Hearthstone\Logs\Power.log
```

应用也会自动读取 Hearthstone Deck Tracker 的本地配置，并在炉石安装目录的
`Logs\Hearthstone_日期时间\Power.log` 会话目录中切换到最新日志。

无需安装项目依赖即可诊断现有日志：

```powershell
npm run log:diagnose -- `
  --log "E:\Hearthstone\Logs\Hearthstone_日期时间\Power.log"
```

诊断命令直接调用应用中的 `PowerLogParser`，输出最近对局的模式、build、手牌和场面摘要。

## 卡牌快照

`assets/card-catalog.zhCN.json` 当前是未配置占位文件。应用会阻止在缺少卡牌元数据或视觉特征时发起分析，避免输出不可靠建议。

正式测试前需要在得到资源下载授权后，使用官方卡牌数据制作标准模式 `zhCN` 快照。每条记录至少需要卡牌 ID、名称、文本、费用、标准模式标记和本地图像特征哈希；发布包不应包含完整卡图。

项目提供两个不会联网的本地脚本：

```powershell
node scripts/build-card-catalog.mjs `
  --cards .\local-data\cards.zhCN.json `
  --sets .\local-data\standard-set-ids.json `
  --features .\local-data\image-features.json `
  --game-build 123456 `
  --version 2026.06.04 `
  --out .\assets\card-catalog.zhCN.json

npm run catalog:validate
```

- `cards.zhCN.json` 可以是官方卡牌 API 返回的 `cards` 数组或包含该数组的对象。
- `standard-set-ids.json` 是标准卡池的 set ID 数组，或包含 `standardSetIds` 数组的对象。
- `image-features.json` 是 `cardId` 到 16 位十六进制 dHash 的对象。
- `game-build` 必须与当前 `Power.log` 中的 `BuildNumber` 一致，否则应用会阻止分析。
- 脚本只读取本地文件，不会下载资源。

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

## 隐私

- 远程请求只包含经过白名单处理的结构化局面。
- 不发送截图、原始日志、玩家名称或 API Key。
- SQLite 历史位于 Electron 用户数据目录。
- 普通设置文件不包含 API Key。

## 合规

实时玩法建议可能违反游戏规则或带来账号风险。小范围测试前应重新核对：

- [Blizzard EULA](https://www.blizzard.com/en-us/company/legal/eula.html)
- [Blizzard Anti-Cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung)
