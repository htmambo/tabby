import { Injectable, ApplicationRef, Injector, EmbeddedViewRef, ComponentRef, EnvironmentInjector, Optional, createComponent } from '@angular/core'
import { Subject, Observable } from 'rxjs'
import { ConfigService, SettingsTabOpener } from 'tabby-core'
import { AiSidebarComponent } from '../../components/chat/ai-sidebar.component'
import { ChatInterfaceOpener } from '../../api/chatInterfaceOpener'
import { ConfigProviderService } from '../core/config-provider.service'
import { AiSettingsViewService } from '../core/ai-settings-view.service'

/**
 * 预设消息接口
 */
export interface PresetMessage {
    message: string;
    autoSend: boolean;
}

/**
 * AI Sidebar 配置接口
 */
export interface AiSidebarConfig {
    enabled?: boolean;
    position?: 'left' | 'right';
    showInToolbar?: boolean;
    sidebarVisible?: boolean;
    sidebarCollapsed?: boolean;
    sidebarWidth?: number;
    displayMode?: 'sidebar' | 'floating';  // 显示模式：侧边栏或浮动窗口
    floatingX?: number;  // 浮动窗口 X 坐标
    floatingY?: number;  // 浮动窗口 Y 坐标
    floatingWidth?: number;  // 浮动窗口宽度
    floatingHeight?: number;  // 浮动窗口高度
}

/**
 * AI Sidebar 服务 - 管理 AI 聊天侧边栏的生命周期
 *
 * 采用 Flexbox 布局方式，将 sidebar 插入到 app-root 作为第一个子元素，
 * app-root 变为水平 flex 容器，sidebar 在左侧
 */
@Injectable({ providedIn: 'root' })
export class AiSidebarService implements ChatInterfaceOpener {
    private sidebarComponentRef: ComponentRef<AiSidebarComponent> | null = null
    private sidebarElement: HTMLElement | null = null
    private styleElement: HTMLStyleElement | null = null
    private resizeHandle: HTMLElement | null = null
    private windowResizeHandler: (() => void) | null = null
    private cleanupResizeHandleListeners: (() => void) | null = null
    private cleanupResizeDocumentListeners: (() => void) | null = null
    private _isVisible = false

    // Resize constants
    private readonly MIN_WIDTH = 280
    private readonly MAX_WIDTH = 500
    private readonly DEFAULT_WIDTH = 320
    private currentWidth: number = this.DEFAULT_WIDTH
    private isResizing = false

    // Floating window constants
    private readonly DEFAULT_FLOATING_WIDTH = 400
    private readonly DEFAULT_FLOATING_HEIGHT = 500
    private readonly MIN_FLOATING_WIDTH = 300
    private readonly MIN_FLOATING_HEIGHT = 300
    private isDragging = false
    private dragStartX = 0
    private dragStartY = 0
    private floatingX = 0
    private floatingY = 0
    private cleanupDragListeners: (() => void) | null = null

    // 预设消息 Subject（用于快捷键功能）
    private presetMessageSubject = new Subject<PresetMessage>()

    /**
     * 获取预设消息 Observable
     */
    get presetMessage$(): Observable<PresetMessage> {
        return this.presetMessageSubject.asObservable()
    }

    /**
     * 侧边栏是否可见
     */
    get sidebarVisible(): boolean {
        return this._isVisible
    }

    constructor(
        private appRef: ApplicationRef,
        private injector: Injector,
        private environmentInjector: EnvironmentInjector,
        private config: ConfigService,
        private aiConfig: ConfigProviderService,
        private settingsView: AiSettingsViewService,
        @Optional() private settingsTabOpener: SettingsTabOpener | null,
    ) { }

    private isAssistantEnabled (): boolean {
        return this.aiConfig.isEnabled()
    }

    /**
     * 显示 sidebar
     */
    show(): void {
        if (!this.isAssistantEnabled()) {
            this.openSettings()
            return
        }
        if (this._isVisible) {
            return
        }

        this.createSidebar()

        const pluginConfig = this.getPluginConfig()
        pluginConfig.sidebarVisible = true
        this.savePluginConfig(pluginConfig)

        this._isVisible = true
    }

    open(): void {
        this.show()
    }

    /**
     * 隐藏 sidebar
     */
    hide(): void {
        if (!this._isVisible) {
            return
        }

        this.destroySidebar()

        const pluginConfig = this.getPluginConfig()
        pluginConfig.sidebarVisible = false
        this.savePluginConfig(pluginConfig)

        this._isVisible = false
    }

