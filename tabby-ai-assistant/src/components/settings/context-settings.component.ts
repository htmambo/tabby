import { Component, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core'
import { Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import { ConfigProviderService } from '../../services/core/config-provider.service'
import { ContextManager } from '../../services/context/manager'
import { ToastService } from '../../services/core/toast.service'
import { TranslateService } from 'tabby-core'
import { ContextConfig, DEFAULT_CONTEXT_CONFIG } from '../../types/ai.types'

@Component({
    selector: 'app-context-settings',
    standalone: false,
    templateUrl: './context-settings.component.html',
    styleUrls: ['./context-settings.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class ContextSettingsComponent implements OnInit, OnDestroy {
    // 配置项
    config: ContextConfig = { ...DEFAULT_CONTEXT_CONFIG }
    autoCompactEnabled = true

    // 当前供应商的上下文限制
    activeProviderContextWindow = 200000

    private destroy$ = new Subject<void>()

    get t() {
        if (!this.translate) {
            return { contextSettings: {}, common: {}, providers: {} }
        }
        return {
            contextSettings: {
                title: this.translate.instant('Context Management'),
                autoCompact: this.translate.instant('Auto Compact'),
                enableAutoCompact: this.translate.instant('Enable Auto Compact'),
                autoCompactDesc: this.translate.instant('Automatically compact history when context exceeds threshold'),
                tokenConfig: this.translate.instant('Token Configuration'),
                currentProviderLimit: this.translate.instant('Current Provider Limit'),
                maxContextTokens: this.translate.instant('Max Context Tokens'),
                maxContextTokensDesc: this.translate.instant('Cannot exceed current provider context limit'),
                reservedOutputTokens: this.translate.instant('Reserved Output Tokens'),
                reservedOutputTokensDesc: this.translate.instant('Token count reserved for AI response'),
                thresholdConfig: this.translate.instant('Compression Threshold'),
                pruneThreshold: this.translate.instant('Prune Threshold'),
                pruneThresholdDesc: this.translate.instant('Prune redundant content when usage exceeds this threshold (default: 70%)'),
                compactThreshold: this.translate.instant('Compact Threshold'),
                compactThresholdDesc: this.translate.instant('Generate summary when usage exceeds this threshold (default: 85%)'),
                messagesToKeep: this.translate.instant('Messages to Keep'),
                messagesToKeepDesc: this.translate.instant('Number of recent messages to always keep during compaction (default: 3)'),
            },
            common: {
                enabled: this.translate.instant('Enabled'),
                disabled: this.translate.instant('Disabled'),
                reset: this.translate.instant('Reset to defaults'),
            },
            providers: {
                saveConfig: this.translate.instant('Save Configuration'),
            },
        }
    }

    constructor(
        private configService: ConfigProviderService,
        private contextManager: ContextManager,
        private toast: ToastService,
        private translate: TranslateService,
    ) {}

    ngOnInit(): void {
        this.loadConfig()
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }

    loadConfig(): void {
        const savedConfig = this.configService.getContextConfig()
        if (savedConfig) {
            this.config = { ...DEFAULT_CONTEXT_CONFIG, ...savedConfig }
        }
        this.autoCompactEnabled = this.configService.isAutoCompactEnabled()

        // 获取当前供应商的上下文限制
        this.activeProviderContextWindow = this.configService.getActiveProviderContextWindow()

        // 确保配置的 maxContextTokens 不超过供应商限制
        if (this.config.maxContextTokens > this.activeProviderContextWindow) {
            this.config.maxContextTokens = this.activeProviderContextWindow
        }
    }

    saveConfig(): void {
        this.configService.setContextConfig(this.config)
        this.contextManager.updateConfig(this.config)
        this.toast.success(this.translate.instant('Context configuration saved'))
    }

    toggleAutoCompact(): void {
        this.autoCompactEnabled = !this.autoCompactEnabled
        this.configService.setAutoCompactEnabled(this.autoCompactEnabled)
        this.toast.info(
            this.autoCompactEnabled
                ? this.translate.instant('Auto-compact enabled')
                : this.translate.instant('Auto-compact disabled'),
        )
    }

    resetToDefaults(): void {
        this.config = { ...DEFAULT_CONTEXT_CONFIG }
        this.autoCompactEnabled = true
        this.saveConfig()
        this.toast.info(this.translate.instant('Reset to defaults'))
    }
}
