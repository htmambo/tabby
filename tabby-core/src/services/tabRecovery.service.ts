import { Injectable, Inject } from '@angular/core'
import { TabRecoveryProvider, RecoveryToken } from '../api/tabRecovery'
import { BaseTabComponent, GetRecoveryTokenOptions } from '../components/baseTab.component'
import { Logger, LogService } from './log.service'
import { ConfigService } from './config.service'
import { NewTabParameters } from './tabs.service'

const ACTIVE_TOP_LEVEL_MARKER = '__tabbyActiveTopLevel'

interface RecoveredTabsState {
    tabs: NewTabParameters<BaseTabComponent>[]
    activeTabIndex: number|null
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class TabRecoveryService {
    logger: Logger
    enabled = false

    private constructor (
        @Inject(TabRecoveryProvider) private tabRecoveryProviders: TabRecoveryProvider<BaseTabComponent>[]|null,
        private config: ConfigService,
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
            token.disableDynamicTitle = tab['disableDynamicTitle']
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
            const tabs: NewTabParameters<BaseTabComponent>[] = []
            let activeTabIndex: number|null = null
            const savedState = JSON.parse(window.localStorage.tabsRecovery)
            const savedTabs = Array.isArray(savedState) ? savedState : savedState?.tabs ?? []
            for (const token of savedTabs) {
                const tab = await this.recoverTab(token)
                if (!tab) {
                    continue
                }
                if (token?.[ACTIVE_TOP_LEVEL_MARKER]) {
                    activeTabIndex = tabs.length
                }
                tabs.push(tab)
            }
            return { tabs, activeTabIndex }
        }
        return { tabs: [], activeTabIndex: null }
    }
}
