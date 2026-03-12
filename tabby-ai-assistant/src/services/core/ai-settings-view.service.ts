import { Injectable } from '@angular/core'
import { BehaviorSubject } from 'rxjs'

export type AiSettingsTabId =
    | 'providers'
    | 'general'
    | 'context'
    | 'security'
    | 'chat'
    | 'mcp'
    | 'data'
    | 'proxy'
    | 'advanced'

/**
 * 管理 AI 设置页内部标签导航，确保不同入口可以跳到合适的子页。
 */
@Injectable({ providedIn: 'root' })
export class AiSettingsViewService {
    private requestedTab: AiSettingsTabId | null = null
    private readonly requestedTabSubject = new BehaviorSubject<AiSettingsTabId | null>(null)

    readonly requestedTab$ = this.requestedTabSubject.asObservable()

    requestTab(tabId: AiSettingsTabId): void {
        this.requestedTab = tabId
        this.requestedTabSubject.next(tabId)
    }

    consumeRequestedTab(fallback: AiSettingsTabId = 'providers'): AiSettingsTabId {
        const tab = this.requestedTab ?? fallback
        this.clearRequestedTab()
        return tab
    }

    clearRequestedTab(): void {
        this.requestedTab = null
        this.requestedTabSubject.next(null)
    }
}
