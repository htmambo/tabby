import { Component, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { AiAssistantService } from '../../services/core/ai-assistant.service';
import { ConfigProviderService } from '../../services/core/config-provider.service';
import { AiSettingsViewService, AiSettingsTabId } from '../../services/core/ai-settings-view.service';
import { LoggerService } from '../../services/core/logger.service';
import { ToastService } from '../../services/core/toast.service';
import { TranslateService } from '../../i18n';

// 动态读取 package.json 中的版本号
declare const require: (path: string) => any;
const packageJson = require('../../../package.json');
const PLUGIN_VERSION = packageJson.version;

@Component({
    selector: 'app-ai-settings-tab',
    standalone: false,
    templateUrl: './ai-settings-tab.component.html',
    styleUrls: ['./ai-settings-tab.component.scss'],
    encapsulation: ViewEncapsulation.None
})
export class AiSettingsTabComponent implements OnInit, OnDestroy {
    activeTab: AiSettingsTabId = 'general';
    isEnabled = true;
    currentProvider = '';
    providerStatus: any = {};
    pluginVersion: string = PLUGIN_VERSION;

    // 翻译对象
    t: any;

    // Tab 定义（使用翻译 key）
    tabs: { id: AiSettingsTabId; labelKey: string; icon: string }[] = [
        { id: 'providers', labelKey: 'settings.providersTab', icon: 'fa fa-cloud' },
        { id: 'general', labelKey: 'settings.generalTab', icon: 'fa fa-cog' },
        { id: 'context', labelKey: 'settings.contextTab', icon: 'fa fa-database' },
        { id: 'security', labelKey: 'settings.securityTab', icon: 'fa fa-shield' },
        { id: 'chat', labelKey: 'settings.chatTab', icon: 'fa fa-comments' },
        { id: 'mcp', labelKey: 'settings.mcpTab', icon: 'fa fa-plug' },
        { id: 'data', labelKey: 'settings.dataTab', icon: 'fa fa-folder-open' },
        { id: 'proxy', labelKey: 'proxy', icon: 'fa fa-server' },
        { id: 'advanced', labelKey: 'settings.advancedTab', icon: 'fa fa-sliders' }
    ];

    private destroy$ = new Subject<void>();

    constructor(
        private aiService: AiAssistantService,
        private config: ConfigProviderService,
        private settingsView: AiSettingsViewService,
        private logger: LoggerService,
        private toast: ToastService,
        private translate: TranslateService
    ) {
        this.t = this.translate.t;
    }

    ngOnInit(): void {
        this.activeTab = this.settingsView.consumeRequestedTab(this.activeTab);
        this.ensureActiveTab();

        // 监听语言变化
        this.translate.translation$.pipe(
            takeUntil(this.destroy$)
        ).subscribe(translation => {
            this.t = translation;
        });

        this.settingsView.requestedTab$.pipe(
            takeUntil(this.destroy$),
            filter((tab): tab is AiSettingsTabId => !!tab)
        ).subscribe(tab => {
            this.activeTab = tab;
            this.ensureActiveTab();
            this.settingsView.clearRequestedTab();
        });

        this.loadSettings();
        this.loadProviderStatus();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    private ensureActiveTab(): void {
        if (!this.tabs.some(tab => tab.id === this.activeTab)) {
            this.activeTab = 'general';
        }
    }

    /**
     * 加载设置
     */
    private loadSettings(): void {
        this.isEnabled = this.config.isEnabled() !== false;
        const defaultProvider = this.config.getDefaultProvider();
        this.currentProvider = defaultProvider || '';
    }

    /**
     * 加载提供商状态
     */
    private loadProviderStatus(): void {
        try {
            this.providerStatus = this.aiService.getProviderStatus();
        } catch (error) {
            this.providerStatus = { active: null, all: [], count: 0 };
            this.logger.error('Failed to load provider status', error);
        }
    }

    /**
     * 切换标签页
     */
    switchTab(tabId: AiSettingsTabId): void {
        this.activeTab = tabId;
        this.ensureActiveTab();
    }

    /**
     * 切换启用状态
     */
    toggleEnabled(): void {
        this.isEnabled = !this.isEnabled;
        this.config.setEnabled(this.isEnabled);

        if (this.isEnabled) {
            this.logger.info('AI Assistant enabled');
        } else {
            this.logger.info('AI Assistant disabled');
        }
    }

    /**
     * 切换提供商
     */
    switchProvider(providerName: string): void {
        if (this.aiService.switchProvider(providerName)) {
            this.currentProvider = providerName;
            this.config.setDefaultProvider(providerName);
            this.loadProviderStatus();
            this.logger.info('Provider switched', { provider: providerName });
        }
    }

    /**
     * 刷新提供商状态
     */
    async refreshProviderStatus(): Promise<void> {
        this.loadProviderStatus();
        this.logger.debug('Provider status refreshed');
    }

    /**
     * 获取提供商图标类名
     */
    getProviderIcon(providerName: string): string {
        const icons: { [key: string]: string } = {
            'openai': 'fa fa-robot',
            'anthropic': 'fa fa-brain',
            'minimax': 'fa fa-microchip',
            'glm': 'fa fa-language',
            'openai-compatible': 'fa fa-plug'
        };
        return icons[providerName] || 'fa fa-cloud';
    }

    /**
     * 获取提供商状态颜色
     */
    getProviderStatusColor(healthy: boolean): string {
        return healthy ? 'var(--ai-success)' : 'var(--ai-danger)';
    }

    /**
     * 获取提供商状态文本
     */
    getProviderStatusText(healthy: boolean): string {
        return healthy ? this.t.common.enabled : this.t.common.disabled;
    }

    /**
     * 验证配置
     */
    async validateConfig(): Promise<void> {
        try {
            const results = await this.aiService.validateConfig();
            const invalidProviders = results.filter(r => !r.valid);

            if (invalidProviders.length > 0) {
                this.toast.warning(`${this.t.advancedSettings.validateConfig}: ${invalidProviders.length} 个提供商存在配置问题`);
            } else {
                this.toast.success(this.t.providers.testSuccess);
            }
        } catch (error) {
            this.logger.error('Failed to validate config', error);
            this.toast.error(this.t.chatInterface.errorPrefix);
        }
    }

    /**
     * 导出配置
     */
    exportConfig(): void {
        const config = this.config.exportConfig();
        const blob = new Blob([config], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai-assistant-config-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
    }

    /**
     * 导入配置
     */
    importConfig(): void {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (event) => {
            const file = (event.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const config = e.target?.result as string;
                        this.config.importConfig(config);
                        this.toast.success(this.t.providers.configSaved);
                        this.loadSettings();
                        this.loadProviderStatus();
                    } catch (error) {
                        this.toast.error(this.t.chatInterface.errorPrefix);
                    }
                };
                reader.readAsText(file);
            }
        };
        input.click();
    }

    /**
     * 重置为默认配置
     */
    resetToDefaults(): void {
        if (confirm(this.t.chatSettings.resetConfirm)) {
            this.config.reset();
            this.loadSettings();
            this.loadProviderStatus();
            this.activeTab = 'providers';
            this.toast.success(this.t.advancedSettings.resetDefaults || '已重置为默认配置');
        }
    }
}
