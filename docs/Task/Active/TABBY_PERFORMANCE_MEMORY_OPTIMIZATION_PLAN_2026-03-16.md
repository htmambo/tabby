# Tabby 性能与内存问题实施方案（2026-03-16）

**状态**: 🔄 待执行  
**优先级**: P0  
**负责人**: AI Assistant + 用户  
**关联分析**: `docs/Task/Active/TABBY_PERFORMANCE_MEMORY_REVIEW_2026-03-16.md`

---

## 1. 目标

本方案的目标不是“做一次大重构”，而是在不破坏现有功能的前提下，优先解决以下高影响问题：

1. 缩短冷启动与窗口恢复时间
2. 消除关闭大输出终端后的明显卡顿
3. 避免 SSH 关闭后资源释放不完整导致的重连变慢
4. 收敛可确认的内存泄漏风险
5. 为后续更大规模的架构优化建立量化基线

---

## 2. 实施原则

### 2.1 先测量，再收敛

所有改动先建立基线，再做最小范围修改，避免“感觉变快了但没有证据”。

### 2.2 先处理高收益、低耦合项

优先顺序应当是：

1. 构建参数
2. recovery snapshot
3. SSH 关闭链路
4. Angular 渲染边界
5. 插件启动链

### 2.3 一次只收敛一类风险

不要把“性能优化”“内存泄漏修复”“插件系统重构”混在一个大提交里。

---

## 3. 分阶段实施计划

## 阶段 0：建立量化基线（P0，0.5-1 天）

### 目标

把后续优化变成“可验证”的，而不是纯主观体感。

### 具体操作

1. 记录当前构建产物大小
   - 目标文件：
     - `app/dist/bundle.js`
     - `app/dist/bundle.js.map`
     - `app/dist/main.js`
     - `app/dist/preload.js`

2. 记录当前冷启动指标
   - 从进程启动到主窗口可交互的时间
   - 从 `ipc.send('ready')` 到 `app.emitReady()` 的时间

3. 记录 SSH 大输出复现场景
   - 建立测试命令，例如：
     - `cat /var/log/large.log`
     - `yes test | head -n 500000`
   - 记录：
     - 输出期间 UI 卡顿程度
     - 关闭标签耗时
     - 同 profile 重新连接耗时

4. 记录内存基线
   - 空闲状态 heap
   - 打开 5-10 个标签后的 heap
   - 关闭问题 SSH 标签后的 heap 变化

### 验收标准

- 有一份基线表格
- 能复现 SSH 大输出关闭卡顿场景
- 能拿到至少一组可对比数据

---

## 阶段 1：构建与关闭路径止血（P0，1-2 天）

## 任务 1.1：收敛生产构建参数

### 目标

减少 release 包体积、解析开销和首屏执行成本。

### 目标文件

- `app/webpack.config.mjs`
- `app/webpack.config.main.mjs`

### 具体改动

1. renderer 生产模式下恢复正常优化
   - 打开 `minimize`
   - 打开 `concatenateModules`
   - 关闭 `pathinfo`

2. main / preload 构建关闭 `pathinfo`

3. source map 策略调整
   - release 默认改为 `hidden-source-map` 或按发布环境开关控制

### 验收标准

- `bundle.js` 体积显著下降
- 冷启动时间下降
- 功能不回归

### 风险

- 发布排障成本上升

### 缓解措施

- 为 CI 发布保留可选 source map
- 本地调试继续保留 dev source map

---

## 任务 1.2：减轻关闭标签时的 recovery snapshot 负担

### 目标

避免“大输出终端关闭时 UI 明显冻结”。

### 目标文件

- `tabby-core/src/services/app.service.ts`
- `tabby-core/src/services/tabRecovery.service.ts`
- `tabby-terminal/src/api/connectableTerminalTab.component.ts`
- `tabby-terminal/src/frontends/xtermFrontend.ts`
- `tabby-local/src/components/terminalTab.component.ts`

### 具体改动

1. 把关闭标签时的 `includeState: true` 改成条件化
   - 默认不为所有关闭标签保存完整 scrollback
   - 只对需要“重新打开关闭标签”功能的场景保留轻量 token

2. 给 `savedState` 增加大小/行数上限
   - 超过阈值时只保留必要元信息，不保留完整 buffer

3. 区分“窗口恢复”和“最近关闭标签恢复”
   - 窗口恢复可以保留更完整状态
   - 单标签关闭恢复应使用轻量快照

4. 对 `closedTabsStack` 中的 token 做体积保护
   - 超大 token 不入栈

