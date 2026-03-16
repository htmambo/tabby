import { Injectable, Inject, OnDestroy } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { Observable, Subject, AsyncSubject, takeUntil, debounceTime, lastValueFrom } from 'rxjs'

import { BaseTabComponent, GetRecoveryTokenOptions } from '../components/baseTab.component'
import { RenameTabModalComponent } from '../components/renameTabModal.component'
import { StartupTabsRecoveryModalComponent } from '../components/startupTabsRecoveryModal.component'
import { SelectorOption } from '../api/selector'
import { RecoveryToken } from '../api/tabRecovery'
import { BootstrapData, BOOTSTRAP_DATA } from '../api/mainProcess'
import { HostWindowService } from '../api/hostWindow'
import { HostAppService } from '../api/hostApp'

import { ConfigService } from './config.service'
import { RecoveredTabsState, TabRecoveryService } from './tabRecovery.service'
import { TabsService, NewTabParameters } from './tabs.service'
import { SelectorService } from './selector.service'

const CLOSED_TAB_RECOVERY_SCROLLBACK_LINES = 200
const CLOSED_TAB_RECOVERY_MAX_STATE_CHARS = 256 * 1024

class CompletionObserver {
    get done$ (): Observable<void> { return this.done }
    get destroyed$ (): Observable<void> { return this.destroyed }
    private done = new AsyncSubject<void>()
    private destroyed = new AsyncSubject<void>()
    private interval: number

    constructor (private tab: BaseTabComponent) {
        this.interval = setInterval(() => this.tick(), 1000) as any
        this.tab.destroyed$.pipe(takeUntil(this.destroyed$)).subscribe(() => this.stop())
    }

    async tick () {
        if (!await this.tab.getCurrentProcess()) {
            this.done.next()
            this.stop()
        }
    }

    stop () {
        clearInterval(this.interval)
        this.destroyed.next()
        this.destroyed.complete()
        this.done.complete()
    }
}

@Injectable({ providedIn: 'root' })
export class AppService implements OnDestroy {
    tabs: BaseTabComponent[] = []

    get activeTab (): BaseTabComponent|null { return this._activeTab ?? null }

    private lastTabIndex = 0
    private _activeTab: BaseTabComponent | null = null
    private closedTabsStack: RecoveryToken[] = []

    private activeTabChange = new Subject<BaseTabComponent|null>()
    private tabsChanged = new Subject<void>()
    private tabOpened = new Subject<BaseTabComponent>()
    private tabRemoved = new Subject<BaseTabComponent>()
    private tabClosed = new Subject<BaseTabComponent>()
    private tabDragActive = new Subject<BaseTabComponent|null>()
    private ready = new AsyncSubject<void>()
    private tabsRestored = new AsyncSubject<void>()
    private recoveryStateChangedHint = new Subject<void>()

    private completionObservers = new Map<BaseTabComponent, CompletionObserver>()
    private recoveryHintInterval: ReturnType<typeof setInterval> | null = null

    get activeTabChange$ (): Observable<BaseTabComponent|null> { return this.activeTabChange }
    get tabOpened$ (): Observable<BaseTabComponent> { return this.tabOpened }
    get tabsChanged$ (): Observable<void> { return this.tabsChanged }
    get tabRemoved$ (): Observable<BaseTabComponent> { return this.tabRemoved }
    get tabClosed$ (): Observable<BaseTabComponent> { return this.tabClosed }
    get tabDragActive$ (): Observable<BaseTabComponent|null> { return this.tabDragActive }

    /** Fires once when saved tabs are restored */
    get tabsRestored$ (): Observable<void> { return this.tabsRestored }

    /** Fires once when the app is ready */
    get ready$ (): Observable<void> { return this.ready }