    /**
     * 切换 sidebar 显示状态
     */
    toggle(): void {
        if (this._isVisible) {
            this.hide()
        } else if (!this.isAssistantEnabled()) {
            this.openSettings()
        } else {
            this.show()
        }
    }

    /**
     * 获取当前显示状态
     */
    get visible(): boolean {
        return this._isVisible
    }

    /**
     * 打开 AI 助手设置页
     */
    openSettings(): void {
        this.settingsView.requestTab('providers')
        this.settingsTabOpener?.open('ai-assistant')
    }

    /**
     * 发送预设消息并执行
     * 用于快捷键功能 - 自动填充并发送消息
     * @param message 消息内容
     * @param autoSend 是否自动发送（否则只填充不发送）
     */
    sendPresetMessage(message: string, autoSend = true): void {
        if (!this.isAssistantEnabled()) {
            this.openSettings()
            return
        }
        if (!this._isVisible) {
            this.show()
        }

        // 通知侧边栏组件填充消息
        this.presetMessageSubject.next({ message, autoSend })
    }

    /**
     * 初始化 - 应用启动时调用
     */
    initialize(): void {
        if (!this.isAssistantEnabled()) {
            return
        }
        const pluginConfig = this.getPluginConfig()
        // 默认不自动显示，除非明确设置为显示
        if (pluginConfig.sidebarVisible === true) {
            this.show()
        }
    }

    /**
     * 获取显示模式
     */
    getDisplayMode(): 'sidebar' | 'floating' {
        const pluginConfig = this.getPluginConfig()
        return pluginConfig.displayMode ?? 'sidebar'
    }

    /**
     * 设置显示模式
     */
    setDisplayMode(mode: 'sidebar' | 'floating'): void {
        const pluginConfig = this.getPluginConfig()
        pluginConfig.displayMode = mode
        this.savePluginConfig(pluginConfig)

        // 如果正在显示，重新创建以应用新模式
        if (this._isVisible) {
            this.destroySidebar()
            this.createSidebar()
        }
    }

    /**
     * 获取 sidebar 位置
     */
    getSidebarPosition(): 'left' | 'right' {
        const pluginConfig = this.getPluginConfig()
        return pluginConfig.position ?? 'right'
    }

    /**
     * 设置 sidebar 位置
     */
    setSidebarPosition(position: 'left' | 'right'): void {
        const pluginConfig = this.getPluginConfig()
        pluginConfig.position = position
        this.savePluginConfig(pluginConfig)

        // 如果 sidebar 正在显示，重新创建以应用新位置
        if (this._isVisible) {
            this.destroySidebar()
            this.createSidebar()
        }
    }

    /**
     * 创建 sidebar 组件
     *
     * 支持两种显示模式：
     * 1. sidebar 模式：固定在左侧或右侧，推开主内容区
     * 2. floating 模式：可拖拽的浮动窗口
     */
    private createSidebar(): void {
        const displayMode = this.getDisplayMode()

        // 使用 createComponent API，传入 EnvironmentInjector 以正确解析模块级依赖
        this.sidebarComponentRef = createComponent(AiSidebarComponent, {
            environmentInjector: this.environmentInjector,
            elementInjector: this.injector,
        })

        // 附加到应用
        this.appRef.attachView(this.sidebarComponentRef.hostView)

        // 获取 DOM 元素
        const domElem = (this.sidebarComponentRef.hostView as EmbeddedViewRef<any>).rootNodes[0] as HTMLElement
        // 直接设置组件 host 元素的样式 - 确保 flex 布局正确
        domElem.style.display = 'flex'
        domElem.style.flexDirection = 'column'
        domElem.style.height = '100%'
        domElem.style.width = '100%'
        domElem.style.overflow = 'hidden'

        // 创建 wrapper 元素
        const wrapper = document.createElement('div')
        wrapper.className = 'ai-sidebar-wrapper'

        if (displayMode === 'floating') {
            // 浮动窗口模式
            this.setupFloatingWrapper(wrapper, domElem)
        } else {
            // 侧边栏模式
            this.setupSidebarWrapper(wrapper, domElem)
        }

        // 注入服务引用到组件
        if (this.sidebarComponentRef) {
            const component = this.sidebarComponentRef.instance
            component.sidebarService = this
        }
    }

