# Tabby 使用说明：连接与会话

本页覆盖连接模型与所有连接类型（Local/SSH/Telnet/Serial/Saved layout）。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

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

