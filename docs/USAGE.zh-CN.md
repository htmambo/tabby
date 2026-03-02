# Tabby 使用说明（中文）

本文档面向当前仓库版本的 Tabby，按“可直接上手 + 可深入配置”的方式组织，尽量覆盖主要功能点与实际行为。

分文档索引入口：
- [INDEX.zh-CN.md](./INDEX.zh-CN.md)
- 若想按功能点阅读，优先从索引进入各主题文档。

说明：
- 文中“桌面版”指 Electron 版本（Windows/macOS/Linux）。
- 文中“Web 版”指 `tabby-web`（浏览器访问）。
- 某些功能只在桌面版可用（例如本地 shell、部分 SFTP 本地文件操作、插件安装到本机目录、系统集成）。

---

## 1. Tabby 是什么

Tabby 是一个高度可配置的终端工作台，核心能力包括：
- 本地终端（Local shell）
- 远程连接：SSH、Telnet、Raw Socket、Serial
- 标签页 + 分屏（可保存布局）
- SFTP 文件管理（与 SSH 深度联动）
- Vault 密钥库与配置加密
- 配置同步（Tabby Web API）
- 插件系统（NPM 生态）
- 丰富热键、命令选择器、右键菜单和自动化入口

---

## 2. 快速开始

### 2.1 启动后你会看到什么

首次或无标签页时会显示 Start Page，常见入口：
- `Profiles & connections`（连接选择器）
- 最近使用配置（如果开启“显示最近配置”）
- 左右工具栏按钮（来自命令系统和插件）

### 2.2 30 秒建立第一个连接

1. 点击左上角“新建终端”按钮，或使用热键打开 Profile Selector。
2. 选择一个 Profile：
   - 本地终端：直接进入 shell
   - SSH/Telnet/Serial：按 Profile 配置发起连接
3. 连接成功后，可通过标签头右键执行：重命名、复制、分屏、保存为 Profile 等操作。

---

## 3. 界面结构总览

### 3.1 顶部区域（Tab Bar）

- 标签列表：支持拖拽排序、拖出/拖入分屏容器
- 标签附加信息：
  - 活动指示
  - 进度条（终端输出中检测到进度百分比时显示）
  - 颜色条
- 工具栏按钮：
  - 左侧常见是 `Profiles & connections`、`New terminal`
  - 右侧常见是 `Settings`、更新按钮
- 文件传输菜单：出现上传/下载任务时自动显示

### 3.2 中心区域（内容区）

- 没有打开标签页时显示 Start Page
- 有标签页时显示活动 Tab 内容
- 支持搜索面板（terminal 内搜索，支持大小写/正则/整词）

### 3.3 标签操作（Tab Header）

- 单击：切换标签
- 双击：重命名标签
- 中键点击：关闭标签
- 右键：打开上下文菜单（包含通用项 + 连接类型特有项）

---

## 4. 连接与会话模型

Tabby 的连接管理核心是 Profile。每个 Profile 对应一种连接类型、参数和行为策略。

### 4.1 支持的连接类型

- `local`：本地 shell
- `ssh`：SSH 连接
- `telnet`：Telnet 连接
- `telnet` 模板（Raw socket）：原始 TCP Socket
- `serial`：串口连接
- `split-layout`：保存的分屏布局

### 4.2 Profile 的通用字段（所有类型共通）

- 名称、分组、图标、颜色
- 是否禁用动态标题（固定显示连接名）
- 会话结束行为：
  - `auto`：仅在“明确退出”时关闭
  - `keep`：保持标签不关闭
  - `reconnect`：自动重连（仅可连接型 Profile）
  - `close`：会话结束立即关闭
- 连接后清理服务消息（可连接型 Profile）

### 4.3 Profiles & connections 页面能力

- 默认新标签 Profile
- 新建 Profile / 新建分组
- 复制、删除、隐藏（加入黑名单）
- 启动某个 Profile
- 按类型配置“全局默认值”（Default profile settings）
- 按分组配置该分组的类型默认值
- 控制选择器中“最近配置数量”和“是否显示内置配置”
- 设置 Quick Connect 默认类型（如 SSH 或 Telnet）

---

## 5. 各连接类型详细说明

## 5.1 Local（本地终端）

### 可配置项

