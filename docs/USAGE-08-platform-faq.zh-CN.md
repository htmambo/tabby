# Tabby 使用说明：平台差异与排障

本页覆盖 Desktop/Web 差异与常见故障排查。

- 返回索引：[INDEX.zh-CN.md](./INDEX.zh-CN.md)

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

