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

## 卡牌快照

`assets/card-catalog.zhCN.json` 当前是未配置占位文件。应用会阻止在缺少卡牌元数据或视觉特征时发起分析，避免输出不可靠建议。

正式测试前需要在得到资源下载授权后，使用官方卡牌数据制作标准模式 `zhCN` 快照。每条记录至少需要卡牌 ID、名称、文本、费用、标准模式标记和本地图像特征哈希；发布包不应包含完整卡图。

## 隐私

- 远程请求只包含经过白名单处理的结构化局面。
- 不发送截图、原始日志、玩家名称或 API Key。
- SQLite 历史位于 Electron 用户数据目录。
- 普通设置文件不包含 API Key。

## 合规

实时玩法建议可能违反游戏规则或带来账号风险。小范围测试前应重新核对：

- [Blizzard EULA](https://www.blizzard.com/en-us/company/legal/eula.html)
- [Blizzard Anti-Cheating Agreement](https://www.blizzard.com/legal/cd5930c0-2784-420c-a23d-1e0d6ff8599b/anti-cheating-vereinbarung)