### 验收标准

- 关闭大输出标签时主线程卡顿显著下降
- 最近关闭标签恢复功能仍可用
- 正常小输出终端恢复体验不明显退化

### 风险

- 恢复标签时历史输出减少

### 缓解措施

- 只对超大输出场景降级
- 在设置项中提供开关或阈值

---

## 阶段 2：SSH 关闭链路修复（P0，1-2 天）

## 任务 2.1：显式关闭 shell channel，避免复用会话残留

### 目标

解决“标签关了，但底层 shell 还在跑”的风险。

### 目标文件

- `tabby-ssh/src/session/shell.ts`
- `tabby-ssh/src/session/ssh.ts`

### 具体改动

1. 在 `SSHShellSession.destroy()` 中显式关闭 `shell`
   - 先尝试发送 EOF / close
   - 再进入 `super.destroy()`

2. 为 `shell.data$ / eof$ / closed$` 订阅增加统一释放容器

3. 为 `ssh.serviceMessage$ / ssh.willDestroy$` 订阅增加统一释放容器

4. 明确区分：
   - shell 通道销毁
   - 底层 SSH 连接销毁

### 验收标准

- 关闭 SSH 标签后远端 shell 不再继续输出
- 不再出现关闭后持续卡顿的长尾
- 同 profile 重连耗时恢复正常

### 风险

- 影响现有 `reuseSession` 行为

### 缓解措施

- 先只关闭 shell channel，不立即销毁底层 `SSHSession`
- 保持 multiplexer 逻辑不变

---

## 任务 2.2：梳理关闭时序，避免 UI 先消失而资源还在后台收尾

### 目标

降低“刚关闭又重连”场景的资源竞争。

### 目标文件

- `tabby-core/src/services/app.service.ts`
- `tabby-terminal/src/api/baseTerminalTab.component.ts`

### 具体改动

1. 评估 `closeTab()` 是否需要支持等待异步销毁完成

2. 至少保证以下两点之一：
   - 关闭完成前不允许复用旧 SSH session
   - 或在旧 session teardown 未完成前拒绝复用

3. 为 SSH tab 关闭添加更明确的 teardown 状态

### 验收标准

- 关闭问题 SSH 标签后立即重连，不再出现明显额外等待

---

## 任务 2.3：为 SSH 问题场景增加临时缓解开关

### 目标

在彻底修复前，先提供用户可用的风险规避手段。

### 目标文件

- `tabby-ssh/src/profiles.ts`
- `tabby-ssh/src/components/sshProfileSettings.component.pug`

### 具体改动

1. 在文档中明确建议大输出场景可关闭 `reuseSession`

2. 评估是否提供更保守的默认策略
   - 对新配置默认关闭复用
   - 或在检测到异常关闭后短时间禁用复用

### 验收标准

- 用户有明确的规避路径
- 复用策略可被快速对照验证

---

## 阶段 3：运行时渲染与输出优化（P1，2-4 天）

## 任务 3.1：拆分 `AppRootComponent` 的变更检测边界

### 目标文件

- `tabby-core/src/components/appRoot.component.ts`
- `tabby-core/src/components/appRoot.component.pug`

### 具体改动

1. 把 Royal sidebar 抽成独立子组件
2. 新子组件使用 `OnPush`
3. `window:mousemove` 拖拽过程放到 `runOutsideAngular`
4. 分组数据改为输入数据变化时再重算

### 验收标准

- 多标签下切换 active tab 时 UI 更平滑
- 侧边栏拖拽期间主线程占用下降

---

## 任务 3.2：优化 Chat 界面的流式渲染

### 目标文件

- `tabby-ai-assistant/src/components/chat/chat-interface.component.ts`
- `tabby-ai-assistant/src/components/chat/chat-interface.component.html`

### 具体改动

1. 改为 `OnPush`
2. 消息列表增加 `trackBy`
3. 日期分组与时间格式化提前计算为 view model
4. 减少 `AfterViewChecked` 驱动的滚动逻辑
5. 高频 token 更新使用更小的 UI 刷新批次

### 验收标准

- 长会话流式响应不再明显随消息数增长变卡

---

## 任务 3.3：终端输出写入 batching

### 目标文件

- `tabby-terminal/src/session.ts`
- `tabby-terminal/src/api/baseTerminalTab.component.ts`

### 具体改动

1. 为 session 输出增加短窗口合并
   - 例如 `8-16ms` 或单帧内合并

2. 合并后再写给 frontend

3. 进度检测逻辑改为对合并块执行，而不是每个小 chunk 都执行

