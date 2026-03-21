# Tabby 性能与速度审查报告（2026-03-21）

## 审查范围

本次审查聚焦四类问题：

1. 发布包体和冷启动成本
2. 运行时卡顿与恢复链路
3. 插件启动路径
4. 本地构建速度

本次未做 UI 交互级 profiler 录制，结论基于当前仓库代码、现有产物和一次本地构建基线。

## 基线

### 构建与产物

- `time node scripts/build-modules.mjs`：`47.881s total`，`185% cpu`
- `app/dist`：约 `32 MB`
- `app/dist/bundle.js`：`4,135,423` bytes
- `app/dist/bundle.js.map`：`11,208,463` bytes
- `app/dist/main.js`：`300,619` bytes
- `app/dist/main.js.map`：`1,179,480` bytes
- `app/dist/preload.js`：`427,276` bytes
- `app/dist/preload.js.map`：`625,730` bytes
- `app/dist` 中字体文件：`107` 个，合计约 `14.38 MB`
- `app/dist` 中 source map：`5` 个，合计约 `12.42 MB`

### 代码结构

- 生产构建涉及 `15` 份 webpack 配置
  - `app` 主进程 1 个
  - `app` renderer 1 个
  - 内置插件 `13` 个

## 结论摘要

当前项目最值得优先处理的，不是“终端本身不够快”，而是以下四个系统性成本：

1. 发布构建仍然偏向调试配置，导致包体、解析成本和构建时长偏高
2. 标签恢复链路会频繁序列化完整终端状态，存在明显的主线程压力
3. 启动前会发现并加载全部插件，再去构造根模块，冷启动路径过长
4. 字体与图标资源占比过大，且图标搜索数据在设置模块中被提前展开

## 优先级建议

### P0. 收紧生产构建配置

**证据**

- `app/webpack.config.mjs` 中生产模式仍然 `minimize: false`，并且固定 `devtool: 'source-map'`
- `app/webpack.config.main.mjs` 同样固定 `devtool: 'source-map'`
- `webpack.plugin.config.mjs` 对插件构建也固定 `minimize: false`，并通过 `SourceMapDevToolPlugin` 产出 source map

**影响**

- 增大发布包体
- 增加 renderer/main/preload 的解析与加载成本
- 放大 CI 与本地生产构建时间

**建议**

1. 生产模式开启 `minimize`
2. 生产默认关闭公开 source map，改成 `hidden-source-map` 或仅在 CI 发布时开启
3. 把 source map 产出从“默认开启”改成“按环境开启”
4. 为 `bundle.js` / `preload.js` / `main.js` 增加体积预算

**预估收益**

- 高影响
- 低到中等实施成本

### P0. 把标签恢复从“全量快照”改成“脏数据、限流、限体积”

**证据**

- `tabby-core/src/services/app.service.ts` 会在 `tabsChanged$`、`activeTabChange$`、每个 tab 的 `recoveryStateChangedHint$`、以及 30 秒定时器上触发恢复保存
- 上述信号经过 `debounceTime(1000)` 后调用 `tabRecovery.saveTabs(this.tabs, this.activeTab)`
- `tabby-core/src/services/tabRecovery.service.ts` 的 `saveTabs()` 会遍历全部 tabs，为每个 tab 获取完整 recovery token，再做 `JSON.stringify(serializedTabs)` 写入 `localStorage`
- `tabby-terminal/src/frontends/xtermFrontend.ts` 的 `saveState()` 会通过 `serializeAddon.serialize()` 序列化 scrollback
- `tabby-terminal/src/config.ts` 默认 `recoveryScrollbackLines` 为 `2000`
- 虽然 `closeTab()` 已经把“最近关闭标签恢复”降到 `200` 行并加了 `256 KB` 上限，但周期性 `saveTabs()` 仍然是全量路径

**影响**

- 活跃终端较多或输出较大时，容易在主线程上形成周期性卡顿
- 窗口关闭、切换活动标签、某些 tab 状态变更时会重复做昂贵序列化

**建议**

1. 只保存“脏 tab”，不要每次重写所有 tabs
2. 对周期性保存使用 `requestIdleCallback` 或后台任务队列
3. 为周期性保存单独设置更小的 scrollback 上限
4. 将“窗口恢复”与“最近关闭标签恢复”彻底拆成两条不同策略
5. 对 unchanged token 做哈希/版本比较，未变化则跳过 `localStorage.setItem`

**预估收益**

- 高影响
- 中等实施成本

### P0. 缩短启动关键路径，避免“先加载所有插件，再看到界面”

**证据**

- `app/src/entry.ts` 在启动时先执行 `initModuleLookup()`、`findPlugins()`、`loadPlugins()`，之后才 `bootstrapModule()`
- `app/src/app.module.ts` 把 `...plugins` 全部塞进根模块 `imports`
- `app/src/plugins.ts` 会扫描 lookup paths、读取候选 `package.json`，然后对找到的插件逐个 `nodeRequire`

**影响**

- 冷启动路径被“查找插件 + 读取包信息 + require 插件 + 组装根模块”串在一起
- AI assistant、plugin manager、settings 等非首屏关键模块，也会在首屏前进入启动链

**建议**