    /** @hidden */
    private constructor (
        private config: ConfigService,
        private hostApp: HostAppService,
        private hostWindow: HostWindowService,
        private tabRecovery: TabRecoveryService,
        private tabsService: TabsService,
        private selector: SelectorService,
        private ngbModal: NgbModal,
        @Inject(BOOTSTRAP_DATA) private bootstrapData: BootstrapData,
    ) {
        this.tabsChanged$.subscribe(() => {
            this.recoveryStateChangedHint.next()
        })

        this.activeTabChange$.subscribe(() => {
            this.recoveryStateChangedHint.next()
        })

        this.recoveryHintInterval = setInterval(() => {
            this.recoveryStateChangedHint.next()
        }, 30000)

        this.recoveryStateChangedHint.pipe(debounceTime(1000)).subscribe(() => {
            this.tabRecovery.saveTabs(this.tabs, this.activeTab)
        })

        void lastValueFrom(config.ready$).then(async () => {
            if (this.bootstrapData.isMainWindow) {
                if (config.store.recoverTabs) {
                    const recoveredTabs = await this.tabRecovery.recoverTabs()
                    const selectedTabs = await this.selectTabsToRestore(recoveredTabs)
                    this.restoreRecoveredTabs(selectedTabs)
                }
                /** Continue to store the tabs even if the setting is currently off */
                this.tabRecovery.enabled = true
            }
            this.tabsRestored.next()
            this.tabsRestored.complete()
        })

        this.tabClosed$.subscribe(() => {
            if (!this.tabs.length && this.config.store.appearance.lastTabClosesWindow) {
                this.hostWindow.close()
            }
        })

        hostWindow.windowFocused$.subscribe(() => this._activeTab?.emitFocused())
    }

    ngOnDestroy (): void {
        if (this.recoveryHintInterval !== null) {
            clearInterval(this.recoveryHintInterval)
            this.recoveryHintInterval = null
        }
    }

    addTabRaw (tab: BaseTabComponent, index: number|null = null, options: { select?: boolean } = {}): void {
        const shouldSelect = options.select ?? true
        if (index !== null) {
            this.tabs.splice(index, 0, tab)
        } else {
            this.tabs.push(tab)
        }

        if (shouldSelect) {
            this.selectTab(tab)
        }
        this.tabsChanged.next()
        this.tabOpened.next(tab)

        if (this.bootstrapData.isMainWindow) {
            tab.recoveryStateChangedHint$.subscribe(() => {
                this.recoveryStateChangedHint.next()
            })
        }

        tab.titleChange$.subscribe(title => {
            if (tab === this._activeTab) {
                this.hostWindow.setTitle(title)
            }
        })

        tab.destroyed$.subscribe(() => {
            this.removeTab(tab)
            this.tabRemoved.next(tab)
            this.tabClosed.next(tab)
        })
    }

    removeTab (tab: BaseTabComponent): void {
        const tabIndex = this.tabs.indexOf(tab)
        const nextActiveTab = tabIndex >= 0
            ? this.tabs[tabIndex + 1] ?? this.tabs[tabIndex - 1] ?? null
            : null
        this.tabs = this.tabs.filter((x) => x !== tab)
        if (tab === this._activeTab) {
            this.selectTab(nextActiveTab && this.tabs.includes(nextActiveTab) ? nextActiveTab : null)
        }
        this.tabsChanged.next()
    }

    /**
     * Adds a new tab
     * @param inputs  Properties to be assigned on the new tab component instance
     */
    openNewTabRaw <T extends BaseTabComponent> (params: NewTabParameters<T>, index: number|null = null, options: { select?: boolean } = {}): T {
        const tab = this.tabsService.create(params)
        this.addTabRaw(tab, index, options)
        return tab
    }

    openNewTab <T extends BaseTabComponent> (params: NewTabParameters<T>): T {
        const tab = this.tabsService.create(params)
        this.addTabRaw(tab)
        return tab
    }

    private async selectTabsToRestore (recoveredTabs: RecoveredTabsState): Promise<RecoveredTabsState> {
        if (!recoveredTabs.entries.length) {
            return recoveredTabs
        }

        const modal = this.ngbModal.open(StartupTabsRecoveryModalComponent, {
            size: 'lg',
            backdrop: 'static',
            keyboard: false,
            centered: true,
        })
        modal.componentInstance.entries = recoveredTabs.entries

        const selection = await modal.result.catch(() => null) as boolean[]|null
        if (!selection) {
            return { tabs: [], activeTabIndex: null, entries: [] }
        }

        const activeEntry = recoveredTabs.activeTabIndex !== null
            ? recoveredTabs.entries[recoveredTabs.activeTabIndex] ?? null
            : null
        const entries = recoveredTabs.entries.filter((_entry, index) => selection[index])
        const activeTabIndex = entries.length
            ? Math.max(0, activeEntry ? entries.indexOf(activeEntry) : 0)
            : null

        return {
            tabs: entries.map(entry => entry.tab),
            activeTabIndex,
            entries,
        }
    }

