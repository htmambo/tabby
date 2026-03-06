---
mode: plan
cwd: /media/hoping/个人数据/usr/htdocs/tabby
task: 左侧边栏配置项与标签页联动，并为配置项添加右键菜单
complexity: medium
tool: manual-planning
total_thoughts: 7
created_at: 2026-03-07T00:54:52+08:00
---

# Plan: 左侧边栏配置与会话联动改造

🎯 任务概述

目标是在不破坏现有连接能力的前提下，调整左侧边栏“所有连接”和“活动会话”的联动规则。
左键点击配置项时改为“未连接则新建、已连接则激活主标签”，并在标签切换时反向高亮对应配置；同时为所有配置项增加右键菜单，支持强制新建连接、SSH SFTP 连接和关闭该配置相关的全部连接。

📋 执行计划

1. 梳理 `appRoot` 中边栏配置列表、活动会话列表、标签激活状态和 profile 数据来源，明确可复用入口。
2. 设计“配置 -> 主标签 / 额外会话 / SFTP 标签”的归类规则，保证同一配置仅首个匹配标签占据配置映射，其余进入“活动会话 / Other”。
3. 在边栏连接项点击逻辑中实现“查找主标签并激活，否则新建标签”的行为，并保留右键菜单中的“连接”为始终新建。
4. 订阅活动标签变化，将当前激活标签解析为 profile 映射，驱动左侧配置项 active 状态；对欢迎页、设置页等无 profile 标签保持无高亮。
5. 为配置项添加右键菜单，菜单项包含“连接”“关闭所有连接”，SSH 配置额外显示“连接SFTP”，并复用现有 tab / profile API 完成动作。
6. 调整活动会话分组逻辑：重复配置会话、SFTP 会话和无法映射为主配置的会话统一归入 `Other` 分组，保持其它环境分组不被重复项污染。
7. 运行针对性检查或最小构建验证，确认类型、模板绑定和交互逻辑无明显回归，再整理交接说明。

⚠️ 风险与注意事项

- “同一配置”的判定优先依赖 `profile.id`；无 `profile.id` 的标签不参与配置映射，只作为普通活动会话展示。
- `SplitTabComponent` 需要优先依据其 `getFocusedTab()` 解析实际活动子标签，避免边栏高亮错位。
- `关闭所有连接` 需要覆盖主连接、重复连接和同配置的 SFTP 标签，但不能误伤其它 profile 的普通会话。
- 右键菜单的调用方式需要沿用项目现有菜单 API，避免引入新的交互依赖。

📎 参考

- `tabby-core/src/components/appRoot.component.ts:431`
- `tabby-core/src/components/appRoot.component.ts:459`
- `tabby-core/src/components/appRoot.component.pug:166`
- `tabby-core/src/services/app.service.ts:67`
- `tabby-core/src/services/app.service.ts:220`
- `tabby-ssh/src/profiles.ts:95`

## 变更记录（2026-03-07）

### 唯一绑定规则补充

- `所有连接` 中的配置项不再按 `profile.id` 动态推断主标签，而是使用运行期显式绑定：`profile.id -> primary tab`。
- 该绑定只在“左击配置项且当前无绑定时新建标签”这一动作下建立。
- 配置项右键菜单中的 `Connect` 始终新建标签，但**不会**写入主绑定，因此会显示在 `活动会话 -> Other`。
- `活动会话` 中的每一项直接与具体 `targetTab` 唯一对应，激活状态按 tab 实例判断。
- 当主绑定 tab 被关闭时，只移除该绑定，**不允许**从同配置的其它标签自动递补。
- `Close all connections` 仍按 `profile.id` 收集并关闭该配置的全部连接，不受唯一绑定约束。

### 当前实现状态

- 已完成：唯一绑定重构、标签激活反向联动、重复连接与 SFTP 统一归入 `Other`、右键菜单行为区分。
- 已验证：`npx tsc -p tabby-core/tsconfig.json --noEmit --pretty false`
- 已验证：`npx tsc -p tabby-ssh/tsconfig.json --noEmit --pretty false`
- 已验证：`./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs`
- 已验证：`./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs`

### 恢复后自动补绑定（方案二）

- 在初始 tab 恢复流程完成后，自动扫描当前 tabs。
- 对每个配置仅将遇到的第一个非 SFTP tab 补成主绑定；其余同配置 tabs 保持在 `Other`。
- 该补绑定只在启动恢复阶段执行一次，不会影响运行中“主 tab 关闭后不递补”的规则。

### 同步机密存储模型调整

- 已放弃此前的中间过渡方案，避免与多机同步目标冲突。
- 当前实现保留 Vault 作为同步 secrets 的统一存储层，但主密码改为可选。
- 不设置主密码时，SSH 密码与私钥口令仍可随同步数据跨机器可用。
- 如需更强保护，用户可主动设置主密码；也可后续清除主密码而不丢失已保存的 SSH 凭据。

### 可同步机密 + 主密码可选

- Vault 现在支持两种存储模式：不带主密码的明文同步模式，以及带主密码的加密同步模式。
- 默认启用 Vault 时不再要求先设置主密码，因此 SSH 密码/私钥口令可以直接跟随配置跨机器同步。
- 用户可以在已启用 Vault 后主动设置主密码；也可以在不丢失已保存 SSH 凭据的前提下清除主密码。
- 清除主密码时不会删除已保存的 SSH 密码/密钥口令，但如果启用了配置文件加密，会先自动关闭该加密功能。
