# Tabby 使用说明索引（中文）

本索引将原本的单文件手册拆分为按功能域组织的文档，便于按场景阅读、检索和维护。

## 1. 文档导航（按功能点）

| 文档 | 功能范围 | 适用场景 |
|---|---|---|
| [USAGE-01-overview.zh-CN.md](./USAGE-01-overview.zh-CN.md) | 产品定位、快速开始、界面结构 | 第一次接触 Tabby，先建立整体心智模型 |
| [USAGE-02-connections.zh-CN.md](./USAGE-02-connections.zh-CN.md) | 连接模型、Local/SSH/Telnet/Serial/Saved layout | 需要建立和管理各类连接 |
| [USAGE-03-layout-sftp.zh-CN.md](./USAGE-03-layout-sftp.zh-CN.md) | 分屏/标签、SFTP 文件管理 | 日常终端工作流和远程文件操作 |
| [USAGE-04-settings.zh-CN.md](./USAGE-04-settings.zh-CN.md) | Settings 全量选项 | 做个性化配置、理解全局行为 |
| [USAGE-05-vault-sync.zh-CN.md](./USAGE-05-vault-sync.zh-CN.md) | Vault、配置加密、配置同步与自动同步 | 多设备协同、配置安全与同步策略 |
| [USAGE-06-plugins-transfers.zh-CN.md](./USAGE-06-plugins-transfers.zh-CN.md) | 插件系统、文件传输中心 | 扩展能力与上传/下载任务管理 |
| [USAGE-07-cli-config.zh-CN.md](./USAGE-07-cli-config.zh-CN.md) | 命令行参数、tabby:// URL、配置文件路径 | 启动参数联动、定位配置文件、脚本化调用 |
| [USAGE-08-platform-faq.zh-CN.md](./USAGE-08-platform-faq.zh-CN.md) | Desktop/Web 差异、常见问题排障 | 平台差异确认与故障快速定位 |
| [USAGE-09-examples-hotkeys.zh-CN.md](./USAGE-09-examples-hotkeys.zh-CN.md) | 示例配置、进阶建议、默认热键、术语 | 复用模板、团队协同、效率优化 |

## 2. 推荐阅读路径

1. 新用户：`01 -> 02 -> 03 -> 04`
2. 关注配置同步与安全：`05 -> 07 -> 08`
3. 关注扩展与效率：`06 -> 09`

## 3. 与单文件手册的关系

- 单文件全集仍保留在 [USAGE.zh-CN.md](./USAGE.zh-CN.md)
- 分文档内容来自同一手册拆分，便于按主题维护

## 4. 维护建议

1. 变更某个功能时优先修改对应分文档。
2. 若涉及跨域能力（例如同步 + Vault + 配置文件），同步更新相关文档并回到本索引检查链接。
3. 发布前至少检查一次文档链接与章节覆盖。