    private restoreRecoveredTabs (recoveredTabs: RecoveredTabsState): void {
        if (!recoveredTabs.tabs.length) {
            return
        }

        const restoredTopLevelTabs: BaseTabComponent[] = []
        for (const tab of recoveredTabs.tabs) {
            restoredTopLevelTabs.push(this.openNewTabRaw(tab, null, { select: false }))
        }

        const activeTabIndex = recoveredTabs.activeTabIndex !== null && recoveredTabs.activeTabIndex < restoredTopLevelTabs.length
            ? recoveredTabs.activeTabIndex
            : 0
        this.selectTab(restoredTopLevelTabs[activeTabIndex])
    }

    async reopenLastTab (): Promise<BaseTabComponent|null> {
        const token = this.closedTabsStack.pop()
        if (token) {
            const recoveredTab = await this.tabRecovery.recoverTab(token)
            if (recoveredTab) {
                const tab = this.tabsService.create(recoveredTab)
                if (this.activeTab) {
                    this.addTabRaw(tab, this.tabs.indexOf(this.activeTab) + 1)
                } else {
                    this.addTabRaw(tab)
                }
                return tab
            }
        }
        return null
    }

    selectTab (tab: BaseTabComponent|null): void {
        if (tab && this._activeTab === tab) {
            this._activeTab.emitFocused()
            return
        }
        if (this._activeTab && this.tabs.includes(this._activeTab)) {
            this.lastTabIndex = this.tabs.indexOf(this._activeTab)
        } else {
            this.lastTabIndex = 0
        }
        if (this._activeTab) {
            this._activeTab.clearActivity()
            this._activeTab.emitBlurred()
            this._activeTab.emitVisibility(false)
        }
        this._activeTab = tab
        this.activeTabChange.next(tab)
        const focusHandle = setImmediate(() => {
            this._activeTab?.emitFocused()
            this._activeTab?.emitVisibility(true)
        })
        if (typeof (focusHandle as any)?.unref === 'function') {
            (focusHandle as any).unref()
        }
        this.hostWindow.setTitle(this._activeTab?.title)
    }

    /** Switches between the current tab and the previously active one */
    toggleLastTab (): void {
        if (!this.lastTabIndex || this.lastTabIndex >= this.tabs.length) {
            this.lastTabIndex = 0
        }
        this.selectTab(this.tabs[this.lastTabIndex])
    }

    nextTab (): void {
        if (!this._activeTab) {
            return
        }
        if (this.tabs.length > 1) {
            const tabIndex = this.tabs.indexOf(this._activeTab)
            if (tabIndex < this.tabs.length - 1) {
                this.selectTab(this.tabs[tabIndex + 1])
            } else if (this.config.store.appearance.cycleTabs) {
                this.selectTab(this.tabs[0])
            }
        }
    }

    previousTab (): void {
        if (!this._activeTab) {
            return
        }
        if (this.tabs.length > 1) {
            const tabIndex = this.tabs.indexOf(this._activeTab)
            if (tabIndex > 0) {
                this.selectTab(this.tabs[tabIndex - 1])
            } else if (this.config.store.appearance.cycleTabs) {
                this.selectTab(this.tabs[this.tabs.length - 1])
            }
        }
    }

    moveSelectedTabLeft (): void {
        if (!this._activeTab) {
            return
        }
        if (this.tabs.length > 1) {
            const tabIndex = this.tabs.indexOf(this._activeTab)
            if (tabIndex > 0) {
                this.swapTabs(this._activeTab, this.tabs[tabIndex - 1])
            } else if (this.config.store.appearance.cycleTabs) {
                this.tabs.push(this.tabs.shift()!)
            }
        }
    }

    moveSelectedTabRight (): void {
        if (!this._activeTab) {
            return
        }
        if (this.tabs.length > 1) {
            const tabIndex = this.tabs.indexOf(this._activeTab)
            if (tabIndex < this.tabs.length - 1) {
                this.swapTabs(this._activeTab, this.tabs[tabIndex + 1])
            } else if (this.config.store.appearance.cycleTabs) {
                this.tabs.unshift(this.tabs.pop()!)
            }
        }
    }