    /**
     * 设置侧边栏模式的 wrapper
     */
    private setupSidebarWrapper(wrapper: HTMLElement, domElem: HTMLElement): void {
        // 加载保存的宽度和位置
        this.currentWidth = this.loadSidebarWidth()
        const position = this.getSidebarPosition()
        const isRight = position === 'right'

        const viewportMetrics = this.getViewportMetrics()
        wrapper.style.cssText = `
            position: fixed;
            ${isRight ? 'right' : 'left'}: 0;
            top: ${viewportMetrics.top}px;
            width: ${this.currentWidth}px;
            height: ${viewportMetrics.height}px;
            display: flex;
            flex-direction: column;
            background: var(--body-bg, var(--bs-body-bg, #1e1e1e));
            border-${isRight ? 'left' : 'right'}: 1px solid var(--bs-border-color, var(--theme-bg-more-2, #333));
            box-shadow: ${isRight ? '-2px' : '2px'} 0 10px rgba(0,0,0,0.3);
            z-index: 1000;
            overflow: hidden;
        `

        // 监听窗口大小变化，动态更新高度和顶部偏移
        const resizeHandler = () => {
            this.applyWrapperViewportMetrics(wrapper)
        }
        window.addEventListener('resize', resizeHandler)
        this.windowResizeHandler = resizeHandler

        // 创建 resize handle（拖动条）
        const resizeHandle = document.createElement('div')
        resizeHandle.className = 'ai-sidebar-resize-handle'
        // 根据位置调整 resize handle 的位置
        const handlePosition = isRight ? 'left: -4px;' : 'right: -4px;'
        resizeHandle.style.cssText = `
            position: absolute;
            top: 0;
            ${handlePosition}
            width: 8px;
            height: 100%;
            cursor: ew-resize;
            background: transparent;
            z-index: 1001;
            transition: background 0.2s;
        `

        // 鼠标悬停时显示高亮
        const onMouseEnter = () => {
            resizeHandle.style.background = 'var(--ai-primary, #4dabf7)'
        }
        const onMouseLeave = () => {
            if (!this.isResizing) {
                resizeHandle.style.background = 'transparent'
            }
        }
        resizeHandle.addEventListener('mouseenter', onMouseEnter)
        resizeHandle.addEventListener('mouseleave', onMouseLeave)
        this.cleanupResizeHandleListeners = () => {
            resizeHandle.removeEventListener('mouseenter', onMouseEnter)
            resizeHandle.removeEventListener('mouseleave', onMouseLeave)
        }

        // 添加拖动逻辑
        this.setupResizeHandler(resizeHandle, wrapper)

        wrapper.appendChild(resizeHandle)
        this.resizeHandle = resizeHandle

        wrapper.appendChild(domElem)

        // 插入到 body
        document.body.appendChild(wrapper)

        this.sidebarElement = wrapper

        // 注入布局 CSS - 只添加 margin-left 把主内容推开
        this.injectLayoutCSS()
    }

    /**
     * 设置浮动窗口模式的 wrapper
     */
    private setupFloatingWrapper(wrapper: HTMLElement, domElem: HTMLElement): void {
        const pluginConfig = this.getPluginConfig()

        // 加载保存的位置和大小
        const savedX = pluginConfig.floatingX
        const savedY = pluginConfig.floatingY
        const savedWidth = pluginConfig.floatingWidth ?? this.DEFAULT_FLOATING_WIDTH
        const savedHeight = pluginConfig.floatingHeight ?? this.DEFAULT_FLOATING_HEIGHT

        // 计算初始位置（如果没保存过，则居中显示）
        if (savedX !== undefined && savedY !== undefined) {
            this.floatingX = savedX
            this.floatingY = savedY
        } else {
            // 居中显示
            this.floatingX = Math.max(0, (window.innerWidth - savedWidth) / 2)
            this.floatingY = Math.max(0, (window.innerHeight - savedHeight) / 3)
        }

        wrapper.style.cssText = `
            position: fixed;
            left: ${this.floatingX}px;
            top: ${this.floatingY}px;
            width: ${savedWidth}px;
            height: ${savedHeight}px;
            display: flex;
            flex-direction: column;
            background: var(--body-bg, var(--bs-body-bg, #1e1e1e));
            border: 1px solid var(--bs-border-color, var(--theme-bg-more-2, #333));
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            z-index: 1001;
            overflow: hidden;
            resize: both;
        `

        // 创建拖拽标题栏
        const dragHandle = document.createElement('div')
        dragHandle.className = 'ai-floating-drag-handle'
        dragHandle.style.cssText = `
            flex-shrink: 0;
            height: 28px;
            background: var(--bs-body-bg, #2d2d2d);
            border-bottom: 1px solid var(--bs-border-color, #333);
            cursor: move;
            display: flex;
            align-items: center;
            padding: 0 8px;
            user-select: none;
        `

        // 添加拖拽图标
        const dragIcon = document.createElement('span')
        dragIcon.innerHTML = '⋮⋮'
        dragIcon.style.cssText = `
            color: var(--ai-text-secondary, #adb5bd);
            font-size: 12px;
            letter-spacing: 2px;
        `
        dragHandle.appendChild(dragIcon)

        // 设置拖拽逻辑
        this.setupDragHandler(dragHandle, wrapper)

        wrapper.appendChild(dragHandle)
        wrapper.appendChild(domElem)

        // 插入到 body
        document.body.appendChild(wrapper)

        this.sidebarElement = wrapper
    }

