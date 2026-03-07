# `feat/royal-sidebar-tab-width-sync` 相对 `master` 的变更说明

## 1. 文档元数据

- 对比分支：`feat/royal-sidebar-tab-width-sync` → `master`
- 当前分支头：`4020a358021b`
- 合并基线（merge-base）：`85061732fa13`
- 统计时间：`2026-03-07 16:51:02 CST`
- 对比范围：`master...HEAD`

## 2. 总览

这是一个**多主题聚合分支**，不是单点功能分支。相对 `master`，该分支累计引入：

- `31` 个提交
- `77` 个变更文件
- `7679` 行新增
- `1732` 行删除

从目录分布看，改动主要集中在以下区域：

| 目录 | 占比 | 说明 |
| --- | ---: | --- |
| `docs/` | 14.2% | 中文使用文档拆分、补充与重构 |
| `tabby-ssh/src/components/` | 14.2% | SSH/SFTP 交互、恢复、面板与新标签页 |
| `tabby-settings/src/components/` | 11.6% | Vault、同步、窗口与配置界面 |
| `tabby-core/src/components/` | 7.7% | Royal 侧边栏、标签联动、布局样式 |
| `tabby-ssh/src/` | 6.4% | SSH 恢复链路与配置模型 |
| `locale/` | 5.1% | 中文语言包与多语言补充 |

从文件体量看，改动最大的几个文件为：

| 文件 | 新增 | 删除 | 说明 |
| --- | ---: | ---: | --- |
| `yarn.lock` | 1093 | 1382 | 依赖与锁文件调整 |
| `tabby-core/src/components/appRoot.component.ts` | 1048 | 5 | Royal 侧边栏与标签绑定主逻辑 |
| `docs/USAGE.zh-CN.md` | 852 | 0 | 中文总使用文档 |
| `tabby-ssh/src/components/sftpPanel.component.ts` | 654 | 28 | SFTP 面板与本地文件浏览 |
| `tabby-core/src/components/appRoot.component.scss` | 602 | 1 | 顶部标签栏与边栏样式 |
| `tabby-ssh/src/components/sshTab.component.ts` | 314 | 6 | SSH 恢复与工作目录恢复 |
| `locale/zh-CN.po` | 204 | 0 | 中文文案补充 |
| `tabby-settings/src/services/configSync.service.ts` | 143 | 18 | 配置同步冲突控制与状态收敛 |
| `tabby-electron/src/services/platform.service.ts` | 107 | 22 | 平台层 Vault / secrets 行为调整 |
| `tabby-settings/src/components/vaultSettingsTab.component.ts` | 99 | 21 | 主密码、Vault、保留 secrets 的 UI 流程 |

## 3. 主题变更详解

### 3.1 Royal 侧边栏、标签绑定与布局联动

这部分是该分支最核心的产品改动之一，重点围绕“配置项 ↔ 已连接标签页 ↔ 活动会话 Other”之间的唯一映射与激活联动展开。

**主要变化**：

- 调整左侧边栏点击逻辑：
  - 第一次点击未连接配置时，仍保持“新建标签并连接”的行为。
  - 第二次点击同一配置时，优先激活已绑定标签，而不是继续重复创建标签。
- 为“同一配置多个标签”的场景建立规则：
  - 第一个标签与配置项绑定。
  - 其余标签进入 `活动会话 / Other`，避免单个配置项承载多个 tab 映射。
- 新增/增强“配置项 ⇄ tab”的绑定恢复逻辑：
  - 标签激活时，自动联动高亮边栏中的对应配置项。
  - 如该配置所在分组处于折叠状态，则自动展开对应分组。
- 优化边栏分组行为：
  - 支持 `Single expand mode`，可选“同一时刻仅展开一个分组，其它分组自动折叠”。
  - 相关偏好会被持久化并在下次启动时恢复。
- 调整顶部标签栏与 Royal 侧栏的视觉与交互：
  - 标签宽度控制、关闭按钮样式、活动态样式均做了统一整理。
- 移除顶部标签列表右侧的“配置和连接”入口，减少与边栏功能重叠。

**对应文件**：

