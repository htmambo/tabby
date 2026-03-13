import { Component, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core'
import { Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import { ConfigProviderService } from '../../services/core/config-provider.service'
import { LoggerService } from '../../services/core/logger.service'
import { TranslateService } from 'tabby-core'

@Component({
    selector: 'app-security-settings',
    standalone: false,
    templateUrl: './security-settings.component.html',
    styleUrls: ['./security-settings.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class SecuritySettingsComponent implements OnInit, OnDestroy {
    settings = {
        enablePasswordProtection: false,
        enableRiskAssessment: true,
        defaultRiskLevel: 'medium',
        enableConsentPersistence: true,
        consentExpiryDays: 30,
        autoApproveLowRisk: true,
        promptForMediumRisk: true,
        requirePasswordForHighRisk: true,
    }

    // 缺失的变量
    password = ''
    newPattern = ''

    dangerousPatterns = [
        'rm -rf /',
        'sudo rm',
        'format',
        'dd if=',
        'fork(',
    ]

    private destroy$ = new Subject<void>()

    get t() {
        if (!this.translate) {
            return { security: {}, common: {} }
        }
        return {
            security: {
                title: this.translate.instant('Security'),
                accessControl: this.translate.instant('Access Control'),
                passwordProtection: this.translate.instant('Password Protection'),
                passwordProtectionDesc: this.translate.instant('Require password to access AI assistant'),
                setPassword: this.translate.instant('Set Password'),
                passwordPlaceholder: this.translate.instant('Enter password'),
                riskAssessment: this.translate.instant('Risk Assessment'),
                riskAssessmentDesc: this.translate.instant('Automatically assess command risk level'),
                defaultRiskLevel: this.translate.instant('Default Risk Level'),
                riskLow: this.translate.instant('Low'),
                riskMedium: this.translate.instant('Medium'),
                riskHigh: this.translate.instant('High'),
                userConsent: this.translate.instant('User Consent'),
                rememberConsent: this.translate.instant('Remember Consent'),
                rememberConsentDesc: this.translate.instant('Remember user consent for'),
                consentExpiryDays: this.translate.instant('days'),
                dangerousPatterns: this.translate.instant('Dangerous Patterns'),
                patternPlaceholder: this.translate.instant('Enter dangerous pattern'),
                addPattern: this.translate.instant('Add Pattern'),
                resetDefaults: this.translate.instant('Reset Defaults'),
            },
            common: {
                enabled: this.translate.instant('Enabled'),
                disabled: this.translate.instant('Disabled'),
                save: this.translate.instant('Save'),
            },
        }
    }

    constructor(
        private config: ConfigProviderService,
        private logger: LoggerService,
        private translate: TranslateService,
    ) {}

    ngOnInit(): void {
        this.loadSettings()
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }

    private loadSettings(): void {
        const securityConfig = this.config.getSecurityConfig()
        this.settings = { ...this.settings, ...securityConfig }
    }

    updateSetting(key: string, value: unknown): void {
        (this.settings as any)[key] = value
        this.config.updateSecurityConfig({ [key]: value })
        this.logger.debug('Security setting updated', { key, value })
    }

    addDangerousPattern(pattern: string): void {
        if (pattern && !this.dangerousPatterns.includes(pattern)) {
            this.dangerousPatterns.push(pattern)
            this.newPattern = ''
        }
    }

    removeDangerousPattern(index: number): void {
        this.dangerousPatterns.splice(index, 1)
    }

    saveSettings(): void {
        this.config.updateSecurityConfig(this.settings)
        this.logger.info('Security settings saved', this.settings)
    }

    resetToDefaults(): void {
        if (confirm(this.translate.instant('Reset to defaults?'))) {
            this.settings = {
                enablePasswordProtection: false,
                enableRiskAssessment: true,
                defaultRiskLevel: 'medium',
                enableConsentPersistence: true,
                consentExpiryDays: 30,
                autoApproveLowRisk: true,
                promptForMediumRisk: true,
                requirePasswordForHighRisk: true,
            }
            this.config.updateSecurityConfig(this.settings)
        }
    }
}