- 命令行编辑（两种模式）
  - 单行命令模式
  - 程序 + 参数数组模式（可逐项增删）
- 以管理员身份运行（Windows，且 UAC 支持时）
- 工作目录（可手动输入或文件夹选择）
- 环境变量编辑（支持 PATH 扩展示例）
- 颜色方案（可覆盖终端默认配色）

### 行为说明

- 新建本地终端默认取 `terminal.profile`
- 若当前标签能获取工作目录，Tabby 会尽量复用该目录打开新会话
- 关闭标签时若检测到前台进程未退出，会弹框确认

## 5.2 SSH

### General（连接）

- 连接模式：
  - Direct
  - Proxy command
  - Jump host
  - SOCKS proxy
  - HTTP proxy (CONNECT)
- Host / Port / Username
- 认证方式：
  - Auto
  - Password
  - Key
  - Agent（桌面版）
  - Keyboard-interactive
- 私钥列表（支持本地文件/Vault 文件提供器）
- 保存密码（Vault 可用时存入 Vault，否则使用系统 keychain/keytar）

### Ports

- 本地转发（Local）
- 远程转发（Remote）
- 动态转发（Dynamic SOCKS）
- 每条规则可带描述

### Advanced

- X11 转发（桌面版）
- Agent forwarding（桌面版）
- 跳过 Banner（Skip MoTD/banner）
- 复用会话（Reuse session）
- KeepAlive 间隔/次数
- Ready timeout

### Ciphers

可按类别勾选算法：
- Cipher
- Key exchange
- HMAC
- Host key
- Compression

### Login scripts / Input

- 登录脚本：Expect -> Send，支持正则与可选项
- 输入处理：Backspace 键模式映射

### SSH 会话工具栏

- Reconnect
- SFTP（内嵌面板）
- Open SFTP tab（独立标签页）
- Ports（端口转发管理）

### SSH 全局设置

- 关闭活动连接时警告
- 连接时校验 Host key
- WinSCP 路径（Windows）
- SSH Agent 类型/管道路径（Windows）
- X11 Display 覆盖

### Host key 校验行为

校验开启时，首次或指纹变化会弹窗：
- Accept and remember key
- Accept just this once
- Disconnect

## 5.3 Telnet / Raw Socket

### Telnet Profile

- Host / Port
- Stream processing：
  - Input mode：Normal / Local echo / Line by line / Hex
  - Input newlines：Keep/Strip/CR/LF/CRLF/implicit CR/LF
  - Output mode：Normal / Hex
  - Output newlines：同上
- Login scripts
- Input（Backspace 映射）

### Raw Socket

通过内置模板“Raw socket connection”快速创建，本质沿用 Telnet 配置框架。

## 5.4 Serial（串口）

### General

- 设备端口（桌面版可枚举）
- 波特率（为空时连接前可选）
- Stream processing

### Advanced

- Data bits / Stop bits / Parity
- RTS/CTS、XON、XOFF、Xany
- Slow feed（逐字节发送）

### 运行时

- 工具栏可在连接状态下变更波特率（桌面版）
- 支持重连

## 5.5 Saved layout（保存布局）

- 将当前 Split 布局存为 Profile
- 后续可像普通 Profile 一样直接打开

---

## 6. 分屏、标签与焦点控制

### 6.1 分屏能力

- 横向/纵向拆分
- 拖动分隔条调整比例
- 一键均分（equalize）
- 最大化当前 pane / 还原

### 6.2 Pane 导航与操作

- 方向导航（上/下/左/右）
- 线性导航（上一个/下一个）
- 指定 pane 序号（1~9）
- 关闭当前 pane
- 调整 pane 大小步长（可配置）

### 6.3 多播输入（Broadcast）

- Focus all panes：同一 split 内多 pane 同时接收输入
- Focus all tabs：多标签同时接收输入

### 6.4 标签级高级操作

- Duplicate
- Close other tabs / left / right
- Switch profile（在 split 子 pane 中切换 Profile）
- Save as profile（把当前标签状态落成新 Profile）
- Save layout as profile（split 标签可用）

---

## 7. SFTP（SSH 集成文件管理）

SFTP 有两种打开方式：
- 在 SSH 标签中打开内嵌 SFTP 面板
- 打开独立 SFTP 标签页

## 7.1 面板结构

- 桌面版：双栏
  - 左：本地文件
  - 右：远程 SFTP
