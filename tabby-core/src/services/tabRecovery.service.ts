import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Injectable, Inject } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { TabRecoveryProvider, RecoveryToken } from '../api/tabRecovery'
import { BaseTabComponent, GetRecoveryTokenOptions } from '../components/baseTab.component'
import { Logger, LogService } from './log.service'
import { ConfigService } from './config.service'
import { NewTabParameters } from './tabs.service'

const ACTIVE_TOP_LEVEL_MARKER = '__tabbyActiveTopLevel'

interface RecoveryEntryDetails {
    detail: string
    secondaryDetail: string|null
}

export interface RecoveredTabEntry {
    tab: NewTabParameters<BaseTabComponent>
    title: string
    detail: string
    secondaryDetail: string|null
    icon: string|null
    color: string|null
    wasActive: boolean
}

export interface RecoveredTabsState {
    tabs: NewTabParameters<BaseTabComponent>[]
    activeTabIndex: number|null
    entries: RecoveredTabEntry[]
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class TabRecoveryService {
    logger: Logger
    enabled = false

    private constructor (
        @Inject(TabRecoveryProvider) private tabRecoveryProviders: TabRecoveryProvider<BaseTabComponent>[]|null,
        private config: ConfigService,
        private translate: TranslateService,
        log: LogService,
    ) {
        this.logger = log.create('tabRecovery')
    }

    async saveTabs (tabs: BaseTabComponent[], activeTab: BaseTabComponent|null = null): Promise<void> {
        if (!this.enabled || !this.config.store.recoverTabs) {
            return
        }

        const serializedTabs: RecoveryToken[] = []
        for (const tab of tabs) {
            const token = await this.getFullRecoveryToken(tab, { includeState: true })
            if (!token) {
                continue
            }
            if (tab === activeTab) {
                token[ACTIVE_TOP_LEVEL_MARKER] = true
            }
            serializedTabs.push(token)
        }

        window.localStorage.tabsRecovery = JSON.stringify(serializedTabs)
    }

    async getFullRecoveryToken (tab: BaseTabComponent, options?: GetRecoveryTokenOptions): Promise<RecoveryToken|null> {
        const token = await tab.getRecoveryToken(options)
        if (token) {
            token.tabTitle = tab.title
            token.tabCustomTitle = tab.customTitle
            if (tab.icon) {
                token.tabIcon = tab.icon
            }
            if (tab.color) {
                token.tabColor = tab.color
            }
            token.disableDynamicTitle = (tab as { disableDynamicTitle?: boolean }).disableDynamicTitle
        }
        return token
    }

    async recoverTab (token: RecoveryToken): Promise<NewTabParameters<BaseTabComponent>|null> {
        for (const provider of this.config.enabledServices(this.tabRecoveryProviders ?? [])) {
            try {
                if (!await provider.applicableTo(token)) {
                    continue
                }
                const tab = await provider.recover(token)
                tab.inputs = tab.inputs ?? {}
                tab.inputs.icon = token.tabIcon ?? null
                tab.inputs.color = token.tabColor ?? null
                tab.inputs.title = token.tabTitle || ''
                tab.inputs.customTitle = token.tabCustomTitle || ''
                tab.inputs.disableDynamicTitle = token.disableDynamicTitle
                return tab
            } catch (error) {
                this.logger.warn('Tab recovery crashed:', token, provider, error)
            }
        }
        return null
    }

    async recoverTabs (): Promise<RecoveredTabsState> {
        if (window.localStorage.tabsRecovery) {
            const entries: RecoveredTabEntry[] = []
            let activeTabIndex: number|null = null
            const savedState = JSON.parse(window.localStorage.tabsRecovery)
            const savedTabs = Array.isArray(savedState) ? savedState : savedState?.tabs ?? []
            for (const token of savedTabs) {
                const tab = await this.recoverTab(token)
                if (!tab) {
                    continue
                }
                const wasActive = !!token?.[ACTIVE_TOP_LEVEL_MARKER]
                if (wasActive) {
                    activeTabIndex = entries.length
                }
                const details = this.getRecoveryEntryDetails(token)
                entries.push({
                    tab,
                    title: this.getRecoveryEntryTitle(token, tab, details),
                    detail: details.detail,
                    secondaryDetail: details.secondaryDetail,
                    icon: token?.tabIcon ?? null,
                    color: token?.tabColor ?? null,
                    wasActive,
                })
            }
            return {
                tabs: entries.map(entry => entry.tab),
                activeTabIndex,
                entries,
            }
        }
        return { tabs: [], activeTabIndex: null, entries: [] }
    }

    private getRecoveryEntryTitle (
        token: RecoveryToken,
        tab: NewTabParameters<BaseTabComponent>,
        details: RecoveryEntryDetails,
    ): string {
        const customTitle = typeof token?.tabCustomTitle === 'string' ? token.tabCustomTitle.trim() : ''
        if (customTitle) {
            return customTitle
        }

        const candidates = [
            typeof token?.tabTitle === 'string' ? token.tabTitle.trim() : '',
            typeof tab.inputs?.title === 'string' ? tab.inputs.title.trim() : '',
            details.detail,
        ]

        for (const candidate of candidates) {
            if (!candidate) {
                continue
            }
            const sanitized = this.stripDuplicatedPathFromTitle(candidate, details.detail)
            if (sanitized) {
                return sanitized
            }
        }

        return details.detail
    }

    private stripDuplicatedPathFromTitle (title: string, detail: string): string {
        if (!title || !this.looksLikeFilesystemPath(detail)) {
            return title
        }

        const duplicatedSegment = `:${detail}`
        const duplicatedSegmentIndex = title.lastIndexOf(duplicatedSegment)
        if (duplicatedSegmentIndex === -1) {
            return title
        }

        const stripped = `${title.slice(0, duplicatedSegmentIndex)}${title.slice(duplicatedSegmentIndex + duplicatedSegment.length)}`
            .split('|')
            .map(part => part.trim())
            .filter(Boolean)
            .join(' | ')

        return stripped || title
    }

    private looksLikeFilesystemPath (value: string): boolean {
        return value.startsWith('/')
            || value.startsWith('~/')
            || value.startsWith('\\')
            || /^[A-Za-z]:[\\/]/.test(value)
    }

    private getRecoveryEntryDetails (token: RecoveryToken): RecoveryEntryDetails {
        const options = token?.profile?.options ?? {}

        switch (token.type) {
            case 'app:local-tab':
                return {
                    detail: this.getLocalRecoveryEntryDetail(options),
                    secondaryDetail: null,
                }
            case 'app:ssh-tab':
                return {
                    detail: this.getSSHRecoveryEntryDetail(options),
                    secondaryDetail: null,
                }
            case 'app:serial-tab':
                return {
                    detail: this.getSerialRecoveryEntryDetail(options),
                    secondaryDetail: null,
                }
            case 'app:telnet-tab':
                return {
                    detail: this.getTelnetRecoveryEntryDetail(options),
                    secondaryDetail: null,
                }
            default:
                return {
                    detail: this.humanizeRecoveryType(token.type),
                    secondaryDetail: null,
                }
        }
    }

    private getLocalRecoveryEntryDetail (options: Record<string, any>): string {
        return options.cwd || this.translate.instant(_('Local shell'))
    }

    private getSSHRecoveryEntryDetail (options: Record<string, any>): string {
        if (!options.host) {
            return this.translate.instant(_('SSH session'))
        }
        const userPrefix = options.user ? `${options.user}@` : ''
        const portSuffix = `:${options.port ?? 22}`
        return `${userPrefix}${options.host}${portSuffix}`
    }

    private getSerialRecoveryEntryDetail (options: Record<string, any>): string {
        if (!options.port) {
            return this.translate.instant(_('Serial session'))
        }
        if (options.baudrate) {
            return `${options.port} @ ${options.baudrate}`
        }
        return options.port
    }

    private getTelnetRecoveryEntryDetail (options: Record<string, any>): string {
        if (!options.host) {
            return this.translate.instant(_('Telnet session'))
        }
        return `${options.host}:${options.port ?? 23}`
    }

    private humanizeRecoveryType (type: string): string {
        return type
            .replace(/^app:/, '')
            .replace(/-tab$/, '')
            .split('-')
            .filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1))
            .join(' ')
    }
}
