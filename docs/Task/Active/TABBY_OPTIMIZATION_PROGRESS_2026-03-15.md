# Tabby 优化阶段性进展快照（2026-03-15）

**状态**: ✅ 当前应用可稳定启动并进入主界面  
**关联任务**: `docs/Task/Active/TABBY_OPTIMIZATION_PLAN.md`  
**记录时间**: 2026-03-15

---

## 1. 当前稳定基线

截至 2026 年 3 月 15 日，当前工作分支已经从“应用无法启动/卡在启动画面”的状态恢复到“可正常进入主界面、插件链完整加载、AI Assistant 正常初始化”的稳定基线。

当前稳定基线的关键约束如下：

- `app/lib/window.ts:102` 仍保留 `nodeIntegration: true`
- `app/lib/window.ts:105` 仍保留 `contextIsolation: false`
- `app/index.pug:5` 的 CSP 仍必须允许 `unsafe-eval`
- 根因在于 `app/src/entry.ts:57` 仍使用 `platformBrowserDynamic().bootstrapModule(...)`

这几项不是遗漏，而是为了维持当前启动链稳定性而保留的兼容设置。在插件主加载链和 Angular 启动路径没有完成更大规模重构之前，不应直接移除。

---

## 2. 已解决的用户可见问题

本阶段已经解决或稳定绕过的用户可见问题包括：

- `@electron/remote` 缺失导致的启动失败
- Angular `AnimationBuilder` / `@angular/compiler` JIT 报错
- `StartPageComponent` 的 `NG0100 ExpressionChangedAfterItHasBeenCheckedError`
- 多次出现的“卡在启动画面”
- 插件链因原生模块/可选依赖打包问题导致的构建失败

当前应用已经能够完成以下关键路径：

- 主窗口启动
- builtin plugin pinning
- 插件发现与加载
- 主界面进入
- AI Assistant 初始化

---

## 3. 已完成的结构性收口

### 3.1 Renderer / Runtime 能力面收缩

已经把 renderer 中一批低风险、可替换的 Node 直接依赖逐步迁移到统一 runtime/bridge 能力：

- 新增运行时环境访问封装：`tabby-core/src/api/rendererRuntime.ts`
- 新增共享环境变量白名单：`tabby-core/src/api/runtimeEnv.ts`
- preload bridge 统一暴露 runtime 信息：`app/src/bridge.preload.ts`
- `SSH` 用户名中 `$ENV_VAR` 的解析改为使用 `resolveRuntimeEnv()`，不再直接访问 `process.env[...]`

本轮进一步完成了两点：

1. 移除了 preload bridge 中未被实际使用的 `listEnvKeys` 动态枚举能力  
   结果：renderer 无法再通过 bridge 动态枚举环境变量键名，只能按白名单读取或做单键安全查询。

2. 把 `tabby-terminal/src/frontends/xtermFrontend.ts:128` 中对 `process.platform` 的直接读取改为 `getRuntimePlatform()`  
   结果：继续减少 renderer 对 Node `process` 的直接耦合。

### 3.2 本地终端环境变量处理下沉到主进程

`tabby-local` 之前会在 renderer 中自己拼接整份环境变量。现在这部分已经下沉到主进程 PTY：

- renderer 仅传递：
  - `env` 默认值
  - `tabbyProfileEnv`
  - `tabbyTerminalEnv`
  - `tabbySetComSpec`
  - `tabbyExecutable`
- 主进程 `app/lib/pty.ts` 统一完成：
  - `mergeEnv()`
  - `substituteEnv()`
  - `normalizeSpawnOptions()`

结果：

- `tabby-local/src/session.ts` 中原先的 `process.env` / `process.platform` 动态环境处理已大幅减少
- 保持现有功能语义不变，仍支持 `%PATH%` / `$PATH` 展开、Windows `COMSPEC`、macOS locale 补齐

### 3.3 AI Assistant 文件存储移出 `window.require('fs')`

`tabby-ai-assistant` 的 `FileStorageService` 已不再依赖 `window.require('fs')` / `global.fs`，改为走主进程 bridge IPC：

- 异步 bridge：
  - `bridge:fs:exists`
  - `bridge:fs:stat`
  - `bridge:fs:read-file-text`
  - `bridge:fs:write-file-text`
  - `bridge:fs:read-dir`
  - `bridge:fs:realpath`
  - `bridge:fs:chmod`
- 同步 bridge（为了兼容其同步接口）：
  - `bridge:fs:exists-sync`
  - `bridge:fs:stat-sync`
  - `bridge:fs:read-file-text-sync`
  - `bridge:fs:write-file-text-sync`
  - `bridge:fs:read-dir-sync`
  - `bridge:fs:mkdir-sync`
  - `bridge:fs:unlink-sync`

结果：

- AI Assistant 仍能正常初始化
- 文件存储不再直接依赖 renderer Node `fs`

### 3.4 编码/加密相关冗余清理

已经完成以下收口：

- renderer 侧简单 `crypto` 用途改为 Web Crypto helper
- 建立 `tabby-core/src/base64.ts`
- 替换一批仅用于编码/解码的 `Buffer.from(...).toString('base64')` 类场景

涉及模块包括：

- `tabby-ssh`
- `tabby-electron`
- `tabby-settings`
- `tabby-ai-assistant`

结果：

- 减少了 renderer 中“为了编码而引入 Node Buffer/crypto”的场景
- 保留了终端协议链路中确实需要 `Buffer` 的二进制处理，不做错误清理

### 3.5 插件加载链外围收口

插件主加载链仍然是高风险区，但外围已完成一轮低风险收口：

- `app/src/plugins.ts` 中 `fs.existsSync(...)` 已改走 `bridge:fs:exists-sync`
- `appPath` 读取也已改走 bridge IPC
- `Module.prototype.require` 补丁作用域已收窄为仅对插件模块及其依赖链生效

当前仍保留但暂不建议硬改的部分：

- `nodeRequire('module')`
- `nodeRequire.resolve(...)`
- `nodeRequire(foundPlugin.path)`
- `Module.prototype.require` 补丁本身

这些是当前 CommonJS 插件加载链的核心兼容逻辑。

### 3.6 PTY 相关安全/性能收口

本阶段末尾又完成了两项 PTY 相关优化：

1. `tabby-local` 的优雅退出逻辑不再在 renderer 中直接调用 `process.kill(pid, 0)` 探测存活  
   现在改为通过 `PTYProxy.exists()` 走现有 `pty:exists` IPC。

2. 主进程 `PTYManager.resolveTruePID()` 新增按 PTY ID 的 promise 缓存  
   结果：`getWorkingDirectory()` / `getChildProcesses()` 不再为同一个 PTY 重复触发 2 秒等待和子进程链解析。

涉及文件：

- `tabby-local/src/api.ts`
- `tabby-electron/src/pty.ts`
- `tabby-local/src/session.ts`
- `app/lib/pty.ts`

### 3.7 AI Assistant 渲染安全与交互规范化