    /**
     * 设置拖拽逻辑（浮动窗口）
     */
    private setupDragHandler(handle: HTMLElement, wrapper: HTMLElement): void {
        const onMouseDown = (e: MouseEvent) => {
            // 如果点击的是按钮或输入框，不触发拖拽
            if ((e.target as HTMLElement).tagName === 'BUTTON' ||
                (e.target as HTMLElement).tagName === 'INPUT' ||
                (e.target as HTMLElement).tagName === 'TEXTAREA' ||
                (e.target as HTMLElement).tagName === 'SELECT') {
                return
            }

            e.preventDefault()
            this.isDragging = true
            this.dragStartX = e.clientX - this.floatingX
            this.dragStartY = e.clientY - this.floatingY

            document.body.style.cursor = 'move'
            document.body.style.userSelect = 'none'
        }

        const onMouseMove = (e: MouseEvent) => {
            if (!this.isDragging) {return}

            const newX = e.clientX - this.dragStartX
            const newY = e.clientY - this.dragStartY

            // 限制在屏幕范围内
            this.floatingX = Math.max(0, Math.min(window.innerWidth - 100, newX))
            this.floatingY = Math.max(0, Math.min(window.innerHeight - 50, newY))

            wrapper.style.left = `${this.floatingX}px`
            wrapper.style.top = `${this.floatingY}px`
        }

        const onMouseUp = () => {
            if (!this.isDragging) {return}
            this.isDragging = false
            document.body.style.cursor = ''
            document.body.style.userSelect = ''

            // 保存位置
            this.saveFloatingPosition()
        }

        handle.addEventListener('mousedown', onMouseDown)
        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup', onMouseUp)

        this.cleanupDragListeners = () => {
            handle.removeEventListener('mousedown', onMouseDown)
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup', onMouseUp)
        }
    }

    /**
     * 保存浮动窗口位置
     */
    private saveFloatingPosition(): void {
        const pluginConfig = this.getPluginConfig()
        pluginConfig.floatingX = this.floatingX
        pluginConfig.floatingY = this.floatingY

        // 保存大小
        if (this.sidebarElement) {
            const rect = this.sidebarElement.getBoundingClientRect()
            pluginConfig.floatingWidth = Math.max(this.MIN_FLOATING_WIDTH, rect.width)
            pluginConfig.floatingHeight = Math.max(this.MIN_FLOATING_HEIGHT, rect.height)
        }

        this.savePluginConfig(pluginConfig)
    }

    /**
     * 销毁 sidebar 组件
     */
    private destroySidebar(): void {
        // 移除注入的 CSS
        this.removeLayoutCSS()

        if (this.windowResizeHandler) {
            window.removeEventListener('resize', this.windowResizeHandler)
            this.windowResizeHandler = null
        }

        this.clearActiveResizeDocumentListeners()

        if (this.cleanupResizeHandleListeners) {
            this.cleanupResizeHandleListeners()
            this.cleanupResizeHandleListeners = null
        }

        if (this.cleanupDragListeners) {
            this.cleanupDragListeners()
            this.cleanupDragListeners = null
        }

        if (this.sidebarComponentRef) {
            this.appRef.detachView(this.sidebarComponentRef.hostView)
            this.sidebarComponentRef.destroy()
            this.sidebarComponentRef = null
        }

        if (this.sidebarElement) {
            this.sidebarElement.remove()
            this.sidebarElement = null
        }

        this.resizeHandle = null
    }