- Web 版：通常只可用远程侧（本地目录枚举能力受限）

## 7.2 远程侧功能

- 面包屑导航、路径手动编辑
- 过滤（Filter）
- 多选（Ctrl/Cmd/Shift）
- 全选/清空选择
- 下载选中项
- 创建目录
- 上传文件
- 上传文件夹
- 右键菜单（含插件扩展项）
  - Download / Download directory
  - Delete
  - Refresh current directory
  - Copy full path（桌面扩展）
  - Edit locally（桌面扩展，自动监听本地修改回传）

## 7.3 本地侧功能（桌面版）

- 目录浏览与面包屑导航
- 双击目录进入
- 双击文件用系统默认程序打开
- 多选后批量上传
- 右键菜单：Upload / Open directory / Refresh / Copy full path

## 7.4 批量与交互细节

- 支持拖拽目录上传（drop zone）
- `Ctrl/Cmd + A`：在当前激活 pane 执行全选
- 目录下载会递归计算大小并显示进度
- 下载默认写入“本地当前目录”（双栏模式下）

---

## 8. 设置（Settings）全量说明

Settings 由多个模块动态组成，以下为常见完整集合。

## 8.1 Application

- 检查更新 / 执行更新
- 反馈问题、社区、GitHub、发布说明
- Language
- Shell integration（支持平台）
- Enable analytics
- Automatic updates
- Open DevTools
- Accessibility：
  - 启用动画
  - 最小对比度

## 8.2 Window

- Theme
- Spaciness
- Web：关闭浏览器标签前确认
- Vibrancy / Acrylic（平台相关）
- 背景类型（Blur / Fluent，Windows 条件可见）
- Opacity
- Window frame（Native / Thin / Full）
- Hide tray icon（非 Linux Web）
- Docking（停靠）
  - 位置（Top/Left/Right/Bottom/Off）
  - 显示器选择
  - Always on top
  - 尺寸与占比
  - 失焦隐藏
- Tabs
  - 位置（Top/Bottom/Left/Right）
  - 宽度策略（Dynamic/Fixed）
  - 全屏时是否显示标签栏
  - 隐藏标签索引
  - 标签显示 Profile 图标
  - 隐藏关闭按钮
  - 关闭最后一个标签时关闭窗口
- Panes
  - Pane resize step
  - Focus follows mouse（需重启）
- Hacks
  - 禁用 GPU 加速（需重启）
  - Fluent 背景实验项（Windows）

## 8.3 Terminal

- Rendering：frontend、scrollback、粗体亮色、sixel
- Keyboard：Alt 作为 Meta、输入时自动滚动
- Mouse：右键策略、中键粘贴、词分隔符、点击链接修饰键
- Clipboard：
  - 选中即复制
  - 保留格式复制
  - bracketed paste
  - 多行粘贴警告
  - 粘贴前后裁剪空白
- Sound：bell off/visual/audible
- Startup：
  - 启动自动打开终端
  - 启动恢复标签
- Windows：Set Tabby as `%COMSPEC%`

## 8.4 Appearance

- 字体族 + 字号
- ligatures
- 正常/粗体字重
- 终端背景来源（theme / color scheme）
- 光标形状与闪烁
- 最小对比度
- fallback 字体
- 行间距
- 自定义 CSS

## 8.5 Color scheme

- 颜色模式切换：
  - Follow system
  - Always dark
  - Always light
- 深色与浅色模式可分别选方案
- 可编辑并保存自定义方案（含 16 ANSI 色）

## 8.6 Profiles & connections

见第 4、5 节。

## 8.7 Shell（Windows）

- ConPTY 开关
- WSL + ConPTY 提示

## 8.8 SSH

见第 5.2 节“SSH 全局设置”。

## 8.9 Hotkeys

- 支持搜索
- 支持多段快捷键
- 重复绑定会被检测标记
- 可配置范围包括：
  - 全局标签/窗口行为
  - 终端编辑/导航
  - SSH/Telnet/Serial 专用动作
  - Settings 打开与直达设置页
  - 每个 Profile/Provider/Group 的选择器热键

## 8.10 Plugins

- Available：从 NPM 搜索并安装
- Installed：升级、启用/禁用、卸载
- 打开插件目录
- 注意：安装/卸载/启停通常需要重启应用