参考外部优化文档的思路后，本轮只吸收了“高收益、低风险”的部分，没有照搬其大范围抽象或形式化重构。

已完成的具体收口如下：

1. AI Sidebar 的 Markdown/HTML 渲染统一经过现有 `sanitizeHTML()`  
   结果：`marked.parse(...)` 输出与 fallback HTML 都在进入 `[innerHTML]` 前先做消毒，降低富文本消息的 XSS 风险。

2. Toast 提示不再把动态消息直接拼进 `innerHTML`  
   结果：改为 `createElement(...) + textContent` 组装图标和文本，避免通知内容带入 HTML 注入面。

3. AI Assistant 动态主题样式和核心主题自定义 CSS 改为写入 `textContent`  
   结果：保留样式功能，同时收缩直接 HTML 注入路径。

4. AI Assistant 模板内一批交互按钮补齐 `type="button"`  
   结果：避免未来局部嵌入 `<form>` 或对话框表单时，按钮默认触发表单提交，减少隐式行为和事件串扰。

涉及文件包括：

- `tabby-ai-assistant/src/components/chat/ai-sidebar.component.ts`
- `tabby-ai-assistant/src/components/chat/chat-input.component.html`
- `tabby-ai-assistant/src/components/chat/chat-interface.component.html`
- `tabby-ai-assistant/src/components/chat/chat-message.component.html`
- `tabby-ai-assistant/src/components/chat/chat-settings.component.html`
- `tabby-ai-assistant/src/components/common/error-message.component.html`
- `tabby-ai-assistant/src/components/settings/ai-settings-tab.component.html`
- `tabby-ai-assistant/src/components/settings/context-settings.component.html`
- `tabby-ai-assistant/src/components/settings/data-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/mcp-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/proxy-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/provider-config.component.html`
- `tabby-ai-assistant/src/components/settings/security-settings.component.html`
- `tabby-ai-assistant/src/components/terminal/ai-toolbar-button.component.html`
- `tabby-ai-assistant/src/components/terminal/command-preview.component.html`
- `tabby-ai-assistant/src/components/terminal/command-suggestion.component.html`
- `tabby-ai-assistant/src/services/core/toast.service.ts`
- `tabby-ai-assistant/src/services/core/theme.service.ts`
- `tabby-core/src/services/themes.service.ts`

### 3.8 AI Sidebar 监听器清理与异步任务轮询收口

本轮顺手处理了两处真实但风险较低的问题：

1. `AiSidebarService` 的窗口 resize / 拖拽 resize 监听改为显式注册与清理  
   结果：隐藏侧边栏或重建侧边栏时，不再依赖 DOM 节点回收“顺带”释放事件处理器；如果拖拽过程中侧栏被关闭，也会主动移除 `mousemove` / `mouseup` 监听并恢复光标状态。

2. `AsyncTaskManagerService` 中无效的 `takeUntil(new Subject())` 已移除  
   结果：轮询逻辑改为直接持有 `Subscription` 并由现有 `stopMonitoring()` / 完成回调负责释放，避免误导性的 RxJS 写法。

涉及文件：

- `tabby-ai-assistant/src/services/chat/ai-sidebar.service.ts`
- `tabby-ai-assistant/src/services/terminal/async-task-manager.service.ts`

### 3.9 冗余销毁样板清理与启动时序修复

在继续复查后，本轮又补了两类“低风险但实际有价值”的收口：

1. 删除一批没有任何订阅依赖的 `destroy$` / `OnDestroy` 样板代码  
   结果：减少无意义生命周期噪音，避免后续维护者误以为这些组件或服务存在需要依赖 `destroy$` 释放的订阅链。

2. `CommandPreviewComponent` 的延迟状态清空 / 自动关闭改为托管定时器并在销毁时清理  
   结果：如果预览组件提前关闭或被销毁，不会再保留悬挂的 `setTimeout` 回调。

3. `AppRootComponent` 把 `app.emitReady()` 延后到根视图稳定后再发布  
   结果：修复开发态下 `AppRootComponent` 的 `NG0100 ExpressionChangedAfterItHasBeenCheckedError`，避免插件在同一轮变更检测中同步回流修改根界面状态。

涉及文件：

- `tabby-ai-assistant/src/components/settings/security-settings.component.ts`
- `tabby-ai-assistant/src/components/chat/chat-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/proxy-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/data-settings.component.ts`
- `tabby-ai-assistant/src/components/chat/chat-message.component.ts`
- `tabby-ai-assistant/src/components/settings/provider-config.component.ts`
- `tabby-ai-assistant/src/components/settings/context-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/general-settings.component.ts`
- `tabby-ai-assistant/src/components/terminal/command-preview.component.ts`
- `tabby-ai-assistant/src/components/chat/ai-sidebar.component.ts`
- `tabby-ai-assistant/src/services/mcp/mcp-client-manager.service.ts`
- `tabby-core/src/components/appRoot.component.ts`

### 3.10 Chat 界面定时器托管补全

本轮继续沿着“组件销毁时不应保留悬挂定时器”的思路，把聊天相关两个核心界面的散落 `setTimeout` 统一收口：

1. `ChatInterfaceComponent` 新增统一的 timeout 调度与清理 helper  
   结果：滚动刷新、焦点恢复、延迟状态同步等回调在组件销毁时可统一取消，不再依赖组件碰巧长生命周期。

2. `AiSidebarComponent` 也补齐了同样的 timeout 托管机制  
   结果：预设消息自动发送、滚动状态延迟刷新、输入框 auto-resize、sidebar 内部 scroll refresh / detectChanges 等异步回调，在侧边栏关闭或组件销毁时会被统一清理。

3. 原有的 `pendingLoadingUpdate` / `pendingScrollUpdate` 专用句柄仍保留其业务语义，但底层超时也已纳入统一托管集合  
   结果：既保留“是否已有待执行更新”的判定逻辑，又减少遗漏清理的机会。

涉及文件：

- `tabby-ai-assistant/src/components/chat/chat-interface.component.ts`
- `tabby-ai-assistant/src/components/chat/ai-sidebar.component.ts`

### 3.11 RxJS 废弃 `toPromise()` 清理

当前项目里非 `other/` 目录的 `toPromise()` 残留已经全部清理完毕，本轮只做语义等价替换，不调整业务时序：

1. 对 `AsyncSubject` / `ready$` 场景统一改为 `lastValueFrom(...)`  
   原因：这与原先“等待流完成并取最终值”的语义最接近，避免把“等待 ready 完成”误改成“等待首个值”。

2. 对 `zmodem` 里“等待取消事件第一次到来”的场景改为 `firstValueFrom(...)`  
   原因：该流本身就是“拿到首个取消信号即返回”，使用 `firstValueFrom` 更直接，也消除了废弃 API。

3. 本轮没有改动这些链路的订阅结构、初始化顺序和副作用逻辑  
   结果：只移除废弃 API 依赖，降低后续 RxJS 升级摩擦，不扩大行为变更面。

涉及文件：

