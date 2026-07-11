import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Injectable, Inject } from '@angular/core'
import { TranslateService } from '@ngx-translate/core'
import { TabRecoveryProvider, RecoveryToken } from '../api/tabRecovery'
import { BaseTabComponent, GetRecoveryTokenOptions } from '../components/baseTab.component'
import { Logger, LogService } from './log.service'
import { ConfigService } from './config.service'
import { NewTabParameters } from './tabs.service'

const ACTIVE_TOP_LEVEL_MARKER = '__tabbyActiveTopLevel'
const RECOVERY_STORAGE_KEY = 'tabsRecovery'
const ACTIVE_TAB_INDEX_STORAGE_KEY = 'tabsRecoveryActiveTabIndex'

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

export interface SaveTabsOptions extends Partial<GetRecoveryTokenOptions> {
    changedTabs?: BaseTabComponent[]
    recoveryScrollbackLines?: number
    maxStateChars?: number
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class TabRecoveryService {
    logger: Logger
    enabled = false
    private cachedTokens = new Map<BaseTabComponent, RecoveryToken>()
    private cachedTokenSnapshots = new Map<BaseTabComponent, string>()
    private lastPersistedTabsOrder: BaseTabComponent[]|null = null
    private lastPersistedActiveTabIndex: number|null|undefined

    private constructor (
        @Inject(TabRecoveryProvider) private tabRecoveryProviders: TabRecoveryProvider<BaseTabComponent>[]|null,
        private config: ConfigService,
        private translate: TranslateService,
        log: LogService,
    ) {
        this.logger = log.create('tabRecovery')
    }

    async saveTabs (tabs: BaseTabComponent[], activeTab: BaseTabComponent|null = null, options: SaveTabsOptions = {}): Promise<void> {
        if (!this.enabled || !this.config.store.recoverTabs) {
            return
        }

        const changedTabs = options.changedTabs ?? tabs
        let tabsStorageDirty = this.hasPersistedTabsOrderChanged(tabs)
        for (const tab of changedTabs) {
            if (!tabs.includes(tab)) {
                tabsStorageDirty = this.dropCachedTabState(tab) || tabsStorageDirty
                continue
            }
            const token = await this.getFullRecoveryToken(tab, {
                includeState: options.includeState ?? true,
                recoveryScrollbackLines: options.recoveryScrollbackLines,
            } as GetRecoveryTokenOptions & { recoveryScrollbackLines?: number })
            const sanitizedToken = this.sanitizeRecoveryToken(token, options.maxStateChars)
            if (!sanitizedToken) {
                tabsStorageDirty = this.dropCachedTabState(tab) || tabsStorageDirty
                continue
            }

            const serializedToken = this.serializeRecoveryToken(sanitizedToken)
            if (serializedToken === null) {
                tabsStorageDirty = this.dropCachedTabState(tab) || tabsStorageDirty
                continue
            }

            if (this.cachedTokenSnapshots.get(tab) === serializedToken) {
                continue
            }

            this.cachedTokens.set(tab, sanitizedToken)
            this.cachedTokenSnapshots.set(tab, serializedToken)
            tabsStorageDirty = true
        }

        for (const cachedTab of Array.from(this.cachedTokens.keys())) {
            if (!tabs.includes(cachedTab)) {
                tabsStorageDirty = this.dropCachedTabState(cachedTab) || tabsStorageDirty
            }
        }

        if (typeof localStorage === 'undefined') {
            return
        }

        let tabsStorageSynchronized = !tabsStorageDirty
        if (tabsStorageDirty) {
            try {
                localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(this.buildSerializedTabs(tabs)))
                this.lastPersistedTabsOrder = [...tabs]
                tabsStorageSynchronized = true
            } catch (error) {
                this.logger.warn('Failed to persist tab recovery state', error)
            }
        }

        if (tabsStorageSynchronized) {
            this.persistActiveTabIndex(tabs, activeTab)
        }
    }

    dropCachedTab (tab: BaseTabComponent): void {
        this.dropCachedTabState(tab)
    }