### 验收标准

- 大量小块输出时 CPU 占用下降
- `cat` / `tail -f` / 构建日志输出时 UI 更稳定

---

## 阶段 4：插件启动链优化（P1-P2，3-5 天）

## 任务 4.1：把启动拆成“核心壳先起，插件后补”

### 目标文件

- `app/src/entry.ts`
- `app/src/plugins.ts`
- `app/src/app.module.ts`

### 具体改动

1. 把首屏必须插件与非必须插件分层
2. 先启动核心模块，再后台加载非关键插件
3. AI Assistant、插件管理、部分设置页支持延迟激活

### 验收标准

- 首屏可交互时间明显改善
- 插件仍可正常加载

### 风险

- 启动顺序变化可能影响插件初始化假设

### 缓解措施

- 先从最不关键的插件开始延迟化

---

## 阶段 5：内存泄漏与 transport 收口（P1，1-2 天）

## 任务 5.1：修复 HTTP MCP transport 的 `pendingRequests`

### 目标文件

- `tabby-ai-assistant/src/services/mcp/transports/http-transport.ts`

### 具体改动

1. 成功响应后从 `pendingRequests` 删除
2. 确保 Promise 在成功路径显式 `resolve`
3. 补单测或最小验证脚本

### 验收标准

- 多次请求后 `pendingRequests.size` 不再增长

---

## 任务 5.2：补齐资源释放回归检查

### 目标文件

- `tabby-ssh/src/session/shell.ts`
- `tabby-ssh/src/session/ssh.ts`
- `tabby-ai-assistant/src/services/mcp/transports/http-transport.ts`

### 具体改动

1. 为高风险对象加最小生命周期日志
2. 记录：
   - shell open / close
   - SSHSession ref / unref
   - multiplexer add / remove
   - transport pendingRequests size

### 验收标准

- 复现场景时能确认对象是否真正释放

---

## 4. 建议实施顺序

建议按以下顺序推进，不建议并行大面积改动：

1. 阶段 0：建立基线
2. 任务 1.1：收敛生产构建
3. 任务 1.2：减轻 recovery snapshot
4. 任务 2.1：显式关闭 SSH shell channel
5. 任务 2.2：梳理关闭与重连时序
6. 任务 3.3：终端输出 batching
7. 任务 3.1 / 3.2：UI 变更检测边界优化
8. 任务 4.1：插件启动链拆分
9. 任务 5.1：HTTP transport 泄漏修复

---

## 5. 验收指标

## 性能指标

1. `bundle.js` 体积明显下降
2. 冷启动时间下降
3. 大输出 SSH 标签关闭时主线程冻结时间明显下降
4. 同 profile SSH 重连恢复到接近正常水平
5. 长聊天会话的流式响应保持平稳

## 内存指标

1. 关闭超大输出标签后 heap 能回落
2. 同一场景重复 5 次后 heap 不持续抬升
3. `pendingRequests`、multiplexer session、shell channel 不出现无界增长

---

## 6. 风险与回滚

### 高风险项

1. SSH shell/channel 关闭逻辑
2. 插件启动顺序调整
3. recovery snapshot 策略变化

### 回滚策略

1. 每个阶段单独提交
2. 先保留旧路径的 feature flag 或条件分支
3. 先做最小范围收敛，再考虑默认策略切换

---

## 7. 专门针对用户 SSH 症状的快速验证矩阵

建议实施时用同一台测试机做以下对照：

### 场景 A：当前行为

- `reuseSession = true`
- `recoverTabs = true`

### 场景 B：关闭复用

- `reuseSession = false`
- `recoverTabs = true`

### 场景 C：关闭恢复状态

- `reuseSession = true`
- `recoverTabs = false`

### 场景 D：两者都关闭

- `reuseSession = false`
- `recoverTabs = false`

### 观察点

1. 超大输出时 UI 卡顿程度
2. 关闭标签耗时
3. 关闭后 CPU 是否持续高
4. 重新连接同一主机耗时

如果：

- 关闭 `recoverTabs` 后卡顿大幅下降，说明 recovery snapshot 是主因之一
- 关闭 `reuseSession` 后重连明显恢复，说明 SSH 复用与资源释放是主因之一

---

## 8. 最终建议

如果只能先做三件事，建议优先落这三项：

1. **收敛 release 构建参数**
2. **限制关闭标签时的终端状态快照**
3. **让 `SSHShellSession.destroy()` 真正关闭 shell channel 并释放订阅**

这三项的收益最大，也最能直接回应当前最痛的用户体验问题。
