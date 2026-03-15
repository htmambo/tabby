# 代码质量改进总结

**日期:** 2026-03-15
**分支:** refactor/remove-split-feature
**提交:** 56e2195c, 8f6cca02

---

## 概述

本次优化主要针对 Tabby 终端模拟器及其 AI 助手插件，重点解决两个核心问题：
1. **安全性问题** - 防止 XSS 攻击和敏感信息泄露
2. **内存泄漏问题** - 确保组件销毁时正确释放资源

---

## 一、安全性改进 (56e2195c)

### 1.1 为什么要做

AI 助手插件存在多处安全漏洞：

| 问题 | 风险等级 | 潜在危害 |
|------|----------|----------|
| Markdown 内容未消毒 | 高 | XSS 攻击，恶意脚本执行 |
| innerHTML 用于用户输入 | 高 | HTML 注入攻击 |
| CSS 注入使用 innerHTML | 中 | 样式篡改，界面欺骗 |

### 1.2 具体修改

#### 1.2.1 DOMPurify 集成 - Markdown 内容消毒

**文件:** `tabby-ai-assistant/src/components/chat/ai-sidebar.component.ts`

```typescript
// 引入 DOMPurify 库
import DOMPurify from 'dompurify'

// 在渲染 Markdown 前进行消毒
const sanitizedHtml = DOMPurify.sanitize(marked.parse(content))
```

**原因:** AI 返回的 Markdown 内容可能包含恶意脚本，直接渲染会导致 XSS 攻击。

#### 1.2.2 Toast 服务 - 使用 textContent 替代 innerHTML

**文件:** `tabby-ai-assistant/src/services/core/toast.service.ts`

```typescript
// 修改前
element.innerHTML = message

// 修改后
element.textContent = message
```

**原因:** Toast 消息可能包含用户输入或错误信息，使用 innerHTML 会导致 HTML 注入。

#### 1.2.3 主题服务 - CSS 注入安全化

**文件:** `tabby-core/src/services/themes.service.ts`

```typescript
// 修改前
styleElement.innerHTML = css

// 修改后
styleElement.textContent = css
```

**原因:** 自定义 CSS 可能被恶意利用，使用 textContent 可防止注入攻击。

#### 1.2.4 SSH 会话流处理 - 订阅清理

**文件:** `tabby-ssh/src/session/ssh.ts`

添加了 `takeUntil` 模式确保订阅在连接关闭时被正确清理，防止内存泄漏和潜在的竞态条件。

### 1.3 代码重构 - 减少重复代码

**新增:** `tabby-core/src/api/genericRecoveryProvider.ts`

创建了通用恢复提供者基类，减少以下模块的代码重复：
- `tabby-local/src/recoveryProvider.ts`
- `tabby-serial/src/recoveryProvider.ts`
- `tabby-ssh/src/recoveryProvider.ts`
- `tabby-telnet/src/recoveryProvider.ts`

每个恢复提供者减少约 20 行样板代码，总计减少约 80 行代码。

---

## 二、内存泄漏修复 (8f6cca02)

### 2.1 为什么要做

Angular 应用中存在多处资源未正确释放的问题：

| 问题类型 | 影响 | 后果 |
|----------|------|------|
| 事件监听器未移除 | 内存持续增长 | 应用变慢，最终崩溃 |
| RxJS 订阅未取消 | 后台任务继续执行 | CPU 占用，数据泄露 |
| 定时器未清理 | 回调持续触发 | 逻辑错误，性能问题 |

### 2.2 具体修改

#### 2.2.1 事件监听器清理 - ai-sidebar.service.ts

**问题:** 侧边栏组件添加了鼠标事件监听器用于拖拽调整大小，但在组件销毁时未移除。

**修复:**

