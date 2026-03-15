# Tabby 使用说明：示例配置、进阶实践与热键

本页包含可复用配置片段、多机协同建议、默认热键与术语速查。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

---

## 17. 示例配置片段（可直接参考）

```yaml
# 仅示例，字段请按你的环境调整
terminal:
  profile: local:default
  autoOpen: true
  recoverTabs: true
  scrollbackLines: 25000
  rightClick: clipboard
  warnOnMultilinePaste: true
  bracketedPaste: true
  trimWhitespaceOnPaste: true

appearance:
  tabsLocation: top
  flexTabs: false
  tabsInFullscreen: false
  frame: thin
  vibrancy: false

ssh:
  warnOnClose: true
  verifyHostKeys: true
  agentType: auto

configSync:
  host: https://your-config-sync.example.com
  token: "<token>"
  configID: 12
  auto: false
  parts:
    hotkeys: true
    appearance: true
    vault: true

clickableLinks:
  modifier: ctrlKey

profileBlacklist: []
pluginBlacklist: []
```

---

## 18. 进阶建议（多机和团队）

- 约定“主配置机”：
  - 主机改完后手动 Upload
  - 其他机器先 Download 再继续改
- 自动同步只在你确认策略后再开启
- 配置加密（Vault）和配置同步同时使用时，先明确“是否允许部分同步”
- 大变更前保留 `config.yaml` 与 `config.yaml.backup`

---

## 19. 常用默认热键速查

以下是当前默认配置中的常用热键（可在 Settings -> Hotkeys 自定义）。

### 19.1 Windows / Linux 常用

| 动作 | 默认热键 |
|---|---|
| 新建本地终端 | `Ctrl-Shift-T` |
| 打开设置 | `Ctrl-,` |
| 命令选择器 | `Ctrl-Shift-P` |
| 配置选择器 | `Ctrl-Shift-E` |
| 下一标签 | `Ctrl-Tab` / `Ctrl-Shift-Right` |
| 上一标签 | `Ctrl-Shift-Tab` / `Ctrl-Shift-Left` |
| 关闭标签 | `Ctrl-Shift-W` |
| 复制 | `Ctrl-Shift-C` |
| 粘贴 | `Ctrl-Shift-V` / `Shift-Insert` |
| 搜索 | `Ctrl-Shift-F` |
| 分屏（右/下） | `Ctrl-Shift-S` / `Ctrl-Shift-D` |
| pane 导航 | `Ctrl-Alt-方向键` |
| 切换窗口显示（桌面版） | `Ctrl-Space` |

### 19.2 macOS 常用

| 动作 | 默认热键 |
|---|---|
| 新建本地终端 | `⌘-T` |
| 打开设置 | `⌘-,` |
| 命令选择器 | `⌘-Shift-P` |
| 配置选择器 | `⌘-E` |
| 下一标签 | `Ctrl-Tab` |
| 上一标签 | `Ctrl-Shift-Tab` |
| 关闭标签 | `⌘-W` |
| 复制 | `⌘-C` |
| 粘贴 | `⌘-V` |
| 搜索 | `⌘-F` |
| 分屏（右/下） | `⌘-Shift-D` / `⌘-D` |
| pane 导航 | `⌘-⌥-方向键` |
| 切换窗口显示（桌面版） | `Ctrl-Space` |

### 19.3 连接类型专用热键（默认多为空，可自行绑定）

- SSH：`restart-ssh-session`、`launch-winscp`
- Telnet：`restart-telnet-session`
- Serial：`restart-serial-session`
- 通用连接：`reconnect-tab`、`disconnect-tab`

---

## 20. 术语速记

- Profile：连接模板/会话模板
- Provider：Profile 类型提供器（SSH/Telnet/Serial/Local）
- Split layout：分屏布局配置
- Vault：加密密钥容器
- Config sync：与远程同步服务同步配置
- Command selector：命令选择器（聚合按钮/菜单动作）