1. 生产模式优先使用“已知内置插件清单”，不要扫描全部 `globalPaths`
2. 用户插件扫描仅针对用户插件目录
3. 区分“首屏必需插件”和“延后加载插件”
4. 把非首屏功能模块改成启动后异步装载
5. 为插件发现结果增加缓存，只有插件目录变更时才重扫

**预估收益**

- 高影响
- 中高实施成本

### P1. 收缩字体与图标资源

**证据**

- `app/src/entry.preload.ts` 全量引入了 `source-sans-pro`、`source-code-pro` 和 Font Awesome 的 `solid`、`brands`、`regular`、`fontawesome` 四套 CSS
- 当前 `app/dist` 中字体文件 `107` 个，合计约 `14.38 MB`
- `tabby-settings/src/components/editProfileModal.component.ts` 在模块加载时直接读取 `tabby-core/src/icons.json`，并把 `1970` 个图标展开成 `2141` 个 class 组合

**影响**

- 资源体积偏大
- 设置相关模块加载时会立即创建大批字符串数组

**建议**

1. 基于 `icons.json` 生成图标字体子集，而不是直接带整套 Font Awesome
2. 将图标搜索列表改成按需生成
3. 仅在打开设置或图标选择时再加载图标搜索数据
4. 评估把少量高频图标切到 SVG/inline 方案

**预估收益**

- 中高影响
- 中等实施成本

### P1. 提升本地与 CI 构建吞吐

**证据**

- `scripts/build-modules.mjs` 对 `15` 份 webpack 配置使用 `for ... of` 串行构建
- 实测整套构建 `47.881s total`，但 CPU 仅 `185%`，说明还有明显并行空间
- `package.json` 的 `watch` 脚本显式设置了 `TABBY_DISABLE_CACHE=1`
- 与此同时，`app/webpack.config.mjs`、`app/webpack.config.main.mjs`、`webpack.plugin.config.mjs` 都已经实现了 filesystem cache
- `webpack.plugin.config.mjs` 还在插件构建中保留了 `source-map-loader` 预处理步骤

**影响**

- 生产构建和调试迭代都比可达到的速度更慢

**建议**

1. 把生产构建改为 webpack multi-compiler 或受控并行
2. 默认恢复 watch cache，把关闭缓存变成显式兜底开关，而不是默认路径
3. 只在需要排查三方 sourcemap 时启用 `source-map-loader`
4. 给 `TABBY_FAST_BUILD` 扩展到更多配置，而不只 main process

**预估收益**

- 中高影响
- 低到中等实施成本

### P2. 默认终端渲染策略过于激进

**证据**

- `tabby-terminal/src/config.ts` 默认 frontend 为 `xterm-webgl`
- 同文件默认 `sixel: true`
- `tabby-terminal/src/api/baseTerminalTab.component.ts` 会优先实例化 `XTermWebGLFrontend`
- `tabby-terminal/src/frontends/xtermFrontend.ts` 会根据配置加载 `ImageAddon`、`WebglAddon` 或 `CanvasAddon`

**影响**

- 在弱 GPU、远程桌面、驱动兼容性差的环境下，更容易触发渲染初始化成本和兼容性回退

**建议**

1. 默认回到 `xterm` / canvas 路径
2. 把 WebGL 改成 capability-based auto enable
3. 把 sixel 设为按需开启，或至少延迟到首次检测到图像序列时再加载

**预估收益**

- 中等影响
- 中等实施成本

### P3. 长期方向：把 JIT 从启动热路径中移出去

**证据**

- `app/webpack.config.mjs` 和 `webpack.plugin.config.mjs` 都启用了 `AngularWebpackPlugin(... jitMode: true )`
- `app/src/entry.ts` 使用 `platformBrowserDynamic().bootstrapModule(module)`
- 当前插件模型要求运行时把插件模块拼进根模块

**影响**

- 启动链路需要保留更重的 Angular 运行时能力
- 对包体和首屏时间都不友好

**建议**

- 在插件 manifest / 加载协议稳定后，规划 AOT-compatible 插件注册方式
- 先把“首屏壳”和“延后插件模块”拆开，再评估彻底迁移

**预估收益**

- 高影响
- 高实施成本

## 建议落地顺序

### 第一阶段（1-3 天）

1. 收紧生产构建参数
2. 恢复 watch cache
3. 增加 bundle size / build time 基线

### 第二阶段（2-5 天）

1. 重构 tab recovery 的保存策略
2. 限制周期性快照体积
3. 拆分窗口恢复与关闭标签恢复

### 第三阶段（1-2 周）

1. 插件发现结果缓存
2. 非关键插件延后加载
3. 字体/图标子集化

### 第四阶段（单独立项）

1. JIT -> AOT 路线设计
2. 插件协议进一步稳定化

## 本次审查的限制

1. 没有做 Electron 启动 profiler 录制，所以“冷启动收益”是代码与产物推断，不是实机火焰图结论
2. 没有采集多平台数据，GPU 相关建议需要在 Windows/macOS 上分别验证
3. 本次没有实施改动，因此所有收益都是工程预估，不是回归数据

## 结论

如果只做一轮低风险优化，最值得先做的是：

1. 生产构建去调试化
2. recovery 保存改成增量和限流
3. 插件启动路径去全量预加载

这三项会同时改善发布体积、冷启动和运行时卡顿，而且不要求立刻推翻现有插件架构。
