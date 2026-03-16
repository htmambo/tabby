# 内存泄漏风险分析报告

**分析时间**: 2026-03-16
**项目**: Tabby Terminal

---

## 1. 执行摘要

| 风险类别 | 发现数量 | 严重程度 |
|---------|---------|---------|
| 未清理的订阅 | 3 处 | 🔴 高 |
| 未清理的定时器 | 1 处 | 🟡 中 |
| 未清理的事件监听 | 2 处 | 🟡 中 |
| 潜在的循环引用 | 1 处 | 🟢 低 |

**整体评估**: 项目内存管理整体良好，但存在少量需要修复的问题。

---

## 2. 高风险问题

### 2.1 订阅未在 ngOnDestroy 中清理 🔴

**问题 1: `tabby-core/src/tabContextMenu.ts:150`**

```typescript
// 第 150 行 - 订阅后未保存引用
this.app.observeTabCompletion(tab).subscribe(() => {
    // ...
})
```

**风险**: 当用户取消勾选"完成时通知"选项时，订阅被正确取消。但如果 Tab 在订阅活跃时被关闭，订阅可能不会被清理。

**修复建议**: 保存订阅引用并在适当时机取消订阅。

---

**问题 2: `tabby-terminal/src/frontends/xtermFrontend.ts:350-356`**

```typescript
// 第 350-356 行 - 事件监听器使用匿名函数
host.addEventListener('dragOver', (event: any) => this.dragOver.next(event))
host.addEventListener('drop', event => this.drop.next(event))
host.addEventListener('mousedown', event => this.mouseEvent.next(event))
host.addEventListener('mouseup', event => this.mouseEvent.next(event))
host.addEventListener('mousewheel', event => this.mouseEvent.next(event as MouseEvent))
host.addEventListener('contextmenu', event => { ... })
```

**风险**: 使用匿名函数添加事件监听器，无法在 `detach()` 中正确移除。

**当前清理代码** (第 370-375 行):
```typescript
detach(_host: HTMLElement): void {
    window.removeEventListener('resize', this.resizeHandler)  // ✅ 可移除
    this.resizeObserver?.disconnect()  // ✅ 可清理
    // ❌ 未移除 host 上的事件监听器
}
```

**修复建议**:
```typescript
// 保存函数引用
private boundDragOver = (event: any) => this.dragOver.next(event)
private boundDrop = (event: DragEvent) => this.drop.next(event)
// ... 其他事件处理函数

// 在 attach 中使用
host.addEventListener('dragOver', this.boundDragOver)

// 在 detach 中移除
host.removeEventListener('dragOver', this.boundDragOver)
```

---

### 2.2 定时器清理不完整 🟡

**问题: `tabby-electron/src/sftpContextMenu.ts:130-144`**

```typescript
pollStartTimeout = window.setTimeout(() => {
    if (stopped) { return }
    pollStartTimeout = null
    pollTimer = window.setInterval(() => {
        void pollForChanges()
    }, 1000)
    // ...
}, 1000)
```

**分析**:
- `pollTimer` 在 `stopWatching()` 中清理 ✅
- `pollStartTimeout` 需要确认是否在所有路径上清理

**风险**: 如果 SFTP 会话异常终止，定时器可能未被清理。

---

## 3. 中等风险问题

### 3.1 ai-sidebar.service.ts 事件监听器

**文件**: `tabby-ai-assistant/src/services/chat/ai-sidebar.service.ts`

**已修复的部分** ✅:
- 第 313-316 行: `window.removeEventListener('resize', ...)`
- 第 278-281 行: `resizeHandle` 事件清理

**潜在问题**:
```typescript
// 第 476-477 行 - 动态添加的文档级监听器
document.addEventListener('mousemove', onMouseMove)
document.addEventListener('mouseup', onMouseUp)
```

**分析**: 这些监听器在 `onMouseUp` 中被移除，但需要确保所有代码路径都能清理。

---

### 3.2 Subject/Observable 未完成

**文件**: `tabby-core/src/services/workspaceLayout.service.ts:7`

```typescript
private royalSidebarTransitionActive = new BehaviorSubject(false)
```

**风险**: BehaviorSubject 如果没有在服务销毁时调用 `complete()`，可能导致订阅者保持引用。

**建议**: 在服务的 `ngOnDestroy` 中调用 `royalSidebarTransitionActive.complete()`。

---

## 4. 低风险问题

### 4.1 潜在的循环引用

**观察**: Angular 服务之间大量使用依赖注入，可能存在循环引用。

**示例模式**:
```
AiAssistantService → TerminalToolsService → TerminalManagerService
       ↑                                              ↓
       └────────────── TerminalContextService ←──────┘
```

**缓解措施**: Angular 的 DI 系统通过单例模式管理生命周期，风险较低。

---

## 5. 良好实践（已实现）

### 5.1 订阅管理 ✅

项目广泛使用 `takeUntil` 模式：
```typescript
// 多处使用 takeUntil 自动取消订阅
takeUntil(this.destroy$),
takeUntil(this.destroyed$),
```

### 5.2 ngOnDestroy 实现 ✅

45+ 个组件和服务实现了 `ngOnDestroy` 进行清理。

### 5.3 清理容器 ✅

`base.component.ts` 提供了 `_subscriptionContainer` 用于统一管理事件监听器。

---

## 6. 修复优先级

| 优先级 | 问题 | 文件 | 行号 |
|--------|------|------|------|
| P0 | 事件监听器无法移除 | xtermFrontend.ts | 350-356 |
| P1 | 订阅未保存引用 | tabContextMenu.ts | 150 |
| P2 | BehaviorSubject 未 complete | workspaceLayout.service.ts | 7 |
| P3 | 定时器清理确认 | sftpContextMenu.ts | 130-144 |

---

## 7. 建议修复代码

### 7.1 xtermFrontend.ts 修复

```typescript
// 在类中添加私有字段保存函数引用
private boundDragOver: (event: any) => void
private boundDrop: (event: DragEvent) => void
private boundMouseDown: (event: MouseEvent) => void
private boundMouseUp: (event: MouseEvent) => void
private boundMouseWheel: (event: WheelEvent) => void
private boundContextMenu: (event: MouseEvent) => void

// 在构造函数中绑定
constructor() {
    this.boundDragOver = (event: any) => this.dragOver.next(event)
    this.boundDrop = (event: DragEvent) => this.drop.next(event)
    // ... 其他绑定
}

// attach 中使用绑定函数
host.addEventListener('dragOver', this.boundDragOver)
// ...

// detach 中移除
host.removeEventListener('dragOver', this.boundDragOver)
// ...
```

---

## 8. 结论

项目内存管理整体良好，主要风险集中在：
1. **xtermFrontend.ts** - 事件监听器使用匿名函数
2. **tabContextMenu.ts** - 订阅未保存引用

建议优先修复 P0 级别问题，以避免长期运行时的内存泄漏。

---

## 9. 测试建议

1. 使用 Chrome DevTools Memory 面板进行堆快照对比
2. 测试场景：
   - 打开/关闭终端 Tab 多次
   - 反复开启/关闭 AI 侧边栏
   - 长时间运行后检查内存趋势
3. 使用 `WeakRef` 和 `FinalizationRegistry` 监控对象回收