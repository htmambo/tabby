/**
 * 主题服务 - 统一管理所有 AI 助手主题
 * 通过动态 <style> 注入实现主题切换
 */
import { Injectable, OnDestroy } from '@angular/core'
import { Subject } from 'rxjs'
import { ConfigProviderService } from './config-provider.service'

// eslint-disable-next-line @typescript-eslint/no-type-alias
export type ThemeType = 'tech'

// 主题变量定义 — 配色跟随项目自身 CSS 变量（--theme-* / --bs-*）
// 这样只需修改项目配色方案，AI 助手即可自动同步
const THEME_VARIABLES: Record<ThemeType, Record<string, string>> = {
    tech: {
        // 主色调 - 跟随项目配色
        'ai-primary': 'var(--theme-primary, var(--bs-primary, #007bff))',
        'ai-primary-hover': 'var(--theme-primary-less, var(--bs-primary, #0069d9))',
        'ai-secondary': 'var(--theme-secondary, var(--bs-secondary, #6c757d))',
        'ai-success': 'var(--theme-success, var(--bs-success, #28a745))',
        'ai-warning': 'var(--theme-warning, var(--bs-warning, #ffc107))',
        'ai-danger': 'var(--theme-danger, var(--bs-danger, #dc3545))',
        'ai-info': 'var(--theme-info, var(--bs-info, #17a2b8))',
        // 风险级别颜色
        'ai-risk-low': 'var(--theme-success, var(--bs-success, #28a745))',
        'ai-risk-medium': 'var(--theme-warning, var(--bs-warning, #ffc107))',
        'ai-risk-high': 'var(--theme-warning-more, var(--bs-warning, #fd7e14))',
        'ai-risk-critical': 'var(--theme-danger, var(--bs-danger, #dc3545))',
        // 聊天消息颜色
        'ai-user-message': 'var(--theme-primary-active-fg, rgba(var(--bs-primary-rgb, 13, 110, 253), 0.15))',
        'ai-assistant-message': 'var(--theme-bg-more, var(--bs-secondary-bg, #2d2d2d))',
        'ai-system-message': 'var(--theme-warning-active-fg, var(--theme-bg-more-2, #3a3a3a))',
        // 背景和边框
        'ai-bg-primary': 'var(--bs-body-bg, #1e1e1e)',
        'ai-bg-secondary': 'var(--bs-secondary-bg, #2d2d2d)',
        'ai-bg-tertiary': 'var(--theme-bg-less, #3d3d3d)',
        'ai-text-primary': 'var(--bs-body-color, #f8f9fa)',
        'ai-text-secondary': 'var(--bs-secondary-color, #adb5bd)',
        'ai-border': 'var(--theme-fg-less2, #4a4a4a)',
        'ai-border-radius': 'var(--bs-border-radius, 0.375rem)',
        'ai-box-shadow': '0 0.125rem 0.25rem rgba(0, 0, 0, 0.18)',
        // 字体
        'ai-font-family': 'var(--bs-body-font-family, -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif)',
        'ai-font-size-base': 'var(--bs-body-font-size, 14px)',
        // 其他
        'ai-dark': 'var(--theme-bg, var(--bs-body-bg, #1e1e1e))',
        'ai-light': 'var(--theme-fg, var(--bs-body-color, #f8f9fa))',
        'ai-transition-duration': '0.3s',
    },
}

@Injectable({
    providedIn: 'root',
})
export class ThemeService implements OnDestroy {
    private currentTheme$ = new Subject<ThemeType>()
    private styleElement: HTMLStyleElement
    readonly theme$ = this.currentTheme$.asObservable()

    private readonly allThemeClasses = [
        'ai-theme-tech',
    ]

    // AI 助手容器选择器
    private readonly containerSelectors = [
        '.ai-chat-interface',
        '.ai-settings-tab',
        '.ai-assistant',
        '.ai-sidebar-container',
        '.ai-chat-modal-left',
    ]

    constructor(
        private config: ConfigProviderService,
    ) {
        // 创建并注入动态样式元素
        this.styleElement = document.createElement('style')
        this.styleElement.id = 'ai-assistant-dynamic-theme'
        document.head.appendChild(this.styleElement)

        this.init()
    }

    private init(): void {
        const savedTheme = this.config.get<string>('theme', 'tech') as ThemeType
        this.setTheme(savedTheme)
    }

    /**
     * 获取当前主题
     */
    getCurrentTheme(): ThemeType {
        return this.config.get<string>('theme', 'tech') as ThemeType
    }

    /**
     * 设置并应用主题
     */
    setTheme(theme: ThemeType): void {
        this.config.set('theme', theme)
        this.applyTheme(theme)
    }