    swapTabs (a: BaseTabComponent, b: BaseTabComponent): void {
        const i1 = this.tabs.indexOf(a)
        const i2 = this.tabs.indexOf(b)
        this.tabs[i1] = b
        this.tabs[i2] = a
    }

    renameTab (tab: BaseTabComponent): void {
        const modal = this.ngbModal.open(RenameTabModalComponent)
        modal.componentInstance.value = tab.customTitle || tab.title
        modal.result.then(result => {
            tab.setTitle(result)
            tab.customTitle = result
            this.emitTabsChanged()
        }).catch(() => null)
    }

    /** @hidden */
    emitTabsChanged (): void {
        this.tabsChanged.next()
    }

    async closeTab (tab: BaseTabComponent, checkCanClose?: boolean): Promise<void> {
        if (!this.tabs.includes(tab)) {
            return
        }
        if (checkCanClose && !await tab.canClose()) {
            return
        }
        const recoveryOptions: GetRecoveryTokenOptions & { recoveryScrollbackLines?: number } = {
            includeState: true,
            recoveryScrollbackLines: CLOSED_TAB_RECOVERY_SCROLLBACK_LINES,
        }
        const token = await this.tabRecovery.getFullRecoveryToken(tab, recoveryOptions)
        if (token) {
            if (typeof token.savedState === 'string' && token.savedState.length > CLOSED_TAB_RECOVERY_MAX_STATE_CHARS) {
                delete token.savedState
            }
            this.closedTabsStack.push(token)
            this.closedTabsStack = this.closedTabsStack.slice(-5)
        }
        await this.destroyTab(tab)
    }

    async duplicateTab (tab: BaseTabComponent): Promise<BaseTabComponent|null> {
        const dup = await this.tabsService.duplicate(tab)
        if (dup) {
            this.addTabRaw(dup, this.tabs.indexOf(tab) + 1)
        }
        return dup
    }

    /**
     * Attempts to close all tabs, returns false if one of the tabs blocked closure
     */
    async closeAllTabs (): Promise<boolean> {
        for (const tab of this.tabs) {
            if (!await tab.canClose()) {
                return false
            }
        }
        await Promise.all([...this.tabs].map(tab => this.destroyTab(tab, true)))
        return true
    }

    async closeWindow (): Promise<void> {
        await this.prepareTabsForRecoverySave(this.tabs)
        await this.tabRecovery.saveTabs(this.tabs, this.activeTab)
        this.tabRecovery.enabled = false
        if (await this.closeAllTabs()) {
            this.hostWindow.close()
        } else {
            this.tabRecovery.enabled = true
        }
    }

    private async prepareTabsForRecoverySave (tabs: BaseTabComponent[]): Promise<void> {
        await Promise.all(tabs.map(async tab => {
            const recoveryAwareTab = tab as BaseTabComponent & { prepareForRecoverySave?: () => Promise<void> }
            await recoveryAwareTab.prepareForRecoverySave?.()
        }))
    }

    private async destroyTab (tab: BaseTabComponent, skipDestroyedEvent = false): Promise<void> {
        const destroy = tab.destroy as (skipDestroyedEvent?: boolean) => void | Promise<void>
        await Promise.resolve(destroy.call(tab, skipDestroyedEvent))
    }

    /** @hidden */
    emitReady (): void {
        this.ready.next()
        this.ready.complete()
        this.hostApp.emitReady()
    }

    /** @hidden */
    emitTabDragStarted (tab: BaseTabComponent): void {
        this.tabDragActive.next(tab)
    }

    /** @hidden */
    emitTabDragEnded (): void {
        this.tabDragActive.next(null)
    }

    /**
     * Returns an observable that fires once
     * the tab's internal "process" (see [[BaseTabProcess]]) completes
     */
    observeTabCompletion (tab: BaseTabComponent): Observable<void> {
        if (!this.completionObservers.has(tab)) {
            const observer = new CompletionObserver(tab)
            observer.destroyed$.subscribe(() => {
                this.stopObservingTabCompletion(tab)
            })
            this.completionObservers.set(tab, observer)
        }
        return this.completionObservers.get(tab)!.done$
    }

    stopObservingTabCompletion (tab: BaseTabComponent): void {
        this.completionObservers.delete(tab)
    }

    // Deprecated
    showSelector <T> (name: string, options: SelectorOption<T>[]): Promise<T> {
        return this.selector.show(name, options)
    }

}