- `tabby-ai-assistant/src/index.ts`
- `tabby-core/src/services/themes.service.ts`
- `tabby-core/src/services/hotkeys.service.ts`
- `tabby-core/src/services/app.service.ts`
- `tabby-core/src/services/vault.service.ts`
- `tabby-electron/src/index.ts`
- `tabby-electron/src/services/updater.service.ts`
- `tabby-settings/src/services/configSync.service.ts`
- `tabby-terminal/src/features/zmodem.ts`

### 3.12 设置页与输入框的零散超时清理

在聊天主界面和侧边栏之外，本轮又顺手补了一批同样类型、但粒度更小的界面层超时清理：

1. `ChatInputComponent` 的输入框 auto-resize / 历史导航光标恢复改为统一托管 timeout  
   结果：输入框组件提前销毁时，不会再保留延迟的高度调整或光标定位回调。

2. `MCPSettingsComponent` 的编辑器和 JSON 导入对话框聚焦延迟改为统一托管 timeout  
   结果：如果对话框或设置页在下一轮宏任务前关闭，不会再尝试对已失效的输入元素执行 focus。

3. `ProviderConfigComponent` 与 `GeneralSettingsComponent` 的本地服务状态探测超时补齐 `finally` 清理  
   结果：即使请求异常、超时或被 abort，关联的 2 秒 timeout 也不会遗漏在事件循环里。

涉及文件：

- `tabby-ai-assistant/src/components/chat/chat-input.component.ts`
- `tabby-ai-assistant/src/components/settings/mcp-settings.component.ts`
- `tabby-ai-assistant/src/components/settings/provider-config.component.ts`
- `tabby-ai-assistant/src/components/settings/general-settings.component.ts`

### 3.13 `tabby-core` 小型 Directive 生命周期收口

本轮继续把同类问题向 `tabby-core` 的小型 UI directive 扩展，但仍然保持在低风险范围内：

1. `AutofocusDirective` 的延迟 focus 增加销毁时清理  
   结果：宿主元素在下一轮宏任务前被移除时，不会再触发迟到的 focus。

2. `AlwaysVisibleTypeaheadDirective` 的 focus 监听改为显式注册/移除，并补齐延迟 input 事件 timeout 清理  
   结果：避免 directive 销毁后保留匿名 DOM 监听器。

3. `DropZoneDirective` 的 `dragover` / `drop` / `dragleave` 监听器改为可移除的命名处理器，同时把提示层 show/remove 定时器纳入统一托管  
   结果：拖拽提示 DOM 和相关回调在 directive 销毁时可完整释放，不再依赖节点回收“顺带”清理。

涉及文件：

- `tabby-core/src/directives/autofocus.directive.ts`
- `tabby-core/src/directives/alwaysVisibleTypeahead.directive.ts`
- `tabby-core/src/directives/dropZone.directive.ts`

### 3.14 Toast 与通知点击回调微收口

在继续复扫后，本轮又处理了两处很小但真实存在的运行时细节问题：

1. `ToastService` 的自动消失与淡出移除 timeout 改为按 toast 实例统一登记与清理  
   结果：用户手动点击关闭 toast 时，不会再保留旧的自动关闭/移除定时器；重复调用 `removeToast()` 时也能减少重复回调。

2. `tabContextMenu` 中系统通知的点击回调改为直接挂在 `notification.onclick` 上  
   结果：点击通知后仍会正常选中对应 tab，同时会主动关闭通知对象，避免继续保留匿名事件监听器风格。

涉及文件：

- `tabby-ai-assistant/src/services/core/toast.service.ts`
- `tabby-core/src/tabContextMenu.ts`

### 3.15 `tabby-core` 零散延迟回调补清理

继续向后复扫后，本轮又收掉了两个非常小但同类的问题：

1. `TabHeaderComponent` 的拖拽结束延迟回调现在会在组件销毁时清理  
   结果：如果 tab header 在拖拽结束回调真正执行前被销毁，不会再迟到触发 `emitTabDragEnded()` / `emitTabsChanged()`。

2. `SelectorModalComponent` 的 `selectOption()` 关闭弹窗后延迟执行 callback，现在也会在组件销毁时清理  
   结果：减少 modal 生命周期结束后继续执行陈旧 callback 的机会。

涉及文件：

- `tabby-core/src/components/tabHeader.component.ts`
- `tabby-core/src/components/selectorModal.component.ts`

### 3.16 `fastHtmlBind` 事件收口与聚焦延迟统一

本轮继续处理 UI 层剩余的两处细节问题：

1. `FastHtmlBindDirective` 的链接点击回调改为可清理的 `onclick` 绑定，并在 `ngOnChanges`/`ngOnDestroy` 中统一释放  
   结果：避免 DOM 更新频繁时保留旧的匿名事件监听器。

2. `focusElementLater()` 由 `void` 改为返回 timeout id（便于调用方自行托管），`MCPSettingsComponent` 也不再嵌套一层 `setTimeout`  
   结果：延迟 focus 的回调路径更可控，避免双层定时器难以统一清理。

涉及文件：

- `tabby-core/src/directives/fastHtmlBind.directive.ts`
- `tabby-core/src/utils.ts`
- `tabby-ai-assistant/src/components/settings/mcp-settings.component.ts`

### 3.17 StartPage `NG0100` 复发修正

StartPage 的命令列表在 `afterNextRender` 回调中同步回写，部分环境仍可能触发开发态 `NG0100 ExpressionChangedAfterItHasBeenCheckedError`。本轮改为在 `afterNextRender` 内再延迟一个宏任务更新，同时在组件销毁时清理定时器与标记销毁状态，避免在同一轮变更检测里修改绑定值。

涉及文件：

- `tabby-core/src/components/startPage.component.ts`

### 3.18 RecoveryProvider 抽象收口

`tabby-local` / `tabby-serial` / `tabby-ssh` / `tabby-telnet` 的 `RecoveryProvider` 逻辑高度重复，本轮在 `tabby-core` 抽出通用基类 `GenericRecoveryProvider`，统一处理 token 匹配与基础输入构建。各模块仅保留最小构造参数，`ssh` 仅在基类基础上覆盖 SFTP 相关输入字段。

涉及文件：

- `tabby-core/src/api/genericRecoveryProvider.ts`
- `tabby-core/src/api/index.ts`
- `tabby-local/src/recoveryProvider.ts`
- `tabby-serial/src/recoveryProvider.ts`
- `tabby-ssh/src/recoveryProvider.ts`
- `tabby-telnet/src/recoveryProvider.ts`

### 3.19 Hotkeys/App/Vault 的零散清理

本轮继续收口三处生命周期细节，避免在极端情况下保留无效回调或过期定时器：

1. `HotkeysService` 的全局事件监听器改为可追踪并在销毁时移除  
   结果：避免未来热重载或手动销毁服务时遗留全局监听器。

2. `AppService` 的定期保存提示 interval 增加销毁时清理  
   结果：服务生命周期结束时不会继续触发保存提示。

3. `VaultService` 的 passphrase 记忆超时支持覆盖清理  
   结果：多次解锁时不会被旧定时器提前清空记忆口令。

