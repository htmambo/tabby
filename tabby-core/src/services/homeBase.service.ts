import { Injectable, Inject } from '@angular/core'
import { ConfigService } from './config.service'
import { getRuntimeArch, getRuntimePlatform } from '../api/rendererRuntime'
import { PlatformService, BOOTSTRAP_DATA, BootstrapData, HostAppService } from '../api'

@Injectable({ providedIn: 'root' })
export class HomeBaseService {
    appVersion: string
    mixpanel: any
    private analyticsInitPromise: Promise<void> | null = null

    /** @hidden */
    private constructor (
        private config: ConfigService,
        private platform: PlatformService,
        private hostApp: HostAppService,
        @Inject(BOOTSTRAP_DATA) private bootstrapData: BootstrapData,
    ) {
        this.appVersion = platform.getAppVersion()

        if (this.config.store.enableAnalytics && !this.config.store.enableWelcomeTab) {
            void this.enableAnalytics()
        }
    }

    openGitHub (): void {
        this.platform.openExternal('https://github.com/htmambo/tabby')
    }

    openDiscord (): void {
        this.platform.openExternal('https://discord.gg/Vn7BjmzhtF')
    }

    openTranslations (): void {
        this.platform.openExternal('https://translate.tabby.sh/project/tabby')
    }

    reportBug (): void {
        let body = `Version: ${this.appVersion}\n`
        body += `Platform: ${this.hostApp.platform} ${getRuntimeArch()} ${this.platform.getOSRelease()}\n`
        const plugins = this.bootstrapData.installedPlugins.filter(x => !x.isBuiltin).map(x => x.name)
        body += `Plugins: ${plugins.join(', ') || 'none'}\n`
        body += `Frontend: ${this.config.store.terminal?.frontend}\n\n`
        this.platform.openExternal(`https://github.com/htmambo/tabby/issues/new?body=${encodeURIComponent(body)}`)
    }

    async enableAnalytics (): Promise<void> {
        if (this.mixpanel) {
            return
        }
        this.analyticsInitPromise ??= this.initializeAnalytics()
        await this.analyticsInitPromise
    }

    private async initializeAnalytics (): Promise<void> {
        const [mixpanelModule, uuidModule] = await Promise.all([
            import('mixpanel'),
            import('uuid'),
        ])
        const mixpanel = (mixpanelModule.default ?? mixpanelModule) as any
        const uuidv4 = uuidModule.v4
        if (!window.localStorage.analyticsUserID) {
            window.localStorage.analyticsUserID = uuidv4()
        }
        this.mixpanel = mixpanel.init('bb4638b0860eef14c04d4fbc5eb365fa')
        if (!window.localStorage.installEventSent) {
            this.mixpanel.track('freshInstall', this.getAnalyticsProperties())
            window.localStorage.installEventSent = true
        }
        this.mixpanel.track('launch', this.getAnalyticsProperties())
    }

    getAnalyticsProperties (): Record<string, string> {
        return {
            distinct_id: window.localStorage.analyticsUserID,
            platform: getRuntimePlatform(),
            os: this.platform.getOSRelease(),
            version: this.appVersion,
        }
    }
}