    /**
     * 核心方法：动态注入主题样式
     */
    applyTheme(theme: ThemeType): void {
        this.currentTheme$.next(theme)

        // 确定实际生效的主题
        const effectiveTheme: ThemeType = theme

        // 1. 生成 CSS 变量样式
        const cssVariables = this.buildCssVariables(effectiveTheme)
        // 2. 生成主题特定样式
        const themeStyles = this.buildThemeStyles(effectiveTheme)
        // 3. 注入完整样式到 DOM
        this.styleElement.textContent = `
/* AI Assistant Dynamic Theme - ${theme} (effective: ${effectiveTheme}) */
:root,
html,
body,
${this.containerSelectors.join(',\n')} {
${cssVariables}
}
${themeStyles}
        `.trim()

        // 4. 更新类名和 data 属性
        this.updateBodyClasses(theme, effectiveTheme)

        // 5. 触发自定义事件
        window.dispatchEvent(new CustomEvent('ai-theme-changed', {
            detail: { theme, effectiveTheme },
        }))

        console.debug('[ThemeService] Theme applied dynamically:', { theme, effectiveTheme })
    }

    /**
     * 生成 CSS 变量字符串
     */
    private buildCssVariables(theme: ThemeType): string {
        const vars = THEME_VARIABLES[theme] || THEME_VARIABLES.tech
        return Object.entries(vars)
            .map(([key, value]) => `    --${key}: ${value} !important;`)
            .join('\n')
    }

    /**
     * 生成主题特定样式（像素风格、科技风格等）
     */
    private buildThemeStyles(theme: ThemeType): string {
        if (theme === 'tech') {
            return `
/* Tech theme specific styles */
${this.containerSelectors.join(',\n')} {
    /* 扫描线背景 */
    background: var(--ai-assistant-message, #2d3748) !important;

    /* 发光按钮 */
    .btn {
        background: linear-gradient(135deg, var(--ai-bg-secondary) 0%, var(--ai-bg-tertiary) 100%) !important;
        border: 1px solid var(--ai-border) !important;
        color: var(--ai-text-primary) !important;
        box-shadow:
            0 0 10px color-mix(in srgb, var(--ai-primary) 20%, transparent),
            inset 0 0 10px color-mix(in srgb, var(--ai-primary) 5%, transparent) !important;
    }

    .btn:hover {
        border-color: var(--ai-primary) !important;
        box-shadow:
            0 0 20px color-mix(in srgb, var(--ai-primary) 40%, transparent),
            inset 0 0 20px color-mix(in srgb, var(--ai-primary) 10%, transparent) !important;
    }

    /* 发光输入框 */
    input,
    textarea,
    .form-control {
        border: 1px solid var(--ai-primary) !important;
        background: var(--ai-bg-primary) !important;
        color: var(--ai-text-primary) !important;
        box-shadow: 0 0 10px color-mix(in srgb, var(--ai-primary) 10%, transparent) !important;
    }

    input:focus,
    textarea:focus,
    .form-control:focus {
        outline: none !important;
        border-color: var(--ai-primary) !important;
        box-shadow:
            0 0 20px color-mix(in srgb, var(--ai-primary) 30%, transparent),
            inset 0 0 10px color-mix(in srgb, var(--ai-primary) 5%, transparent) !important;
    }

    /* 霓虹标题 */
    h2, h3, h4 {
        color: var(--ai-text-primary) !important;
        text-shadow:
            0 0 10px var(--ai-primary),
            0 0 20px var(--ai-primary) !important;
    }

    /* 滚动条 */
    ::-webkit-scrollbar {
        width: 8px !important;
        background: var(--ai-bg-secondary) !important;
    }

    ::-webkit-scrollbar-thumb {
        background: var(--ai-primary) !important;
        border-radius: var(--ai-border-radius) !important;
        box-shadow: 0 0 10px var(--ai-primary) !important;
    }
}
            `.trim()
        }

        return ''
    }

    /**
     * 更新 body 和 html 的类名
     */
    private updateBodyClasses(theme: ThemeType, effectiveTheme: ThemeType): void {
        const root = document.documentElement
        const body = document.body

        // 移除所有主题类
        this.allThemeClasses.forEach(cls => {
            root.classList.remove(cls)
            body.classList.remove(cls)
        })

        // 添加新主题类
        const themeClass = `ai-theme-${theme}`

        root.classList.add(themeClass)
        body.classList.add(themeClass)
        root.setAttribute('data-ai-theme', effectiveTheme)
        body.setAttribute('data-ai-theme', effectiveTheme)

        // 更新所有 AI 容器的类
        const containers = document.querySelectorAll(this.containerSelectors.join(','))
        containers.forEach(container => {
            this.allThemeClasses.forEach(cls => container.classList.remove(cls))
            container.classList.add(themeClass)
            container.setAttribute('data-ai-theme', effectiveTheme)
        })
    }

    /**
     * 刷新所有容器的主题类
     */
    refreshContainers(): void {
        const theme = this.config.get<string>('theme', 'tech') as ThemeType
        this.applyTheme(theme)
    }

    ngOnDestroy(): void {
        // 清理动态样式
        if (this.styleElement?.parentNode) {
            this.styleElement.parentNode.removeChild(this.styleElement)
        }
        this.currentTheme$.complete()
    }
}