涉及文件：

- `tabby-core/src/services/hotkeys.service.ts`
- `tabby-core/src/services/app.service.ts`
- `tabby-core/src/services/vault.service.ts`

### 3.20 SSH Tab 的零散 timeout 托管

`SSHTabComponent` 内部的延迟回调统一纳入托管集合，并在组件销毁时清理，避免 SFTP 面板切换或组件销毁后仍触发滚动/尺寸校正回调。

涉及文件：

- `tabby-ssh/src/components/sshTab.component.ts`

### 3.21 SSH Session 的延迟销毁托管

`SSHSession` 在断开连接时会延迟触发 `destroy()`，本轮为该延迟回调增加可清理的句柄，并在销毁流程开始时清理，避免重复排队或销毁后迟到执行。

涉及文件：

- `tabby-ssh/src/session/ssh.ts`

### 3.22 SFTP 本地编辑轮询清理

`sftpContextMenu` 的本地编辑轮询增加了对“轮询启动定时器”的清理，避免在停止监听后仍延迟启动轮询。

涉及文件：

- `tabby-electron/src/sftpContextMenu.ts`

### 3.23 SSH 目录探测轮询中止条件

`SSHTabComponent` 的工作目录探测轮询在组件销毁或会话关闭时提前中止，避免无意义等待或对已结束会话继续轮询。

涉及文件：

- `tabby-ssh/src/components/sshTab.component.ts`

### 3.24 SSH Ready Timeout 销毁中止

`SSHSession.withReadyTimeout` 在会话销毁时提前终止等待并清理定时器，避免连接关闭后仍等待超时回调。

涉及文件：

- `tabby-ssh/src/session/ssh.ts`

### 3.28 SSH Ready Timeout 订阅清理

`SSHSession.withReadyTimeout` 在超时触发时也会释放 `willDestroy$` 订阅，避免超时后保留无用订阅。

涉及文件：

- `tabby-ssh/src/session/ssh.ts`

### 3.25 Window 调试与拖拽定时器托管

`app/lib/window.ts` 中用于调试打开与拖拽结束的定时器改为统一托管，并在窗口销毁时清理，避免窗口关闭后仍有定时回调触发。

涉及文件：

- `app/lib/window.ts`

### 3.34 Window 定时器 unref

`app/lib/window.ts` 的统一定时器托管增加 `unref`，减少定时器对事件循环的阻塞。

涉及文件：

- `app/lib/window.ts`

### 3.26 AppRoot 延迟回调托管

`AppRootComponent` 内部的延迟回调统一托管，并在组件销毁时清理；自动更新的 interval 也在销毁时关闭，避免卸载后仍触发回调。

涉及文件：

- `tabby-core/src/components/appRoot.component.ts`

### 3.27 插件加载延迟托管

`app/src/plugins.ts` 的插件加载进度延迟改为集中 `delay()`，并在 Node 环境下 `unref` 计时器，减少对事件循环的额外占用。

涉及文件：

- `app/src/plugins.ts`

### 3.29 PTY 延迟等待 unref

`PTYManager.resolveTruePID` 的延迟等待补充 `unref`，避免后台等待阻塞进程退出。

涉及文件：

- `app/lib/pty.ts`

### 3.30 托盘点击延迟 unref

托盘点击的延迟 focus 回调补充 `unref`，避免计时器阻塞进程退出。

涉及文件：

- `app/lib/app.ts`

### 3.31 PathDrop 延迟回调 unref

`PathDropDecorator` 的延迟订阅回调补充 `unref`，减少对事件循环的占用。

涉及文件：

- `tabby-electron/src/pathDrop.ts`

### 3.32 ConfigService init 延迟 unref

`ConfigService` 的延迟初始化回调补充 `unref`，避免计时器阻塞进程退出。

涉及文件：

- `tabby-core/src/services/config.service.ts`

### 3.33 ConfigService init 延迟构建验证

本轮对 `ConfigService` 的延迟初始化补齐 `unref` 后，已重新验证 `tabby-core` 构建通过。

### 3.34 ConfigService unref 类型兼容修复

`ConfigService` 的 `unref` 调用改为基于 `any` 的安全检测，避免在 DOM 类型环境中被推断为 `never` 导致构建失败。

涉及文件：

- `tabby-core/src/services/config.service.ts`

### 3.35 BaseTerminalTab 延迟回调托管

`BaseTerminalTabComponent` 的延迟回调统一托管并在销毁时清理，避免 tab 销毁后仍触发 resize/configure/活动检测回调。

涉及文件：

- `tabby-terminal/src/api/baseTerminalTab.component.ts`

### 3.36 Terminal 延迟回调 unref

`tabContextMenu` / `xtermFrontend` / `zmodem` 的延迟回调补充 `unref`，减少对事件循环的额外占用。

涉及文件：

- `tabby-terminal/src/tabContextMenu.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-terminal/src/features/zmodem.ts`

### 3.37 SSH Tab 定时器命名冲突修复

`SSHTabComponent` 的定时器管理方法与基类私有成员冲突，已更名以避免继承冲突并修复构建错误。

涉及文件：

- `tabby-ssh/src/components/sshTab.component.ts`

### 3.38 setImmediate 延迟回调收口

继续收口剩余 `setImmediate`，在不改业务时序的前提下补齐 `unref` 或纳入现有托管：

1. `BaseTerminalTabComponent` 的两处 `setImmediate` 改为统一的 `scheduleTimeout`，确保组件销毁时可清理。
2. `PTY` 的数据队列与继续发送路径补齐 `unref`，避免计时器阻塞主进程退出。
3. `AppService` / `DockingService` / `xtermFrontend` 的 `setImmediate` 补齐 `unref`，降低事件循环占用。

涉及文件：

- `tabby-terminal/src/api/baseTerminalTab.component.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-core/src/services/app.service.ts`
- `tabby-electron/src/services/docking.service.ts`
- `app/lib/pty.ts`

### 3.39 LocalSession 优雅退出延迟 unref

`tabby-local` 的 `gracefullyKillProcess()` 在等待 SIGTERM 后的 500ms 延迟回调补齐 `unref`，避免在 Node 环境中因为计时器而阻塞进程退出。

涉及文件：

- `tabby-local/src/session.ts`

### 3.40 setImmediate 收尾清理

继续处理剩余 `setImmediate` 的低风险路径：

1. `SerialTabComponent` 的初始化标题设置改为使用基类 `scheduleTimeout`，确保 tab 销毁时能统一清理。
2. `SettingsTabBodyComponent` 的延迟组件创建改为 `setTimeout(0)`，并增加 `OnDestroy` 清理，避免视图销毁后仍触发延迟创建。

涉及文件：

- `tabby-serial/src/components/serialTab.component.ts`
- `tabby-settings/src/components/settingsTabBody.component.ts`

### 3.41 tabby-terminal unref 类型兼容修正