## 8.11 Vault

见第 9 节。

## 8.12 Config sync

见第 10 节。

## 8.13 Config file

- 内置 YAML 编辑器
- 语法校验（invalid syntax 会阻止保存）
- Show defaults 查看默认配置
- Show config file 打开文件所在目录（桌面版）

---

## 9. Vault 与凭据管理

Vault 是“始终加密”的密钥容器，可保存：
- SSH 登录密码
- 私钥口令
- 其他文件型 secret（如私钥文件内容）

## 9.1 基本操作

- 初始化主密码（不可恢复）
- 解锁查看内容
- 修改主密码
- 擦除 Vault

## 9.2 记住主密码策略

解锁弹窗支持设置“记住时长”（分钟/小时/天），超时后会再次要求输入。

## 9.3 配置加密（Encrypt config file）

开启后：
- 大部分配置写入 Vault 加密区
- `vault` / `encrypted` / `configSync` 仍保留在外层配置中
- Config sync 的“部分同步”会受限（UI 会提示不可部分同步）

---

## 10. 配置同步（Config sync）深度说明

该功能依赖 Tabby Web API（非 Web 客户端本身）。

## 10.1 前置条件

`configSync` 需要同时具备：
- `host`
- `token`
- `configID`

并且当前平台是桌面版（Web 版不可用）。

## 10.2 同步页面功能

Sync 页：
- 设置 Sync host
- 输入 Secret sync token
- 连接测试与错误提示
- 远程配置列表（显示 `modified_at`）
- 对某条远程配置执行：
  - Upload / Replace（本地覆盖远程并绑定同步）
  - Download（远程覆盖本地并绑定同步）
  - Delete
  - Upload as a new config
- 当本地绑定的 `configID` 在远端列表中存在时，可显示 `Sync automatically` 开关

Advanced 页：
- 当配置未加密时，可选择是否同步以下部分：
  - hotkeys
  - appearance
  - vault

## 10.3 自动同步的真实行为

自动同步只有在 `configSync.auto === true` 时生效（严格布尔判断）。

触发逻辑：
- 本地配置变化时：自动执行上传
- 后台每 60 秒轮询远端：
  - 若远端 `modified_at` 更新，则自动下载

## 10.4 上传/下载的数据合并规则

上传时：
- 读取本地配置并移除 `configSync` 字段
- 对于关闭同步的可选部分，保留远端原值

下载时：
- 拉取远端配置
- 强制保留本地 `configSync` 字段
- 若远端配置不是加密模式：对关闭同步的可选部分，保留本地值

## 10.5 关键澄清

- 打开“配置同步”标签页本身不会直接调用上传。
- 进入该页面会做连接测试和配置列表加载。
- 如果你观察到“连上服务器后远端被覆盖”，通常需要检查：
  - `configSync.auto` 是否真的为布尔 `true`
  - 是否有外部配置变更触发了 `config.changed$`
  - 当前是否已绑定 `configID`

建议：
- 多机共用时，先手动执行 Download 对齐，再决定是否开启自动同步。
- 要求“完全人工同步”时，确保 `configSync.auto: false`。

---

## 11. 插件系统

## 11.1 插件来源与安装

- 插件管理器从 NPM 检索（`tabby-` / `terminus-` 生态）
- 支持安装、升级、卸载
- 支持按插件启用/禁用（通过 `pluginBlacklist`）

## 11.2 插件目录

可在插件设置页直接打开本地插件目录。

## 11.3 常见内置扩展模块（本仓库）

- `tabby-linkifier`：终端内 URL/IP/文件路径点击
- `tabby-community-color-schemes`：额外配色方案
- `tabby-auto-sudo-password`：检测 sudo 提示后可一键回填已保存密码

---

## 12. 文件传输中心（Transfers）

所有上传/下载任务都会进入顶部 Transfers 菜单：
- 显示任务名、状态、进度、速度
- 点击任务可定位到文件（桌面版）
- 可单个取消/移除
- 可一键清空，若有活动任务会先确认是否中止

---

## 13. 命令行与 URL Scheme

Tabby 支持命令行与 `tabby://` 协议入口。

## 13.1 命令行参数

全局参数：
- `-d, --debug`：启动时打开 DevTools
- `--hidden`：最小化/隐藏启动