- `tabby-core/src/components/appRoot.component.ts`
- `tabby-core/src/components/appRoot.component.pug`
- `tabby-core/src/components/appRoot.component.scss`
- `tabby-core/src/components/tabHeader.component.pug`
- `tabby-core/src/components/tabHeader.component.scss`
- `tabby-core/src/components/splitTab.component.ts`
- `tabby-core/src/configDefaults.yaml`
- `tabby-core/src/services/app.service.ts`
- `tabby-core/src/services/profiles.service.ts`
- `tabby-core/src/theme.new.scss`

**关键实现点**：

- Royal 侧栏偏好恢复，包括单组展开模式：`tabby-core/src/components/appRoot.component.ts`
- 启动恢复后，根据现有 tabs 重建配置绑定关系：`tabby-core/src/components/appRoot.component.ts`
- UI 上暴露 `Single expand mode` 开关：`tabby-core/src/components/appRoot.component.pug`
- 退出前统一准备 tabs 的恢复状态：`tabby-core/src/services/app.service.ts`

### 3.2 配置项右键菜单与会话菜单语义梳理

该分支补齐了边栏配置项的上下文菜单，区分“配置项菜单”和“活动会话 Other 菜单”的职责。

**主要变化**：

- 为边栏配置项增加右键菜单：
  - `连接`
  - `连接 SFTP`（仅 SSH 类型配置显示）
  - `关闭所有连接`
  - 后续还补充了 `Rename` / `Duplicate` 等更符合配置对象语义的菜单项
- `连接` 菜单的行为与单击配置项不同：
  - 单击：优先激活现有绑定标签，必要时才新建
  - 右键 `连接`：始终新建一个新的连接标签
- `Other` 列表中的会话项菜单被收敛为更偏“会话级”的操作，不再混入配置级菜单。

**涉及文件**：

- `tabby-core/src/components/appRoot.component.ts`
- `tabby-core/src/components/appRoot.component.pug`
- `tabby-ssh/src/tabContextMenu.ts`
- `tabby-settings/src/components/editProfileModal.component.ts`
- `tabby-settings/src/components/editProfileModal.component.pug`

### 3.3 SSH / SFTP：本地文件浏览、独立 SFTP 标签与面板体验

这是另一个高权重主题，目标是让 SSH 会话与 SFTP 使用流程更完整。

**主要变化**：

- 新增 SFTP 本地文件浏览能力，支持在 SFTP 面板中同时查看和操作本地/远端路径。
- 新增独立的 `SFTP Tab`：
  - 不再完全依赖嵌入式面板
  - 可以从 SSH 配置、菜单或上下文操作中单独打开 SFTP 标签页
- SFTP 面板支持可调尺寸的内联布局，并补齐相关国际化文案。
- 修复 SFTP 面板交互细节：
  - 点击外部区域不应误关闭
  - `Esc` 应该可以关闭
  - 透明窗口下的视觉表现与普通终端保持一致
- 优化 SFTP 选择状态和 SSH 配置编辑稳定性。

**对应文件**：

- `tabby-ssh/src/components/sftpPanel.component.ts`
- `tabby-ssh/src/components/sftpPanel.component.pug`
- `tabby-ssh/src/components/sftpPanel.component.scss`
- `tabby-ssh/src/components/sftpTab.component.ts`
- `tabby-ssh/src/components/sftpTab.component.pug`
- `tabby-ssh/src/components/sftpTab.component.scss`
- `tabby-ssh/src/services/sftpTabLauncher.service.ts`
- `tabby-ssh/src/tabContextMenu.ts`
- `tabby-ssh/src/index.ts`

### 3.4 SSH / SFTP：会话恢复、工作目录恢复与默认路径

这部分是 SSH 体验改进中技术含量最高的一块，覆盖“退出前采样”“启动后恢复”“恢复时弱化痕迹”“新建连接与恢复连接差异化策略”。

**主要变化**：

- 新增 SSH 恢复 token 内的工作目录与 SFTP 状态记录。
- 在窗口关闭前，主动向远端 shell 请求当前工作目录并写入恢复状态。
- 启动恢复时，延迟执行 `cd`，让 SSH 会话尽可能回到关闭前所在目录。
- 恢复时不再沿用“新连接就清屏”的逻辑，避免把恢复信息和路径切换过程清掉。
- 新建连接仍保留“连接后清空终端”的原有体验；恢复连接则跳过清屏。
- 为 SSH 配置新增两个默认路径：
  - `SFTP remote default path`
  - `SFTP local default path`