`tabby-terminal` 中多处 `setTimeout` 的 `unref` 判断在某些仅包含 DOM 类型的构建配置下会被推断为 `never`，导致 TypeScript 报错。本轮统一改为基于 `any` 的安全检测，避免类型系统误判，同时保持运行时行为不变。

涉及文件：

- `tabby-terminal/src/tabContextMenu.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-terminal/src/features/zmodem.ts`

### 3.42 设置按钮空引用修复

设置按钮点击时 `SettingsTabOpener` 在极端环境下可能为 `null`，导致点击直接抛出 `Cannot read properties of null (reading 'open')`。本轮补齐了两层兜底：

1. `SettingsTabOpenerService` 显式加入模块 providers，确保 DI 可用。
2. `ButtonProvider` 对 `SettingsTabOpener` 做可选注入，并在缺失时回退为 `AppService` 直接打开/选中 `SettingsTabComponent`。

涉及文件：

- `tabby-settings/src/index.ts`
- `tabby-settings/src/buttonProvider.ts`

### 3.43 Serial 启动延迟托管与设置弹窗延迟清理

进一步补齐两处低风险延迟处理，避免销毁后继续触发回调：

1. `SerialSession` 的 `streamProcessor.start()` 延迟回调增加句柄托管与 `destroy()` 清理，并在执行前检查 `open` 状态。
2. `EditProfileModalComponent` 的延迟 settings 组件创建增加句柄托管与 `OnDestroy` 清理，避免弹窗关闭后仍执行延迟插入。

涉及文件：

- `tabby-serial/src/api.ts`
- `tabby-settings/src/components/editProfileModal.component.ts`

### 3.44 MCP SSE 重连定时器清理

`SSETransport` 的重连逻辑加入定时器句柄托管，确保在 `disconnect()` / `destroy()` 后不会遗留重连回调，避免断开连接后仍被旧定时器重新拉起连接。

涉及文件：

- `tabby-ai-assistant/src/services/mcp/transports/sse-transport.ts`

### 3.45 AsyncTaskManager 延迟启动托管

`AsyncTaskManagerService` 的任务延迟启动加入句柄托管，并在任务移除时清理未触发的启动回调，避免任务快速取消/移除时仍可能异步执行。

涉及文件：

- `tabby-ai-assistant/src/services/terminal/async-task-manager.service.ts`

### 3.46 ConfigSync 自动同步可取消

`ConfigSyncService` 的自动同步轮询加入销毁标记与 sleep 句柄托管，确保服务销毁后不会继续轮询或遗留定时器。

涉及文件：

- `tabby-settings/src/services/configSync.service.ts`

### 3.47 MCP HTTP 轮询 sleep 可取消

`HTTPStreamTransport` 的轮询失败退避 sleep 加入句柄托管，`disconnect()` / `destroy()` 时可立即中止等待，避免断开后仍阻塞 5 秒再退出轮询。

涉及文件：

- `tabby-ai-assistant/src/services/mcp/transports/http-transport.ts`

### 3.48 TerminalManager 延迟等待托管

`TerminalManagerService` 内部的多处延迟等待改为统一 `sleep()`，并在 `dispose()` 时清理挂起的等待，避免服务清理后仍保留延迟回调。

涉及文件：

- `tabby-ai-assistant/src/services/terminal/terminal-manager.service.ts`

### 3.49 Provider Stream Reader 清理

`Ollama` 与 `vLLM` 的流式读取新增 reader 句柄托管，在流结束或取消时主动 `cancel()`，避免中止流后仍保留未释放的 reader。

涉及文件：

- `tabby-ai-assistant/src/services/providers/ollama-provider.service.ts`
- `tabby-ai-assistant/src/services/providers/vllm-provider.service.ts`

### 3.50 AiAssistantService 刷新定时器清理

`AiAssistantService` 的 provider 刷新延迟回调加入销毁时清理，并在销毁时解除配置变更订阅，避免服务生命周期结束后仍触发刷新。

涉及文件：

- `tabby-ai-assistant/src/services/core/ai-assistant.service.ts`

### 3.51 BaseAiProvider 退避 sleep 可提前结束

`BaseAiProvider.withRetry()` 的指数退避改为使用可提前结束的 `sleep()`，并在 provider 销毁后直接跳过等待，避免卸载时仍长时间阻塞重试循环。

涉及文件：

- `tabby-ai-assistant/src/services/providers/base-provider.service.ts`

### 3.52 AiAssistantModule 延迟初始化托管

`AiAssistantModule` 的侧边栏延迟初始化加入句柄托管与订阅清理，确保模块销毁后不再触发初始化回调或保留订阅。

涉及文件：

- `tabby-ai-assistant/src/index.ts`

### 3.53 TerminalTools 延迟等待托管

`TerminalToolsService` 的命令等待与重试轮询改为统一 `sleep()`，并在服务销毁时清理挂起的等待，避免长等待期间服务被销毁后仍保留回调。

涉及文件：

- `tabby-ai-assistant/src/services/terminal/terminal-tools.service.ts`

### 3.54 BaseAiProvider 退避 sleep 句柄托管

`BaseAiProvider.sleep()` 现在会记录等待句柄，`destroy()` 时主动清理并唤醒等待，避免 provider 销毁后仍长时间阻塞退避等待。

涉及文件：

- `tabby-ai-assistant/src/services/providers/base-provider.service.ts`

### 3.55 BaseAiProvider/AiAssistantModule 延迟 unref

补齐两处延迟计时器的 `unref` 检测，减少在 Node/Electron 环境下对事件循环的阻塞：

1. `BaseAiProvider.sleep()` 增加 `unref`。
2. `AiAssistantModule` 的侧边栏延迟初始化计时器增加 `unref`。

涉及文件：

- `tabby-ai-assistant/src/services/providers/base-provider.service.ts`
- `tabby-ai-assistant/src/index.ts`

### 3.56 SSH 目录探测短轮询可取消

`SSHTabComponent` 的目录探测短轮询改为统一 sleep 句柄托管，组件销毁时会清理并唤醒等待，避免销毁后仍保留 50ms 轮询等待。

涉及文件：

- `tabby-ssh/src/components/sshTab.component.ts`

### 3.57 剩余延迟逻辑复扫

本轮对项目中剩余 `setTimeout` / `setInterval` 进行了复扫。确认这些延迟要么已具备清理与托管机制，要么属于一次性 UI 延迟且不影响退出或生命周期收敛，未发现新的低风险可收口点。

### 3.58 Webpack 持久化缓存与性能预算

为 app renderer/main 与插件通用配置引入 filesystem cache，增加 `TABBY_DISABLE_CACHE` 开关与构建依赖跟踪；在 production 下补齐温和的 performance budget，避免异常体积增长被忽略；主进程 `ts-loader` 增加 `TABBY_FAST_BUILD` 快速编译开关（默认关闭）。

涉及文件：

- `app/webpack.config.mjs`
- `app/webpack.config.main.mjs`
- `webpack.plugin.config.mjs`

### 3.59 Bundle 分析开关补齐