    /**
     * 调整 .content 元素样式 - 只处理第二个（更深层的）.content
     */
    private adjustContentStyles(appRoot: Element, apply: boolean): void {
        const contentElements = appRoot.querySelectorAll('.content')

        if (contentElements.length > 1) {
            // 选择第二个（更深层的）.content 元素，这是 Tabby 的主内容区
            const contentElement = contentElements[1] as HTMLElement
            if (apply) {
                contentElement.style.width = 'auto'
                contentElement.style.flex = '1 1 auto'
                contentElement.style.minWidth = '0'
            } else {
                contentElement.style.removeProperty('width')
                contentElement.style.removeProperty('flex')
                contentElement.style.removeProperty('min-width')
            }
        } else if (contentElements.length === 1) {
            // 如果只有一个 .content，则处理它
            const contentElement = contentElements[0] as HTMLElement
            if (apply) {
                contentElement.style.width = 'auto'
                contentElement.style.flex = '1 1 auto'
                contentElement.style.minWidth = '0'
            } else {
                contentElement.style.removeProperty('width')
                contentElement.style.removeProperty('flex')
                contentElement.style.removeProperty('min-width')
            }
        }
    }

    /**
     * 注入布局 CSS - 使用 margin 把主内容推开
     *
     * 固定定位方案：侧边栏 fixed，主内容区 margin
     *
     * 修复：只推开内容区，不影响标题栏/标签栏
     * 支持左右位置
     */
    private injectLayoutCSS(): void {
        const style = document.createElement('style')
        style.id = 'ai-sidebar-layout-css'
        style.textContent = `
            app-root > .content > .content.royal-workspace,
            app-root > .content > .content:not(.tab-bar) {
                transition: margin-left 0.2s ease, margin-right 0.2s ease;
            }
        `

        document.head.appendChild(style)
        this.styleElement = style

        // 同时尝试直接调整 DOM 元素的样式（更可靠）
        this.adjustMainContentMargin(true)
    }

    /**
     * 调整主内容区的 margin
     */
    private adjustMainContentMargin(apply: boolean): void {
        const position = this.getSidebarPosition()
        const isRight = position === 'right'
        const marginProp = isRight ? 'marginRight' : 'marginLeft'
        const oppositeMarginProp = isRight ? 'marginLeft' : 'marginRight'

        for (const el of this.getLayoutTargets()) {
            if (apply) {
                (el.style as any)[marginProp] = `${this.currentWidth}px`;
                (el.style as any)[oppositeMarginProp] = ''
                el.style.transition = 'margin-left 0.2s ease, margin-right 0.2s ease'
                el.style.width = 'auto'
                el.style.flex = '1 1 auto'
                el.style.minWidth = '0'
            } else {
                el.style.removeProperty('margin-left')
                el.style.removeProperty('margin-right')
                el.style.removeProperty('transition')
                el.style.removeProperty('width')
                el.style.removeProperty('flex')
                el.style.removeProperty('min-width')
            }
        }
    }

    /**
     * 移除布局 CSS
     */
    private removeLayoutCSS(): void {
        if (this.styleElement) {
            this.styleElement.remove()
            this.styleElement = null
        }

        // 同时移除直接设置的样式
        this.adjustMainContentMargin(false)
    }

    /**
     * 设置 resize handle 拖动逻辑
     */
    private setupResizeHandler(handle: HTMLElement, wrapper: HTMLElement): void {
        let startX = 0
        let startWidth = 0

        const onMouseMove = (e: MouseEvent) => {
            if (!this.isResizing) {return}

            const delta = e.clientX - startX
            const isRight = this.getSidebarPosition() === 'right'
            let newWidth = isRight ? startWidth - delta : startWidth + delta

            // 限制宽度范围
            newWidth = Math.max(this.MIN_WIDTH, Math.min(this.MAX_WIDTH, newWidth))

            this.currentWidth = newWidth
            wrapper.style.width = `${newWidth}px`

            // 更新主内容区的边距，避免与标题栏/标签栏重叠
            this.updateLayoutCSS(newWidth)
        }

        const onMouseUp = () => {
            this.clearActiveResizeDocumentListeners()

            // 保存宽度到配置
            this.saveSidebarWidth(this.currentWidth)
        }

        const onMouseDown = (e: MouseEvent) => {
            e.preventDefault()

            this.clearActiveResizeDocumentListeners()
            this.isResizing = true
            startX = e.clientX
            startWidth = this.currentWidth
            document.addEventListener('mousemove', onMouseMove)
            document.addEventListener('mouseup', onMouseUp)
            this.cleanupResizeDocumentListeners = () => {
                document.removeEventListener('mousemove', onMouseMove)
                document.removeEventListener('mouseup', onMouseUp)
            }
            document.body.style.cursor = 'ew-resize'
            document.body.style.userSelect = 'none'
        }

        handle.addEventListener('mousedown', onMouseDown)
        const previousCleanup = this.cleanupResizeHandleListeners
        this.cleanupResizeHandleListeners = () => {
            previousCleanup?.()
            handle.removeEventListener('mousedown', onMouseDown)
        }
    }

