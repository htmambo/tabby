import { Component, Output, EventEmitter, OnInit, ViewEncapsulation } from '@angular/core'
import { ConfigProviderService } from '../../services/core/config-provider.service'
import { LoggerService } from '../../services/core/logger.service'
import { ThemeService } from '../../services/core/theme.service'
import { AiSidebarService } from '../../services/chat/ai-sidebar.service'
import { ProviderConfig, PROVIDER_DEFAULTS } from '../../types/provider.types'
import { TranslateService } from 'tabby-core'

@Component({
    selector: 'app-general-settings',
    standalone: false,
    templateUrl: './general-settings.component.html',
    styleUrls: ['./general-settings.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class GeneralSettingsComponent implements OnInit {
    @Output() providerChanged = new EventEmitter<string>()
    @Output() openProvidersTab = new EventEmitter<void>()

    availableProviders: any[] = []
    configuredProviderCount = 0
    selectedProvider = ''
    isEnabled = true
    language = 'zh-CN'
    sidebarPosition: 'left' | 'right' = 'right'

    // 本地供应商状态缓存
    private localProviderStatus: Record<string, { text: string; color: string; icon: string; time: number }> = {}
    private readonly statusCacheDuration = 30000 // 30秒缓存
    private readonly localProviders = ['ollama', 'vllm']
    get t(): any {
        if (!this.translate) {
            return { general: {}, providers: {}, security: {}, settings: {} }
        }
        return {
            general: {
                title: this.translate.instant('General'),
                enableAssistant: this.translate.instant('Enable AI Assistant'),
                enableAssistantDesc: this.translate.instant('Enable or disable AI assistant functionality'),
                defaultProvider: this.translate.instant('Default Provider'),
                language: this.translate.instant('Language'),
                sidebarPosition: this.translate.instant('Sidebar Position'),
                sidebarPositionDesc: this.translate.instant('Choose whether AI sidebar appears on left or right'),
                shortcuts: this.translate.instant('Shortcuts'),
                shortcutOpenChat: this.translate.instant('Open Chat'),
                shortcutOpenChatDesc: this.translate.instant('Open AI chat sidebar'),
                shortcutGenerate: this.translate.instant('Generate Code'),
                shortcutGenerateDesc: this.translate.instant('Generate code from selection'),
                shortcutExplain: this.translate.instant('Explain Code'),
                shortcutExplainDesc: this.translate.instant('Explain selected code'),
                shortcutTip: this.translate.instant('Shortcuts can be customized in Tabby settings'),
            },
            providers: {
                title: this.translate.instant('Providers'),
                notConfigured: this.translate.instant('Not configured'),
            },
            security: {
                title: this.translate.instant('Security'),
                accessControl: this.translate.instant('Access Control'),
            },
            settings: { title: this.translate.instant('Settings') },
        }
    }

    languages = [
        { value: 'zh-CN', label: '简体中文', flag: '🇨🇳' },
        { value: 'en-US', label: 'English', flag: '🇺🇸' },
    ]

    sidebarPositions = [
        { value: 'left', label: '左侧', icon: 'fa-arrow-left' },
        { value: 'right', label: '右侧', icon: 'fa-arrow-right' },
    ]

    // 提供商模板，用于显示名称
    private providerNames: Record<string, string> = {
        openai: 'OpenAI',
        anthropic: 'Anthropic Claude',
        minimax: 'Minimax',
        glm: 'GLM (ChatGLM)',
        'openai-compatible': 'OpenAI Compatible',
        ollama: 'Ollama (本地)',
        vllm: 'vLLM (本地)',
    }

    constructor(
        private config: ConfigProviderService,
        private logger: LoggerService,
        private translate: TranslateService,
        private themeService: ThemeService,
        private sidebarService: AiSidebarService,
    ) {}

    ngOnInit(): void {
        this.loadSettings()
        this.loadProviders()
        // 应用当前主题
        this.themeService.applyTheme('tech')
    }

    /**
     * 加载设置
     */
    private loadSettings(): void {
        this.selectedProvider = this.config.getDefaultProvider() ?? ''
        this.isEnabled = this.config.isEnabled() ?? true
        this.language = this.config.get('language', 'zh-CN') ?? 'zh-CN'
        this.sidebarPosition = this.sidebarService.getSidebarPosition()
    }

    /**
     * 更新侧边栏位置
     */
    updateSidebarPosition(position: 'left' | 'right'): void {
        this.sidebarPosition = position
        this.sidebarService.setSidebarPosition(position)
        this.logger.info('Sidebar position updated', { position })
    }

    /**
     * 加载可用提供商 - 支持云端和本地供应商
     */
    private loadProviders(): void {
        const allConfigs = this.config.getAllProviderConfigs()
        this.availableProviders = Object.keys(this.providerNames).map(key => {
            const providerConfig = allConfigs[key]
            const isLocal = this.localProviders.includes(key)

            return {
                name: key,
                displayName: providerConfig?.displayName ?? this.providerNames[key] ?? key,
                description: this.getProviderDescription(key),
                enabled: providerConfig?.enabled !== false,
                isLocal,
                configured: this.isProviderConfigured(key, providerConfig),
            }
        })
        this.configuredProviderCount = this.availableProviders.filter(provider => provider.configured).length

        this.logger.debug('Loaded providers from config', { count: this.availableProviders.length })
    }

    /**
     * 获取供应商描述
     */
    getProviderDescription(key: string): string {
        const descriptions: Record<string, string> = {
            openai: '云端 OpenAI GPT 系列模型',
            anthropic: '云端 Anthropic Claude 系列模型',
            minimax: '云端 Minimax 大模型',
            glm: '云端 智谱 ChatGLM 模型',
            'openai-compatible': '兼容 OpenAI API 的第三方服务',
            ollama: '本地运行的 Ollama 服务 (端口 11434)',
            vllm: '本地运行的 vLLM 服务 (端口 8000)',
        }
        return descriptions[key] ?? `${this.providerNames[key] ?? key} 提供商`
    }

    trackProvider(_index: number, provider: { name: string }): string {
        return provider.name
    }

    trackLanguage(_index: number, language: { value: string }): string {
        return language.value
    }

    trackSidebarPosition(_index: number, position: { value: string }): string {
        return position.value
    }

    private isLocalProvider(providerName: string): boolean {
        return this.localProviders.includes(providerName)
    }

    isProviderConfigured(providerName: string, providerConfig: ProviderConfig | null = null): boolean {
        const config = providerConfig ?? this.config.getProviderConfig(providerName)
        if (!config) {
            return false
        }

        if (this.isLocalProvider(providerName)) {
            return !!config.baseURL
        }

        return !!config.apiKey
    }

    getProviderLabel(providerName: string): string {
        if (!providerName) {
            return '未选择'
        }

        return this.config.getProviderConfig(providerName)?.displayName ?? this.providerNames[providerName] ?? providerName
    }

    getProviderEndpoint(providerName: string): string {
        const config = this.getEffectiveProviderConfig(providerName)
        return config?.baseURL ?? this.translate.instant('Not Configured')
    }

    getProviderModel(providerName: string): string {
        const config = this.getEffectiveProviderConfig(providerName)
        return config?.model ?? this.translate.instant('Not Configured')
    }

    isApiKeyMissing(providerName: string): boolean {
        if (!this.isProviderConfigured(providerName)) {
            const summary = this.getProviderSecretSummary(providerName)
            return !summary.includes(this.translate.instant('Not Required')) &&
                   !summary.includes(this.translate.instant('Optional'))
        }
        return false
    }

    getProviderSecretSummary(providerName: string): string {
        const providerConfig = this.config.getProviderConfig(providerName)

        if (providerName === 'ollama') {
            return this.translate.instant('Local service does not require API Key')
        }

        if (!providerConfig?.apiKey) {
            return providerName === 'vllm' ? this.translate.instant('Not Set (Optional)') : this.translate.instant('Not Configured')
        }

        return this.maskSecret(providerConfig.apiKey)
    }

    getProviderSummaryHint(providerName: string): string {
        if (!providerName) {
            return this.translate.instant('Please select an AI provider before continuing configuration.')
        }

        if (this.isProviderConfigured(providerName)) {
            return this.translate.instant('To modify API endpoint, key or detailed connection parameters, go to AI Providers tab.')
        }

        return this.isLocalProvider(providerName)
            ? this.translate.instant('Current provider connection not configured. Go to AI Providers tab to fill in Base URL and model.')
            : this.translate.instant('Current provider connection not configured. Go to AI Providers tab to fill in Base URL, Model and API Key.')
    }

    getCurrentProviderStatus(providerName: string = this.selectedProvider): { text: string; color: string; icon: string } {
        if (!providerName) {
            return { text: '未选择', color: '#9e9e9e', icon: 'fa-question-circle' }
        }

        return this.isLocalProvider(providerName)
            ? this.getLocalProviderStatus(providerName)
            : this.getProviderStatus(providerName)
    }

    openProviderConfiguration(): void {
        this.openProvidersTab.emit()
    }

    /**
     * 获取云端提供商状态（同步返回）
     */
    getProviderStatus(providerName: string): { text: string; color: string; icon: string } {
        const providerConfig = this.config.getProviderConfig(providerName)
        if (providerConfig?.apiKey) {
            return {
                text: providerConfig.enabled !== false ? '已启用' : '已禁用',
                color: providerConfig.enabled !== false ? '#4caf50' : '#ff9800',
                icon: providerConfig.enabled !== false ? 'fa-check-circle' : 'fa-pause-circle',
            }
        }
        return { text: '未配置', color: '#9e9e9e', icon: 'fa-question-circle' }
    }

    /**
     * 检测本地供应商状态（异步）
     */
    private async checkLocalProviderStatus(providerName: string): Promise<boolean> {
        const urls: Record<string, string> = {
            ollama: 'http://localhost:11434/v1/models',
            vllm: 'http://localhost:8000/v1/models',
        }

        let timeoutId: number | null = null
        try {
            const controller = new AbortController()
            timeoutId = window.setTimeout(() => controller.abort(), 2000)

            const response = await fetch(urls[providerName], {
                method: 'GET',
                signal: controller.signal,
            })

            return response.ok
        } catch {
            return false
        } finally {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId)
            }
        }
    }

    /**
     * 获取本地供应商状态（同步返回，异步更新缓存）
     */
    getLocalProviderStatus(providerName: string): { text: string; color: string; icon: string } {
        const now = Date.now()
        const cached = this.localProviderStatus[providerName]

        // 检查缓存是否有效（30秒内）
        if (cached && (now - cached.time) < this.statusCacheDuration) {
            return { text: cached.text, color: cached.color, icon: cached.icon }
        }

        // 返回默认状态并异步更新
        const defaultStatus = { text: '检测中...', color: '#ff9800', icon: 'fa-spinner fa-spin' }
        this.localProviderStatus[providerName] = { ...defaultStatus, time: now }

        // 异步检查实际状态
        this.checkLocalProviderStatus(providerName).then(isOnline => {
            const status = isOnline
                ? { text: '在线', color: '#4caf50', icon: 'fa-check-circle', time: now }
                : { text: '离线', color: '#f44336', icon: 'fa-times-circle', time: now }
            this.localProviderStatus[providerName] = status
            this.logger.debug('Local provider status updated', { provider: providerName, isOnline })
        }).catch(() => {
            const status = { text: '离线', color: '#f44336', icon: 'fa-times-circle', time: now }
            this.localProviderStatus[providerName] = status
        })

        return defaultStatus
    }

    /**
     * 更新默认提供商
     */
    updateDefaultProvider(providerName: string): void {
        this.selectedProvider = providerName
        this.config.setDefaultProvider(providerName)
        this.providerChanged.emit(providerName)
        this.logger.info('Default provider updated', { provider: providerName })
    }

    /**
     * 更新启用状态
     */
    updateEnabled(enabled: boolean): void {
        this.isEnabled = enabled
        this.config.setEnabled(enabled)
        this.logger.info('AI Assistant enabled state changed', { enabled })
    }

    /**
     * 更新语言
     */
    updateLanguage(language: string): void {
        this.language = language
        this.translate.use(language)
        this.logger.info('Language updated', { language })
    }

    private getEffectiveProviderConfig(providerName: string): ProviderConfig | null {
        if (!providerName) {
            return null
        }

        const storedConfig = this.config.getProviderConfig(providerName)
        const defaults = PROVIDER_DEFAULTS[providerName]

        if (!storedConfig && !defaults) {
            return null
        }

        return {
            name: providerName,
            displayName: storedConfig?.displayName ?? this.providerNames[providerName] ?? providerName,
            apiKey: storedConfig?.apiKey,
            baseURL: storedConfig?.baseURL ?? defaults?.baseURL ?? '',
            model: storedConfig?.model ?? defaults?.model ?? '',
            maxTokens: storedConfig?.maxTokens ?? defaults?.maxTokens,
            temperature: storedConfig?.temperature ?? defaults?.temperature,
            timeout: storedConfig?.timeout ?? defaults?.timeout,
            retries: storedConfig?.retries ?? defaults?.retries,
            authConfig: storedConfig?.authConfig ?? defaults?.authConfig,
            enabled: storedConfig?.enabled ?? true,
            contextWindow: storedConfig?.contextWindow ?? defaults?.contextWindow,
            disableStreaming: storedConfig?.disableStreaming ?? false,
        }
    }

    private maskSecret(secret: string): string {
        if (secret.length <= 8) {
            return `${secret.slice(0, 2)}***`
        }

        return `${secret.slice(0, 4)}...${secret.slice(-4)}`
    }
}