- 这两个默认路径仅在“新开连接 / 新开 SFTP”时生效，不会覆盖恢复现场时的路径。

**对应文件**：

- `tabby-ssh/src/components/sshTab.component.ts`
- `tabby-ssh/src/components/sshTab.component.pug`
- `tabby-ssh/src/components/sshTab.component.scss`
- `tabby-ssh/src/recoveryProvider.ts`
- `tabby-ssh/src/session/shell.ts`
- `tabby-ssh/src/components/sshProfileSettings.component.ts`
- `tabby-ssh/src/components/sshProfileSettings.component.pug`
- `tabby-ssh/src/api/interfaces.ts`
- `tabby-ssh/src/sftpPathSettings.ts`
- `tabby-terminal/src/api/connectableTerminalTab.component.ts`
- `tabby-terminal/src/api/baseTerminalTab.component.ts`
- `tabby-terminal/src/config.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`

**关键实现点**：

- 会话初始化时读取 `restoreWorkingDirectory`：`tabby-ssh/src/components/sshTab.component.ts`
- 当前目录变化时触发恢复状态更新：`tabby-ssh/src/components/sshTab.component.ts`
- 关闭前采样并准备恢复 token：`tabby-ssh/src/components/sshTab.component.ts`
- 通过 `OSC 1337 CurrentDir` 上报目录：`tabby-ssh/src/components/sshTab.component.ts`
- 恢复时仅执行 `cd`，不再夹带额外目录上报命令：`tabby-ssh/src/components/sshTab.component.ts`
- 恢复初连时跳过清屏：`tabby-terminal/src/api/connectableTerminalTab.component.ts`

### 3.5 Vault、主密码、SSH 密码保存与系统 secrets

这一块改动的目标是：在不强制用户每次输入主密码的前提下，允许 SSH 密码/密钥继续被保存和复用，并且把“清除主密码”和“清空所有 secrets”区分开。

**主要变化**：

- 重新梳理 Vault / 主密码 / secrets 的产品语义：
  - 主密码是“额外一层保护”，不再被默认强依赖。
  - 即使不启用主密码，也可继续保存 SSH 密码/密钥。
- 新增“清除主密码但保留已同步 secrets”的能力。
- 保留“彻底擦除 Vault 与所有 secrets”的危险操作，但文案更明确。
- 调整平台层 secrets / keychain 的处理流程，使“不开主密码但保留 SSH secrets”成为可行路径。
- 补齐设置页与弹窗中的相关说明文案，避免把“清除主密码”和“擦除 Vault”混淆。

**对应文件**：

- `tabby-settings/src/components/vaultSettingsTab.component.ts`
- `tabby-settings/src/components/vaultSettingsTab.component.pug`
- `tabby-settings/src/components/setVaultPassphraseModal.component.ts`
- `tabby-settings/src/components/setVaultPassphraseModal.component.pug`
- `tabby-core/src/services/vault.service.ts`
- `tabby-electron/src/services/platform.service.ts`
- `tabby-core/src/api/platform.ts`
- `tabby-core/src/api/index.ts`

**关键实现点**：

- 清除主密码但保留 secrets：`tabby-settings/src/components/vaultSettingsTab.component.ts`
- 文案区分：
  - `Clear the master passphrase and keep synced secrets`
  - `Erase the Vault and all stored secrets`
- Vault 行为调整：`tabby-core/src/services/vault.service.ts`
- 平台层 secrets 接入：`tabby-electron/src/services/platform.service.ts`

### 3.6 配置同步：冲突检测、自动同步收敛与 SFTP 状态并入

同步部分的目标是降低“多端/多窗口改配置”时的误覆盖风险，并让当前会话对同步状态的感知更准确。

**主要变化**：

- 为上传流程增加冲突检测上下文：
  - `expectedRemoteModifiedAt`
  - `localFingerprint`
  - `onConflict`
- 引入 `SyncConflictError` 以区分“网络失败”和“远端状态冲突”。
- 记录最近一次远端变更时间与最近同步的本地指纹，提高自动同步收敛能力。
- 收紧自动同步检查逻辑，避免不必要上传。
- 把当前 SFTP 相关状态纳入同步/变更感知范围。
- 改善断线重连与冲突后的 UX 提示。

**对应文件**：