补齐 renderer 侧 `BUNDLE_ANALYZER` 开关，并确保与 filesystem cache 互斥；插件侧继续使用 `PLUGIN_BUNDLE_ANALYZER=<plugin>`；主进程保留 `BUNDLE_ANALYZER` 开关。

涉及文件：

- `app/webpack.config.mjs`
- `app/webpack.config.main.mjs`
- `webpack.plugin.config.mjs`

### 3.60 ESLint 规则恢复（首批）

把 `no-explicit-any` / `no-floating-promises` / `require-await` / `strict-boolean-expressions` / `prefer-readonly` / `member-ordering` 调整为 `warn`，作为分阶段恢复规则的起点。

涉及文件：

- `.eslintrc.yml`

### 3.61 依赖管理自动化

新增 `deps:check` / `deps:audit` / `deps:update` 脚本与 CI workflow，支持定期过期依赖检查与安全审计。

涉及文件：

- `package.json`
- `scripts/deps-check.mjs`
- `scripts/deps-audit.mjs`
- `scripts/deps-update.mjs`
- `.github/workflows/deps-check.yml`

### 3.62 主进程 noImplicitAny 阶段落地

先在主进程 `app/tsconfig.main.json` 启用 `noImplicitAny` 并修复对应的隐式 any 问题，新增少量模块声明与类型兜底，保证主进程类型检查通过。该阶段不触发渲染端/插件端的全量严格化，仅为后续阶段提供可控基线。

涉及文件：

- `app/tsconfig.main.json`
- `app/types/legacy-modules.d.ts`
- `app/types/native-process-working-directory.d.ts`
- `app/lib/app.ts`
- `app/lib/index.ts`
- `app/lib/lru.ts`
- `app/lib/pluginManager.ts`
- `app/lib/pty.ts`
- `app/lib/sentry.ts`
- `app/lib/urlHandler.ts`
- `app/lib/window.ts`

### 3.63 tabby-core noImplicitAny 阶段落地

为 `tabby-core` 启用 `noImplicitAny`，补齐核心服务/组件/工具内的显式类型与必要的类型兜底，新增模块声明以消除缺失类型依赖。该阶段只针对 `tabby-core`，不影响其它插件的编译策略。

涉及文件：

- `tabby-core/tsconfig.json`
- `tabby-core/types/legacy-modules.d.ts`
- `tabby-core/src/api/selector.ts`
- `tabby-core/src/components/appRoot.component.ts`
- `tabby-core/src/components/safeModeModal.component.ts`
- `tabby-core/src/components/startPage.component.ts`
- `tabby-core/src/components/tabBody.component.ts`
- `tabby-core/src/components/transfersMenu.component.ts`
- `tabby-core/src/directives/fastHtmlBind.directive.ts`
- `tabby-core/src/index.ts`
- `tabby-core/src/services/config.service.ts`
- `tabby-core/src/services/hotkeys.service.ts`
- `tabby-core/src/services/hotkeys.util.ts`
- `tabby-core/src/services/locale.service.ts`
- `tabby-core/src/services/log.service.ts`
- `tabby-core/src/services/profiles.service.ts`
- `tabby-core/src/services/tabRecovery.service.ts`
- `tabby-core/src/services/themes.service.ts`
- `tabby-core/src/services/vault.service.ts`
- `tabby-core/src/utils.ts`

### 3.64 tabby-terminal noImplicitAny 阶段落地

为 `tabby-terminal` 启用 `noImplicitAny`，补齐终端核心组件/前端渲染/中间件/服务的显式类型，同时同步修复 `tabby-settings` 中与终端设置联动的隐式 any。该阶段仍保持范围可控，仅针对 `tabby-terminal` 与其联动的设置面板路径。

涉及文件：

- `tabby-terminal/tsconfig.json`
- `tabby-terminal/types/legacy-modules.d.ts`
- `tabby-terminal/src/api/baseTerminalTab.component.ts`
- `tabby-terminal/src/components/colorSchemeSelector.component.ts`
- `tabby-terminal/src/components/colorSchemeSettingsForMode.component.ts`
- `tabby-terminal/src/components/inputProcessingSettings.component.ts`
- `tabby-terminal/src/components/streamProcessingSettings.component.ts`
- `tabby-terminal/src/components/terminalSettingsTab.component.ts`
- `tabby-terminal/src/features/debug.ts`
- `tabby-terminal/src/features/zmodem.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-terminal/src/middleware/loginScriptProcessing.ts`
- `tabby-terminal/src/services/multifocus.service.ts`
- `tabby-settings/src/components/configSyncSettingsTab.component.ts`
- `tabby-settings/src/components/vaultSettingsTab.component.ts`
- `tabby-settings/src/components/windowSettingsTab.component.ts`
- `tabby-settings/src/components/editProfileModal.component.ts`
- `tabby-settings/src/components/hotkeySettingsTab.component.ts`
- `tabby-settings/src/components/profilesSettingsTab.component.ts`
- `tabby-settings/src/components/releaseNotesTab.component.ts`
- `tabby-settings/src/services/configSync.service.ts`

### 3.65 tabby-ssh noImplicitAny 阶段落地

为 `tabby-ssh` 启用 `noImplicitAny`，补齐 SSH 配置面板、已知主机、端口转发与连接流程中的显式类型，并增加模块声明以覆盖依赖链路中缺失的类型定义。该阶段覆盖 `tabby-ssh` 与其间接依赖的缺失模块声明，保证 SSH 插件路径可独立通过类型检查。

涉及文件：

- `tabby-ssh/tsconfig.json`
- `tabby-ssh/types/legacy-modules.d.ts`
- `tabby-ssh/src/components/sshSettingsTab.component.ts`
- `tabby-ssh/src/services/ssh.service.ts`
- `tabby-ssh/src/services/sshKnownHosts.service.ts`
- `tabby-ssh/src/session/forwards.ts`
- `tabby-ssh/src/session/ssh.ts`

---

## 4. 关键文件索引

以下文件是本阶段最重要的收口点，后续继续优化时应优先从这些位置接续：

- `app/src/bridge.preload.ts`
- `app/src/tabby-bridge.ts`
- `app/src/plugins.ts`
- `app/lib/app.ts`
- `app/lib/pty.ts`
- `app/lib/window.ts`
- `app/src/entry.ts`
- `tabby-core/src/api/rendererRuntime.ts`
- `tabby-core/src/api/runtimeEnv.ts`
- `tabby-core/src/base64.ts`
- `tabby-local/src/session.ts`
- `tabby-electron/src/pty.ts`
- `tabby-ai-assistant/src/services/core/file-storage.service.ts`

---

## 5. 已验证内容

本阶段已经多轮执行以下构建与冒烟验证：

### 5.1 构建验证

已通过的构建包括：

```bash
./node_modules/.bin/webpack --config tabby-local/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-electron/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
./node_modules/.bin/webpack --config app/webpack.config.mjs --mode=production
```

其中，`tabby-ai-assistant` 在本轮新增安全补丁、按钮规范化、监听清理和异步任务轮询修正后又额外重新构建验证了多次，结果均通过；当前仅剩既有 Sass `@import` deprecation warning。