    private clearActiveResizeDocumentListeners(): void {
        this.cleanupResizeDocumentListeners?.()
        this.cleanupResizeDocumentListeners = null
        this.isResizing = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        this.resizeHandle?.style.setProperty('background', 'transparent')
    }

    /**
     * 更新布局 CSS（resize 时调用）
     */
    private updateLayoutCSS(width: number): void {
        this.currentWidth = width
        this.adjustMainContentMargin(true)
    }

    /**
     * 获取需要被侧边栏推开的实际工作区元素
     */
    private getLayoutTargets(): HTMLElement[] {
        const appContent = document.querySelector('app-root > .content') as HTMLElement | null
        if (!appContent) {
            return []
        }

        const candidates = [
            appContent.querySelector(':scope > .content.royal-workspace'),
            appContent.querySelector(':scope > .content:not(.tab-bar)'),
            appContent,
        ]

        const elements = candidates.filter((el): el is HTMLElement => el instanceof HTMLElement)
        return elements.length > 0 ? [elements[0]] : []
    }

    /**
     * 获取侧边栏的顶部偏移与可用高度，避免覆盖标题栏和顶部标签栏
     */
    private getViewportMetrics(): { top: number; height: string } {
        let top = 0

        const titleBar = document.querySelector('app-root > title-bar, app-root > app-title-bar, app-root > .title-bar') as HTMLElement | null
        if (titleBar) {
            top += Math.round(titleBar.getBoundingClientRect().height)
        }

        if (!this.hasVerticalTabs()) {
            const tabBar = document.querySelector('app-root > .content > .tab-bar') as HTMLElement | null
            if (tabBar) {
                top += Math.round(tabBar.getBoundingClientRect().height)
            }
        }

        const height = Math.max(window.innerHeight - top, 0)
        return {
            top,
            height: `${height}px`,
        }
    }

    /**
     * 根据当前布局重新计算侧边栏 wrapper 的 top / height
     */
    private applyWrapperViewportMetrics(wrapper: HTMLElement): void {
        const viewportMetrics = this.getViewportMetrics()
        wrapper.style.top = `${viewportMetrics.top}px`
        wrapper.style.height = viewportMetrics.height
    }

    /**
     * 检测当前标签栏是否为左右垂直布局
     */
    private hasVerticalTabs(): boolean {
        const appContent = document.querySelector('app-root > .content') as HTMLElement | null
        if (!appContent) {
            return false
        }

        return appContent.classList.contains('tabs-on-left') || appContent.classList.contains('tabs-on-right')
    }

    /**
     * 加载保存的侧边栏宽度
     */
    private loadSidebarWidth(): number {
        const pluginConfig = this.getPluginConfig()
        const savedWidth = pluginConfig.sidebarWidth
        if (savedWidth && savedWidth >= this.MIN_WIDTH && savedWidth <= this.MAX_WIDTH) {
            return savedWidth
        }
        return this.DEFAULT_WIDTH
    }

    /**
     * 保存侧边栏宽度到配置
     */
    private saveSidebarWidth(width: number): void {
        const pluginConfig = this.getPluginConfig()
        pluginConfig.sidebarWidth = width
        this.savePluginConfig(pluginConfig)
    }

    /**
     * 获取插件配置
     */
    private getPluginConfig(): AiSidebarConfig {
        return this.config.store.pluginConfig?.['ai-assistant'] || {}
    }

    /**
     * 保存插件配置
     */
    private savePluginConfig(pluginConfig: AiSidebarConfig): void {
        if (!this.config.store.pluginConfig) {
            this.config.store.pluginConfig = {}
        }
        this.config.store.pluginConfig['ai-assistant'] = pluginConfig
        this.config.save()
    }
}