- `tabby-settings/src/services/configSync.service.ts`
- `tabby-settings/src/components/configSyncSettingsTab.component.ts`
- `tabby-core/src/services/profiles.service.ts`

### 3.7 UI / 样式 / 交互补充修整

除功能外，这个分支还包含不少桌面端交互和视觉统一工作。

**主要变化**：

- 顶部标签栏重做为更贴近桌面应用的布局。
- 标签关闭按钮样式与 hover/active 状态细化。
- 当前活动标签样式调整。
- 终端 refit 与局部透明窗口适配修正。
- 处理了一部分 Sass 警告与 lint 问题。

**涉及文件**：

- `tabby-core/src/components/tabHeader.component.scss`
- `tabby-core/src/components/appRoot.component.scss`
- `tabby-core/src/theme.new.scss`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-serial/src/components/serialTab.component.pug`
- `tabby-telnet/src/components/telnetTab.component.pug`

### 3.8 中文文档、多语言补充与说明重构

该分支补充了较完整的中文使用说明，并把原本较集中的中文文档拆成模块化结构。

**主要变化**：

- 新增中文总览文档与索引页。
- 将中文使用指南拆分为 9 个专题文档：
  - 总览
  - 连接
  - 布局与 SFTP
  - 设置
  - Vault 与同步
  - 插件与传输
  - CLI 与配置
  - 平台 FAQ
  - 示例与快捷键
- 更新 `zh-CN`、`zh-TW` 及部分其它语言包，补足本分支引入的新文案。

**涉及文件**：

- `docs/INDEX.zh-CN.md`
- `docs/USAGE.zh-CN.md`
- `docs/USAGE-01-overview.zh-CN.md`
- `docs/USAGE-02-connections.zh-CN.md`
- `docs/USAGE-03-layout-sftp.zh-CN.md`
- `docs/USAGE-04-settings.zh-CN.md`
- `docs/USAGE-05-vault-sync.zh-CN.md`
- `docs/USAGE-06-plugins-transfers.zh-CN.md`
- `docs/USAGE-07-cli-config.zh-CN.md`
- `docs/USAGE-08-platform-faq.zh-CN.md`
- `docs/USAGE-09-examples-hotkeys.zh-CN.md`
- `locale/app.pot`
- `locale/en-GB.po`
- `locale/zh-CN.po`
- `locale/zh-TW.po`

### 3.9 CI / 构建 / 依赖与打包脚本调整

该分支也顺手处理了一些与发布、签名、文档部署相关的 CI 兼容性问题。

**主要变化**：

- GitHub Actions 中：
  - 当缺少 signing/packagecloud 凭据时，跳过对应步骤而不是直接失败。
  - 当文档发布缺少 Firebase service account 时，跳过部署。
  - 修复 workflows 中 secrets 条件判断的写法问题。
- Linux / Windows 构建脚本调整。
- 锁文件更新，修复 `electron node-gyp` 地址等依赖问题。
- `russh` 相关依赖升级。

**涉及文件**：

- `.github/workflows/build.yml`
- `.github/workflows/docs.yml`
- `scripts/build-linux.mjs`
- `scripts/build-windows.mjs`
- `app/package.json`
- `app/yarn.lock`
- `package.json`
- `yarn.lock`

## 4. 提交列表（按时间顺序）

| 顺序 | Commit | 摘要 |
| ---: | --- | --- |
| 1 | `c675a892` | feat: add SFTP local file browser panel and fix terminal tab refit |
| 2 | `19eb46a7` | bump russh |
| 3 | `91bb2bc0` | fix(ssh): keep SFTP panel open on outside click and close on Esc |
| 4 | `962ba24d` | feat(ssh): inline resizable sftp panel and complete panel i18n |
| 5 | `ec788ce2` | refactor(tabs): remove tab options button entry |
| 6 | `ab820992` | feat: improve SFTP panel selection and profile editing stability |
| 7 | `2d8882b1` | Merge branch 'Eugeny:master' into feat/sftp-local-panel-and-terminal-refit |
| 8 | `71fe7a7b` | feat(ssh): add open SFTP tab action |
| 9 | `a0150ab6` | fix: tighten config auto-sync check and include current sftp updates |
| 10 | `b9a042f0` | docs: split zh-CN usage guide into indexed modules |
| 11 | `2098337f` | feat(core): restyle top tab bar for desktop layout |
| 12 | `53186368` | fix: handle SSH disconnect states and align linux deb build metadata |
| 13 | `85dbad4d` | feat: harden config sync conflict handling and reconnect UX |
| 14 | `fea15473` | 优化打包脚本 |
| 15 | `65ea6c34` | style: refine tab close button states |
| 16 | `1b8f97f5` | change close button style |
| 17 | `1c44bc86` | feat: align royal sidebar behavior and tab width controls |
| 18 | `21ab51de` | fix: allow sftp panel and tab to follow window transparency |
| 19 | `eea8e30c` | fix(ci): use https for electron node-gyp in lockfile |
| 20 | `e4b6afe9` | fix(lint): resolve unnecessary-condition and import errors |
| 21 | `cc21d992` | ci: skip signing and packagecloud upload without credentials |
| 22 | `13a78c8a` | ci(docs): skip firebase deploy when service account is missing |
| 23 | `f24158f1` | change active tab style |
| 24 | `5c42c2c8` | fix(ui): refine royal sidebar and silence sass warnings |
| 25 | `51ed2d3a` | fix(tabs): refine restored titles and session kind labels |
| 26 | `bc80cc7e` | feat: improve royal sidebar bindings and vault flow |
| 27 | `a2f19c65` | feat: improve royal sidebar group behavior |
| 28 | `f48e6023` | fix(ci): resolve secrets access in GitHub Actions if conditions |
| 29 | `bc23783c` | fix(ci): resolve secrets access in docs.yml workflow |
| 30 | `7a423ed2` | fix(lint): resolve ESLint errors |
| 31 | `4020a358` | feat(ssh): implement working directory and SFTP state recovery |

## 5. 完整变更文件清单（按目录分组）

### 5.1 CI / 构建 / 顶层文件

- `.github/workflows/build.yml`
- `.github/workflows/docs.yml`
- `.gitignore`
- `app/package.json`
- `app/yarn.lock`
- `package.json`
- `scripts/build-linux.mjs`
- `scripts/build-windows.mjs`
- `yarn.lock`

### 5.2 文档与语言包

- `docs/INDEX.zh-CN.md`
- `docs/USAGE-01-overview.zh-CN.md`
- `docs/USAGE-02-connections.zh-CN.md`
- `docs/USAGE-03-layout-sftp.zh-CN.md`
- `docs/USAGE-04-settings.zh-CN.md`
- `docs/USAGE-05-vault-sync.zh-CN.md`
- `docs/USAGE-06-plugins-transfers.zh-CN.md`
- `docs/USAGE-07-cli-config.zh-CN.md`
- `docs/USAGE-08-platform-faq.zh-CN.md`
- `docs/USAGE-09-examples-hotkeys.zh-CN.md`
- `docs/USAGE.zh-CN.md`
- `locale/app.pot`
- `locale/en-GB.po`
- `locale/zh-CN.po`
- `locale/zh-TW.po`

### 5.3 `tabby-core`

- `tabby-core/src/api/index.ts`
- `tabby-core/src/api/platform.ts`
- `tabby-core/src/commands.ts`
- `tabby-core/src/components/appRoot.component.pug`
- `tabby-core/src/components/appRoot.component.scss`
- `tabby-core/src/components/appRoot.component.ts`
- `tabby-core/src/components/splitTab.component.ts`
- `tabby-core/src/components/tabHeader.component.pug`
- `tabby-core/src/components/tabHeader.component.scss`
- `tabby-core/src/configDefaults.yaml`
- `tabby-core/src/services/app.service.ts`
- `tabby-core/src/services/profiles.service.ts`
- `tabby-core/src/services/vault.service.ts`
- `tabby-core/src/theme.new.scss`

### 5.4 `tabby-settings`

- `tabby-settings/src/components/configSyncSettingsTab.component.ts`
- `tabby-settings/src/components/editProfileModal.component.pug`
- `tabby-settings/src/components/editProfileModal.component.ts`
- `tabby-settings/src/components/setVaultPassphraseModal.component.pug`
- `tabby-settings/src/components/setVaultPassphraseModal.component.ts`
- `tabby-settings/src/components/vaultSettingsTab.component.pug`
- `tabby-settings/src/components/vaultSettingsTab.component.ts`
- `tabby-settings/src/components/windowSettingsTab.component.pug`
- `tabby-settings/src/components/windowSettingsTab.component.ts`
- `tabby-settings/src/services/configSync.service.ts`

### 5.5 `tabby-ssh`

- `tabby-ssh/src/api/interfaces.ts`
- `tabby-ssh/src/components/sftpPanel.component.pug`
- `tabby-ssh/src/components/sftpPanel.component.scss`
- `tabby-ssh/src/components/sftpPanel.component.ts`
- `tabby-ssh/src/components/sftpTab.component.pug`
- `tabby-ssh/src/components/sftpTab.component.scss`
- `tabby-ssh/src/components/sftpTab.component.ts`
- `tabby-ssh/src/components/sshProfileSettings.component.pug`
- `tabby-ssh/src/components/sshProfileSettings.component.ts`
- `tabby-ssh/src/components/sshTab.component.pug`
- `tabby-ssh/src/components/sshTab.component.scss`
- `tabby-ssh/src/components/sshTab.component.ts`
- `tabby-ssh/src/index.ts`
- `tabby-ssh/src/profiles.ts`
- `tabby-ssh/src/recoveryProvider.ts`
- `tabby-ssh/src/services/sftpTabLauncher.service.ts`
- `tabby-ssh/src/session/shell.ts`
- `tabby-ssh/src/sftpPathSettings.ts`
- `tabby-ssh/src/tabContextMenu.ts`

### 5.6 其它模块

- `tabby-electron/src/services/platform.service.ts`
- `tabby-serial/src/components/serialTab.component.pug`
- `tabby-telnet/src/components/telnetTab.component.pug`
- `tabby-terminal/src/api/baseTerminalTab.component.ts`
- `tabby-terminal/src/api/connectableTerminalTab.component.ts`
- `tabby-terminal/src/components/terminalSettingsTab.component.pug`
- `tabby-terminal/src/config.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-web/src/platform.ts`

### 5.7 开发过程文件

- `plan/2026-03-07_00-54-52-sidebar-session-sync-menu.md`

## 6. 风险、兼容性与回归关注点

### 6.1 风险点

- **分支主题较多**：该分支混合了 UI、SSH/SFTP、Vault、同步、文档和 CI，多模块回归成本较高。
- **状态恢复链路较长**：恢复逻辑跨 `app service`、tab 恢复 token、SSH shell 与终端前端，多窗口/慢网络下更容易暴露时序问题。
- **Vault 行为调整有认知成本**：即便逻辑更贴近用户需求，也需要文案与设置页明确说明“主密码”和“保存 SSH secrets”并非同一个概念。
- **同步冲突控制更严格**：对历史上较“宽松”的同步流程来说，可能会暴露出此前未显性的冲突场景。

### 6.2 建议回归验证

建议至少覆盖以下场景：

1. 同一 SSH 配置反复打开多个标签后，边栏绑定、激活和 `Other` 列表是否稳定。
2. 启动恢复后，第一个 tab 是否能重新绑定回配置项，其余标签是否保留在 `Other`。
3. SSH 重连成功后，是否能正确恢复到关闭前远端路径；恢复连接与新连接的清屏策略是否正确分流。
4. `连接` / `连接 SFTP` / `关闭所有连接` / `Rename` / `Duplicate` 等菜单语义是否符合配置级或会话级预期。
5. 不启用主密码时，SSH secrets 是否仍可保存；清除主密码时是否不会误删已保存的 SSH secrets。
6. 多端或多窗口配置同步时，冲突提示与自动同步行为是否符合预期。
7. SFTP 本地默认路径在跨机器同步时是否存在平台路径兼容性问题。

## 7. 结论

相对 `master`，`feat/royal-sidebar-tab-width-sync` 已经从“单一侧边栏行为优化”扩展为一个覆盖 **Royal 侧栏 / 标签联动、SSH/SFTP 能力增强、恢复体验、Vault/主密码策略、配置同步健壮性、中文文档与 CI 兼容性** 的综合功能分支。

如果后续要合并到主线，建议按以下顺序复核：

1. **先看状态恢复链路**：Royal 绑定恢复、SSH 工作目录恢复、SFTP 恢复
2. **再看安全与保存策略**：Vault、主密码、SSH secrets 保存
3. **最后看外围影响**：同步冲突、文档、CI、打包与锁文件