在本轮继续清理 `toPromise()` 与补齐聊天界面 timeout 托管后，又额外通过了以下受影响模块的重新构建：

```bash
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-electron/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- 全部构建通过
- 没有新增 TypeScript / Webpack 级错误
- 仍仅保留既有 Sass `@import` / 内建函数弃用 warning

在继续完成设置页零散 timeout 清理和 `tabby-core` directive 生命周期收口后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果同样稳定：

- 两个模块均构建通过
- 没有新增模板错误、类型错误或打包错误
- 仍仅保留既有 Sass 弃用 warning

在继续完成 `ToastService` 与 `tabContextMenu` 的微收口后，再次重新验证了同样的两个模块：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果保持一致：

- 两个模块均构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误
- 仍仅保留既有 Sass 弃用 warning

在继续完成 `TabHeaderComponent` / `SelectorModalComponent` 的零散延迟回调清理后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果：

- `tabby-core` 构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在继续完成 `fastHtmlBind` 事件收口与聚焦延迟统一后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- 两个模块均构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在修复 StartPage 的 `NG0100` 复发表现后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果保持一致：

- `tabby-core` 构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在收口 RecoveryProvider 抽象后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-local/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- `tabby-local` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 Hotkeys/App/Vault 的零散清理后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果保持一致：

- `tabby-core` 构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在收口 SSH Tab 的 timeout 托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 SSH Session 延迟销毁托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在清理 SFTP 本地编辑轮询启动定时器后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-electron/webpack.config.mjs --mode=production
```

结果：

- `tabby-electron` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 SSH 目录探测轮询中止条件后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 SSH Ready Timeout 销毁中止后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在清理 Window 定时器托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
```

结果：

- `app` 主进程构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 AppRoot 延迟回调托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果保持一致：

- `tabby-core` 构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在清理插件加载延迟托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config app/webpack.config.mjs --mode=production
```

结果：

- `app` 渲染端构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 PTY 延迟等待 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
```

结果：

- `app` 主进程构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐托盘点击延迟 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
```

结果：

- `app` 主进程构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 Window 定时器 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
```

结果：

- `app` 主进程构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 PathDrop 延迟回调 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-electron/webpack.config.mjs --mode=production
```

结果：

- `tabby-electron` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 ConfigService init 延迟 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
```

结果保持一致：

- `tabby-core` 构建通过
- 没有新增类型错误或模板错误
- 仍仅保留既有 Sass 弃用 warning

在补齐 BaseTerminalTab 延迟回调托管后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
```

结果：

- `tabby-terminal` 构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 Terminal 延迟回调 unref 后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
```

结果：

- `tabby-terminal` 构建通过
- 没有新增 TypeScript / Webpack 错误

在补齐 SSH Ready Timeout 订阅清理后，又重新执行了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在继续完成 `setImmediate` 收口后，又额外重新验证了以下构建：

```bash
./node_modules/.bin/webpack --config tabby-core/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-electron/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config app/webpack.config.main.mjs --mode=production
```

结果：

- 四个模块均构建通过
- `tabby-core` 仍仅保留既有 Sass 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 `tabby-local` 优雅退出延迟 `unref` 后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-local/webpack.config.mjs --mode=production
```

结果：

- `tabby-local` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在修正 `SerialTab` 延迟创建与 `tabby-terminal` `unref` 类型兼容问题后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-terminal/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-serial/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
```

结果：

- 三个模块均构建通过
- `tabby-serial` 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在修复设置按钮空引用问题后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
```

结果：

- `tabby-settings` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 Serial 启动延迟托管与 EditProfileModal 延迟清理后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-serial/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
```

结果：

- 两个模块均构建通过
- `tabby-serial` 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 MCP SSE 重连定时器清理后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 AsyncTaskManager 延迟启动托管后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 ConfigSync 自动同步可取消与 MCP HTTP 轮询 sleep 可取消后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-settings/webpack.config.mjs --mode=production
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- 两个模块均构建通过
- `tabby-ai-assistant` 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 TerminalManager 延迟等待托管后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 Provider Stream Reader 清理后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 AiAssistantService 刷新定时器清理后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 BaseAiProvider 退避 sleep 与 AiAssistantModule 延迟托管后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 TerminalTools 延迟等待托管后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 BaseAiProvider 退避 sleep 句柄托管后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 BaseAiProvider/AiAssistantModule 延迟 `unref` 后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ai-assistant/webpack.config.mjs --mode=production
```

结果：

- `tabby-ai-assistant` 构建通过
- 仍仅保留既有 Sass `@import` 弃用 warning
- 没有新增 TypeScript / 模板 / Webpack 错误

在补齐 SSH 目录探测短轮询可取消后，又额外重新验证了：

```bash
./node_modules/.bin/webpack --config tabby-ssh/webpack.config.mjs --mode=production
```

结果：

- `tabby-ssh` 构建通过
- 没有新增 TypeScript / 模板 / Webpack 错误

在执行全量 webpack 构建 sweep 时，首次使用默认内存触发 Node.js 堆内存不足（OOM），随后提升内存上限重新执行成功：

```bash
./node_modules/.bin/webpack --config webpack.config.mjs --mode=production
env NODE_OPTIONS=--max_old_space_size=8192 ./node_modules/.bin/webpack --config webpack.config.mjs --mode=production
```

结果：

- 全量 multi-compiler 构建通过（覆盖 app renderer/main 与所有 `tabby-*` 模块）
- 仍仅保留既有 Sass `@import` / 内建函数弃用 warning（`tabby-core` 主题、`ngx-toastr`、`tabby-serial`/`tabby-telnet`、`tabby-ai-assistant`）
- 未出现新增 TypeScript / 模板 / Webpack 错误

在引入 filesystem cache 与性能预算后，再次执行全量构建验证：

```bash
env NODE_OPTIONS=--max_old_space_size=8192 ./node_modules/.bin/webpack --config webpack.config.mjs --mode=production
```

结果：

- 全量 multi-compiler 构建通过
- 新增 webpack cache 解析提示：根 `webpack.config.mjs` 使用动态 `import(x)`，导致 buildDependencies 解析警告（不阻塞构建）
- 新增 cache 序列化大字符串提示（不阻塞构建）
- 仍保留既有 Sass `@import` / 内建函数弃用 warning

在启用主进程 `noImplicitAny` 后，补充运行类型检查：

```bash
./node_modules/.bin/tsc -p app/tsconfig.main.json --noEmit
```

结果：

- 主进程类型检查通过（noImplicitAny 已开启）

在启用 `tabby-core` 的 `noImplicitAny` 后，补充运行类型检查：

```bash
./node_modules/.bin/tsc -p tabby-core/tsconfig.json --noEmit
```

结果：

- `tabby-core` 类型检查通过（noImplicitAny 已开启）

在启用 `tabby-terminal` 的 `noImplicitAny` 后，补充运行类型检查：