    async getFullRecoveryToken (tab: BaseTabComponent, options?: GetRecoveryTokenOptions): Promise<RecoveryToken|null> {
        const token = await tab.getRecoveryToken(options)
        if (token) {
            token.tabTitle = tab.title
            token.tabCustomTitle = tab.customTitle
            token.tabPinned = tab.pinned
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

    private buildSerializedTabs (tabs: BaseTabComponent[]): RecoveryToken[] {
        const serializedTabs: RecoveryToken[] = []
        for (const tab of tabs) {
            const token = this.cachedTokens.get(tab)
            if (!token) {
                continue
            }
            serializedTabs.push({ ...token })
        }
        return serializedTabs
    }

    private sanitizeRecoveryToken (token: RecoveryToken|null, maxStateChars?: number): RecoveryToken|null {
        if (!token) {
            return null
        }
        if (
            maxStateChars !== undefined &&
            typeof token.savedState === 'string' &&
            token.savedState.length > maxStateChars
        ) {
            const sanitizedToken = { ...token }
            delete sanitizedToken.savedState
            return sanitizedToken
        }
        return token
    }

    private serializeRecoveryToken (token: RecoveryToken): string|null {
        try {
            return JSON.stringify(token)
        } catch (error) {
            this.logger.warn('Failed to serialize tab recovery token', error)
            return null
        }
    }

    private dropCachedTabState (tab: BaseTabComponent): boolean {
        const tokenDeleted = this.cachedTokens.delete(tab)
        const snapshotDeleted = this.cachedTokenSnapshots.delete(tab)
        return tokenDeleted || snapshotDeleted
    }

    private hasPersistedTabsOrderChanged (tabs: BaseTabComponent[]): boolean {
        if (this.lastPersistedTabsOrder === null) {
            return true
        }
        if (tabs.length !== this.lastPersistedTabsOrder.length) {
            return true
        }
        return tabs.some((tab, index) => this.lastPersistedTabsOrder?.[index] !== tab)
    }

    private getActiveTabIndex (tabs: BaseTabComponent[], activeTab: BaseTabComponent|null): number|null {
        if (!activeTab) {
            return null
        }
        const activeTabIndex = tabs.indexOf(activeTab)
        return activeTabIndex === -1 ? null : activeTabIndex
    }

    private persistActiveTabIndex (tabs: BaseTabComponent[], activeTab: BaseTabComponent|null): void {
        const activeTabIndex = this.getActiveTabIndex(tabs, activeTab)
        if (this.lastPersistedActiveTabIndex === activeTabIndex) {
            return
        }

        try {
            if (activeTabIndex === null) {
                localStorage.removeItem(ACTIVE_TAB_INDEX_STORAGE_KEY)
            } else {
                localStorage.setItem(ACTIVE_TAB_INDEX_STORAGE_KEY, `${activeTabIndex}`)
            }
            this.lastPersistedActiveTabIndex = activeTabIndex
        } catch (error) {
            this.logger.warn('Failed to persist active tab recovery index', error)
        }
    }

    private parseActiveTabIndex (rawActiveTabIndex: string|null): number|null {
        if (rawActiveTabIndex === null) {
            return null
        }
        const parsed = Number(rawActiveTabIndex)
        if (!Number.isInteger(parsed) || parsed < 0) {
            return null
        }
        return parsed
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
                tab.inputs.pinned = token.tabPinned ?? false
                tab.inputs.disableDynamicTitle = token.disableDynamicTitle
                return tab
            } catch (error) {
                this.logger.warn('Tab recovery crashed:', token, provider, error)
            }
        }
        return null
    }

    async recoverTabs (): Promise<RecoveredTabsState> {
        if (typeof localStorage === 'undefined') {
            return { tabs: [], activeTabIndex: null, entries: [] }
        }
        const rawState = localStorage.getItem(RECOVERY_STORAGE_KEY)
        if (rawState) {
            const entries: RecoveredTabEntry[] = []
            let markedActiveTabIndex: number|null = null
            const persistedActiveTabIndex = this.parseActiveTabIndex(localStorage.getItem(ACTIVE_TAB_INDEX_STORAGE_KEY))
            let savedState: unknown
            try {
                savedState = JSON.parse(rawState)
            } catch (error) {
                this.logger.warn('Failed to parse tab recovery state', error)
                localStorage.removeItem(RECOVERY_STORAGE_KEY)
                localStorage.removeItem(ACTIVE_TAB_INDEX_STORAGE_KEY)
                return { tabs: [], activeTabIndex: null, entries: [] }
            }
            const savedStateObject = typeof savedState === 'object' && savedState !== null
                ? (savedState as { tabs?: unknown })
                : null
            const savedTabs = Array.isArray(savedState)
                ? savedState
                : Array.isArray(savedStateObject?.tabs) ? savedStateObject?.tabs : []
            for (const token of savedTabs) {
                const tab = await this.recoverTab(token)
                if (!tab) {
                    continue
                }
                const wasActive = !!token?.[ACTIVE_TOP_LEVEL_MARKER]
                if (wasActive) {
                    markedActiveTabIndex = entries.length
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
            const activeTabIndex = persistedActiveTabIndex !== null && persistedActiveTabIndex < entries.length
                ? persistedActiveTabIndex
                : markedActiveTabIndex
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