命令：

| 命令 | 说明 |
|---|---|
| `tabby open [directory]` | 在目录中打开 shell |
| `tabby run [command...]` | 在终端运行命令 |
| `tabby /k [command...]` | `run` 的别名 |
| `tabby profile [profileName]` | 按 Profile 名称打开 |
| `tabby recent [index]` | 打开最近 Profile（索引） |
| `tabby quickConnect <providerId> <query>` | 快速连接（如 `ssh` / `telnet`） |
| `tabby paste [text]` | 向活动终端注入文本 |
| `tabby paste -e [text]` | 注入前做 shell escaping |

说明：
- `quickConnect` 的 `providerId` 取决于提供器（当前常见 `ssh`、`telnet`）。
- `profileName` 是 Profile 显示名称，需与配置一致。

## 13.2 `tabby://` URL

- 桌面版注册 `tabby://` 协议
- URL 会映射为同名 CLI 命令

示例：

```text
tabby://open?directory=/home/user/project
tabby://profile?profileName=Prod-SSH
tabby://quickConnect?providerId=ssh&query=admin%4010.0.0.8%3A22
```

---

## 14. 配置文件与存储位置

## 14.1 配置文件定位

桌面版配置文件固定文件名为：

```text
config.yaml
```

实际目录由 `TABBY_CONFIG_DIRECTORY` 决定；默认是 Electron 的 `userData` 目录。

最可靠的查看方式：
- Settings -> Config file -> `Show config file`

每次保存还会生成备份：

```text
config.yaml.backup
```

## 14.2 便携模式（Portable）

当 `Tabby.exe` 同级存在 `data` 目录时，用户数据目录会重定向到该目录，即配置文件位于：

```text
<Tabby 可执行文件目录>/data/config.yaml
```

## 14.3 Web 版配置

Web 版通过后端连接器加载/保存配置，不使用本地桌面文件路径。

## 14.4 YAML 直接编辑建议

- 修改前先备份
- 先用 Settings 页的语法校验
- 小步修改，随改随验证
- 对于多机同步场景，优先在“单机验证后再覆盖全局”

---

## 15. 平台差异（Desktop vs Web）

| 能力 | Desktop | Web |
|---|---|---|
| 本地终端（Local shell） | 支持 | 不支持 |
| SSH/Telnet/Serial | 支持 | 取决于后端能力（通常 SSH/Telnet 可用） |
| SFTP 本地双栏 | 支持 | 本地侧受限 |
| 插件安装到本机目录 | 支持 | 一般不支持本机插件目录 |
| Config file 本地路径打开 | 支持 | 不支持 |
| Config sync | 支持 | 不支持 |
| 系统托盘/全局热键/窗口停靠 | 支持 | 不支持 |

---

## 16. 常见问题与排障

## 16.1 启动后没有自动打开终端

检查：
- `terminal.autoOpen` 是否开启
- `enableWelcomeTab` 是否开启（欢迎页开启时会占据初始视图）
- 是否启用了 `recoverTabs` 且恢复了历史标签

## 16.2 配置同步出现“自动覆盖”

按顺序排查：
1. `configSync.auto` 是否确认为布尔 `true/false`
2. 当前 `configID` 是否指向预期远端项
3. 是否存在本地配置变化触发自动上传
4. 是否后台轮询检测到远端变化并下载

## 16.3 SFTP 下载失败或无本地目录

- 桌面版需有可用本地目录（本地 pane）
- Web 版本地文件系统能力有限
- 检查目标目录权限与磁盘空间

## 16.4 SSH 连接卡在认证阶段

- 切换认证方式（Auto/Password/Key/Agent/Interactive）
- 检查私钥路径是否可读取（尤其 Vault 文件引用）
- 关闭会话复用后重试（排除复用状态影响）

## 16.5 Host key 变化警告

- 确认服务器确实更新了 key 再接受并保存
- 不确定时不要“记住新 key”，先做运维侧校验

## 16.6 插件安装后没有生效

- 检查是否已请求重启并完成重启
- 检查 `pluginBlacklist` 是否禁用了该插件
- 检查插件版本与 Tabby 兼容性

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
  host: https://your-tabby-web.example.com
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
- Config sync：与 Tabby Web 服务同步配置
- Command selector：命令选择器（聚合按钮/菜单动作）