```bash
./node_modules/.bin/tsc -p tabby-terminal/tsconfig.json --noEmit
```

结果：

- `tabby-terminal` 类型检查通过（noImplicitAny 已开启）

在启用 `tabby-ssh` 的 `noImplicitAny` 后，补充运行类型检查：

```bash
./node_modules/.bin/tsc -p tabby-ssh/tsconfig.json --noEmit
```

结果：

- `tabby-ssh` 类型检查通过（noImplicitAny 已开启）

### 5.2 启动冒烟

已多轮通过：

```bash
timeout 15s env TABBY_DEV=1 ./node_modules/.bin/electron app -d --no-sandbox --disable-dev-shm-usage
timeout 18s env TABBY_DEV=1 ./node_modules/.bin/electron app -d --no-sandbox --disable-dev-shm-usage
```

本轮新增补丁后再次执行 `timeout 18s env TABBY_DEV=1 ./node_modules/.bin/electron app -d --no-sandbox --disable-dev-shm-usage`，仍可完成：

- builtin plugin pinning
- 插件发现与加载
- AI Assistant 模块加载
- `AI Assistant initialized successfully`

日志中仍可见的内容主要是：

- Electron 开发态 CSP warning（既有，源于当前 JIT / `unsafe-eval` 兼容约束）
- Linux 桌面环境相关 `xdg-settings` / GTK / DBus 噪音
- `timeout` 结束进程后的 `SIGTERM`

这些都不是本轮新增回归。

另外，本轮修复 `AppRootComponent` 初始化时序后再次执行同样的 18 秒冒烟，启动日志中不再出现：

- `AppRootComponent` 的 `NG0100 ExpressionChangedAfterItHasBeenCheckedError`

在继续完成 `ChatInterfaceComponent`、`AiSidebarComponent` 的 timeout 托管，以及非 `other/` 目录 `toPromise()` 清理后，再次执行同样的 18 秒冒烟，结果仍然保持稳定：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`
- 启动日志中没有新增 `chat-interface` / `ai-sidebar` / `toPromise` 相关运行时错误

在继续补齐 `ChatInputComponent`、`MCPSettingsComponent`、本地 Provider 状态探测 timeout 清理，以及 `tabby-core` directive 生命周期收口后，再次执行同样的 18 秒冒烟，结果依然稳定：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`
- 启动日志中没有新增 `chat-input` / `mcp-settings` / `directive` 相关运行时错误

在继续完成 `ToastService` 与通知点击回调的微收口后，再次执行同样的 18 秒冒烟，结果依旧稳定：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`
- 启动日志中没有新增 `toast` / `notification` / `tabContextMenu` 相关运行时错误

在继续完成 `tabHeader` / `selectorModal` 的延迟回调清理后，再次执行同样的 18 秒冒烟，结果同样稳定：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`
- 启动日志中没有新增 `tabHeader` / `selectorModal` 相关运行时错误

在继续完成 `fastHtmlBind` / 聚焦延迟统一后，再次执行 18 秒冒烟已恢复通过（运行环境锁文件冲突已清理），整体日志仍然稳定：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`

本轮再次执行同样的 18 秒冒烟时，启动在早期就因锁文件权限失败而中断：

- `/home/hoping/.config/tabby/SingletonLock: Permission denied (13)`
- `xdg-settings` 报错仍为环境噪音

该问题属于运行环境权限/锁文件状态，不是本轮代码变更引入的问题。

在沙箱外重新执行同样的 18 秒冒烟后，启动链路恢复通过，关键日志包含：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `AI Assistant initialized successfully`

仍可见的环境告警包括：

- `xdg-settings` 相关报错
- `GLib-GObject` / `GTK` 主题解析警告
- systemd scope `UnitExists` 提示
- Electron 开发态 CSP warning

未再出现 `SingletonLock` 权限报错。

补充观察（非阻塞）：

- 偶发 `pty:get-working-directory` 报错 `ENOENT`（进程已退出导致 `/proc/<pid>/cwd` 不存在），不影响启动完成

### 5.3 运行时确认

启动日志已经确认：

- builtin plugin pinning 正常
- 插件发现与加载正常
- `Loaded plugin modules summary` 正常
- `FileStorageService initialized`
- `AI Assistant initialized successfully`

---

## 6. 当前保留的已知风险

以下问题仍然存在，但暂不建议在当前稳定基线上直接处理：

### 6.1 Electron 安全基线仍未完全收紧

仍保留：

- `app/lib/window.ts:102` `nodeIntegration: true`
- `app/lib/window.ts:105` `contextIsolation: false`

原因：

- 插件系统当前仍依赖 renderer 内的 Node/CJS 兼容链路
- 直接关闭这两个开关，高概率导致现有启动链再次失效

### 6.2 CSP 仍需保留 `unsafe-eval`

根因：

- `app/src/entry.ts:57` 使用 `platformBrowserDynamic().bootstrapModule(...)`

这意味着：

- Electron DevTools 仍会给出 Insecure CSP warning
- 在 Angular 启动路径切换到稳定 AOT/非 JIT 前，不适合强行去掉

### 6.3 插件主加载链仍为高风险兼容区

`app/src/plugins.ts` 里的以下逻辑仍属于高风险核心链路：

- `nodeRequire('module')`
- `nodeRequire.resolve(...)`
- `nodeRequire(foundPlugin.path)`
- `Module.prototype.require` 补丁

这部分后续如果要继续改，必须以“插件清单协议 / 加载器重构”作为独立任务推进，而不是继续做零散清理。

### 6.4 环境级与依赖级告警仍存在

当前仍能看到但不阻塞运行的告警：

- Electron CSP warning
- GTK / dbus / xdg-settings 环境告警
- Sass `@import` deprecation warning

这些不属于本阶段引入的新问题。

---

## 7. 建议的后续优先级

如果后续继续推进，建议按以下顺序处理：

1. **中风险但可控的 renderer 全局规范化**
   - 收敛 `window['pluginModules']`
   - 收敛 `window['safeModeReason']`
   - 继续减少非类型化全局挂载

2. **插件加载器外围继续去同步化/去 Node 化**
   - 继续审视 `app/src/plugins.ts` 中外围同步 bridge 调用
   - 但不要直接碰主加载链核心逻辑

3. **独立立项处理高风险问题**
   - 插件清单协议
   - 插件加载器重构
   - Angular 启动路径收口
   - `nodeIntegration/contextIsolation` 安全基线修复

---

## 8. 结论

本阶段已经完成“从应用无法稳定启动，到恢复稳定，再到持续做低风险安全/性能收口”的核心工作。当前最重要的成果不是某一个单点优化，而是建立了一条可持续推进的稳定基线：

- 应用可正常进入
- 插件链可完整加载
- AI Assistant 可正常工作
- renderer 对 Node 的直接依赖面已经明显缩小
- 主进程 PTY 与文件系统桥接能力已经更统一

后续如果继续推进，应避免在当前稳定基线上直接冲击高风险兼容链路，而应转向“单独立项、分阶段替换”的方式处理剩余核心问题。