```typescript
// 1. 存储事件处理器引用
private resizeMouseDownHandler: ((e: MouseEvent) => void) | null = null
private resizeMouseEnterHandler: (() => void) | null = null
private resizeMouseLeaveHandler: (() => void) | null = null

// 2. 注册时保存引用
handle.addEventListener('mousedown', onMouseDown)
this.resizeMouseDownHandler = onMouseDown

// 3. 销毁时移除监听器
if (this.resizeHandle) {
    if (this.resizeMouseDownHandler) {
        this.resizeHandle.removeEventListener('mousedown', this.resizeMouseDownHandler)
    }
    // ... 其他监听器同理
}

// 4. 清空引用
this.resizeMouseDownHandler = null
```

#### 2.2.2 服务层 OnDestroy 实现

为以下服务添加了 `OnDestroy` 接口实现：

| 服务文件 | 清理内容 |
|----------|----------|
| `ai-assistant.service.ts` | config 订阅、pendingProviderRefresh 定时器 |
| `terminal-manager.service.ts` | tabsChanged 订阅、outputSubscriptions |
| `async-task-manager.service.ts` | 监控定时器、任务列表、事件流 |
| `tool-stream-processor.service.ts` | 当前订阅、活跃工具调用 |

**统一的 takeUntil 模式:**

```typescript
@Injectable({ providedIn: 'root' })
export class SomeService implements OnDestroy {
    private destroy$ = new Subject<void>()

    constructor() {
        someObservable$.pipe(
            takeUntil(this.destroy$)
        ).subscribe(() => { ... })
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }
}
```

#### 2.2.3 主模块清理 - index.ts

```typescript
export default class AiAssistantModule implements OnDestroy {
    private destroy$ = new Subject<void>()

    constructor() {
        this.app.ready$.pipe(
            takeUntil(this.destroy$)
        ).subscribe(() => { ... })

        hotkeys.hotkey$.pipe(
            takeUntil(this.destroy$)
        ).subscribe(hotkey => { ... })
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }
}
```

#### 2.2.4 组件修复

为多个组件添加了 `ngOnDestroy` 生命周期钩子和 `type="button"` 属性：

**涉及组件:**
- ChatInterfaceComponent
- ChatSettingsComponent
- ErrorMessageComponent
- LoadingSpinnerComponent
- RiskConfirmDialogComponent
- AiSettingsTabComponent
- DataSettingsComponent
- GeneralSettingsComponent
- McpSettingsComponent
- ProviderConfigComponent
- SecuritySettingsComponent
- CommandPreviewComponent
- CommandSuggestionComponent

**`type="button"` 的作用:**

```html
<!-- 修改前 -->
<button class="btn" (click)="doSomething()">Click</button>

<!-- 修改后 -->
<button type="button" class="btn" (click)="doSomething()">Click</button>
```

**原因:** 在 `<form>` 内部，未指定 `type` 的 `<button>` 默认为 `submit`，点击会触发表单提交导致页面刷新。

---

## 三、变更统计

| 提交 | 文件数 | 新增行 | 删除行 |
|------|--------|--------|--------|
| 56e2195c (安全性) | 15 | 173 | 78 |
| 8f6cca02 (内存泄漏) | 32 | 292 | 57 |
| **合计** | **47** | **465** | **135** |

---

## 四、最佳实践总结

### 4.1 安全性

1. **永远不要信任用户输入** - 使用 DOMPurify 消毒 HTML
2. **优先使用 textContent** - 除非确实需要 HTML，否则不用 innerHTML
3. **审计第三方内容** - AI 返回的内容同样需要验证

### 4.2 内存管理

1. **存储事件处理器引用** - 便于后续移除
2. **使用 takeUntil 模式** - 统一管理 RxJS 订阅
3. **实现 OnDestroy 接口** - 确保资源释放
4. **清理定时器** - clearInterval/clearTimeout/clearImmediate

### 4.3 代码质量

1. **提取公共基类** - 减少代码重复
2. **明确按钮类型** - 防止意外表单提交
3. **添加生命周期钩子** - 即使暂时为空，也为将来扩展预留

---

## 五、后续建议

1. **添加单元测试** - 验证 OnDestroy 正确清理资源
2. **性能监控** - 使用 Angular DevTools 检测内存泄漏
3. **安全审计** - 定期运行 npm audit 和 SAST 工具
4. **代码规范** - 考虑添加 ESLint 规则强制 OnDestroy 实现