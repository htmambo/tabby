import { Injectable, Inject, Injector, OnDestroy } from '@angular/core'
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
const BACKGROUND_RECOVERY_SCROLLBACK_LINES = 200
const BACKGROUND_RECOVERY_MAX_STATE_CHARS = 128 * 1024
const WINDOW_CLOSE_RECOVERY_SCROLLBACK_LINES = 500
const WINDOW_CLOSE_RECOVERY_MAX_STATE_CHARS = 256 * 1024

type IdleRequestCallbackLike = () => void
type IdleRequestOptionsLike = {
    timeout?: number
}
type IdleCallbackGlobal = typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallbackLike, options?: IdleRequestOptionsLike) => number
    cancelIdleCallback?: (handle: number) => void
}

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
    private readonly startupBackgroundRestoreBatchSize = 2
    private readonly startupBackgroundRestoreIdleTimeout = 1200
    private readonly startupBackgroundRestoreDelay = 100
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
    private startupTabRestoreComplete = new AsyncSubject<void>()
    private recoveryStateChangedHint = new Subject<void>()

    private completionObservers = new Map<BaseTabComponent, CompletionObserver>()
    private recoveryHintInterval: ReturnType<typeof setInterval> | null = null
    private dirtyRecoveryTabs = new Set<BaseTabComponent>()
    private recoverySaveInFlight = false
    private recoverySaveQueued = false
    private recoveryIdleHandle: number | null = null
    private pendingBackgroundTabRestores: Array<{ tab: NewTabParameters<BaseTabComponent>, index: number }> = []
    private backgroundRestoreIdleHandle: number | null = null
    private backgroundRestoreTimeoutHandle: number | null = null
    private selectorServiceInstance: SelectorService | null = null
    private ngbModalInstance: NgbModal | null = null
    private startupTabRestoreCompleted = false

    get activeTabChange$ (): Observable<BaseTabComponent|null> { return this.activeTabChange }
    get tabOpened$ (): Observable<BaseTabComponent> { return this.tabOpened }
    get tabsChanged$ (): Observable<void> { return this.tabsChanged }
    get tabRemoved$ (): Observable<BaseTabComponent> { return this.tabRemoved }
    get tabClosed$ (): Observable<BaseTabComponent> { return this.tabClosed }
    get tabDragActive$ (): Observable<BaseTabComponent|null> { return this.tabDragActive }

    /** Fires once when saved tabs are restored */
    get tabsRestored$ (): Observable<void> { return this.tabsRestored }

    /** Fires once when startup tab restoration, including deferred background tabs, is fully complete */
    get startupTabRestoreComplete$ (): Observable<void> { return this.startupTabRestoreComplete }

    /** Fires once when the app is ready */
    get ready$ (): Observable<void> { return this.ready }

    /** @hidden */
    private constructor (
        private injector: Injector,
        private config: ConfigService,
        private hostApp: HostAppService,
        private hostWindow: HostWindowService,
        private tabRecovery: TabRecoveryService,
        private tabsService: TabsService,
        @Inject(BOOTSTRAP_DATA) private bootstrapData: BootstrapData,
    ) {
        this.tabsChanged$.subscribe(() => {
            this.recoveryStateChangedHint.next()
        })

        this.activeTabChange$.subscribe(() => {
            this.recoveryStateChangedHint.next()
        })

        this.recoveryHintInterval = setInterval(() => {
            if (this._activeTab && this.tabs.includes(this._activeTab)) {
                this.markTabRecoveryDirty(this._activeTab)
            }
        }, 30000)

        this.recoveryStateChangedHint.pipe(debounceTime(1000)).subscribe(() => {
            this.scheduleRecoverySave()
        })

        void lastValueFrom(config.ready$).then(async () => {
            if (this.bootstrapData.isMainWindow) {
                if (config.store.recoverTabs) {
                    const recoveredTabs = await this.tabRecovery.recoverTabs()
                    const selectedTabs = await this.selectTabsToRestore(recoveredTabs)
                    this.restoreRecoveredTabs(selectedTabs)
                } else {
                    this.completeStartupTabRestore()
                }
                /** Continue to store the tabs even if the setting is currently off */
                this.tabRecovery.enabled = true
            } else {
                this.completeStartupTabRestore()
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

    private get selector (): SelectorService {
        this.selectorServiceInstance ??= this.injector.get(SelectorService)
        return this.selectorServiceInstance
    }

    private get ngbModal (): NgbModal {
        this.ngbModalInstance ??= this.injector.get(NgbModal)
        return this.ngbModalInstance
    }

    ngOnDestroy (): void {
        if (this.recoveryHintInterval !== null) {
            clearInterval(this.recoveryHintInterval)
            this.recoveryHintInterval = null
        }
        if (this.recoveryIdleHandle !== null) {
            const idleGlobal = globalThis as IdleCallbackGlobal
            if (idleGlobal.cancelIdleCallback) {
                idleGlobal.cancelIdleCallback(this.recoveryIdleHandle)
            } else {
                clearTimeout(this.recoveryIdleHandle)
            }
            this.recoveryIdleHandle = null
        }
        this.clearPendingBackgroundTabRestore()
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
        this.markTabRecoveryDirty(tab)
        this.tabsChanged.next()
        this.tabOpened.next(tab)

        if (this.bootstrapData.isMainWindow) {
            tab.recoveryStateChangedHint$.subscribe(() => {
                this.markTabRecoveryDirty(tab)
            })
        }

        tab.titleChange$.subscribe(title => {
            if (tab === this._activeTab) {
                this.hostWindow.setTitle(title)
            }
            this.markTabRecoveryDirty(tab)
        })

        tab.destroyed$.subscribe(() => {
            this.tabRecovery.dropCachedTab(tab)
            this.dirtyRecoveryTabs.delete(tab)
            this.removeTab(tab)
            this.tabRemoved.next(tab)
            this.tabClosed.next(tab)
        })
    }

    removeTab (tab: BaseTabComponent): void {
        this.tabRecovery.dropCachedTab(tab)
        this.dirtyRecoveryTabs.delete(tab)
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
            this.completeStartupTabRestore()
            return
        }

        if (!this.shouldDelayRecoveredBackgroundTabs(recoveredTabs)) {
            const restoredTopLevelTabs: BaseTabComponent[] = []
            for (const tab of recoveredTabs.tabs) {
                restoredTopLevelTabs.push(this.openNewTabRaw(tab, null, { select: false }))
            }

            const activeTabIndex = recoveredTabs.activeTabIndex !== null && recoveredTabs.activeTabIndex < restoredTopLevelTabs.length
                ? recoveredTabs.activeTabIndex
                : 0
            this.selectTab(restoredTopLevelTabs[activeTabIndex])
            this.completeStartupTabRestore()
            return
        }

        const activeTabIndex = recoveredTabs.activeTabIndex !== null && recoveredTabs.activeTabIndex < recoveredTabs.tabs.length
            ? recoveredTabs.activeTabIndex
            : 0
        const activeTab = this.openNewTabRaw(recoveredTabs.tabs[activeTabIndex], null, { select: false })
        this.selectTab(activeTab)

        this.pendingBackgroundTabRestores = recoveredTabs.tabs
            .map((tab, index) => ({ tab, index }))
            .filter(entry => entry.index !== activeTabIndex)
        this.scheduleNextBackgroundTabRestoreBatch()
    }

    private shouldDelayRecoveredBackgroundTabs (recoveredTabs: RecoveredTabsState): boolean {
        return !!this.config.store.delayBackgroundTabRestoreForStartup && recoveredTabs.tabs.length > 1
    }

    private scheduleNextBackgroundTabRestoreBatch (): void {
        if (!this.pendingBackgroundTabRestores.length) {
            return
        }
        if (this.backgroundRestoreIdleHandle !== null || this.backgroundRestoreTimeoutHandle !== null) {
            return
        }

        const scheduleIdle = () => {
            const run = () => {
                this.backgroundRestoreIdleHandle = null
                this.restoreBackgroundTabBatch()
            }
            const idleGlobal = globalThis as IdleCallbackGlobal
            if (idleGlobal.requestIdleCallback) {
                this.backgroundRestoreIdleHandle = idleGlobal.requestIdleCallback(run, { timeout: this.startupBackgroundRestoreIdleTimeout })
            } else {
                this.backgroundRestoreTimeoutHandle = setTimeout(() => {
                    this.backgroundRestoreTimeoutHandle = null
                    run()
                }, 50) as unknown as number
            }
        }

        this.backgroundRestoreTimeoutHandle = setTimeout(() => {
            this.backgroundRestoreTimeoutHandle = null
            scheduleIdle()
        }, this.startupBackgroundRestoreDelay) as unknown as number
    }

    private restoreBackgroundTabBatch (): void {
        if (!this.pendingBackgroundTabRestores.length) {
            return
        }

        const batch = this.pendingBackgroundTabRestores.splice(0, this.startupBackgroundRestoreBatchSize)
        for (const entry of batch) {
            this.openNewTabRaw(entry.tab, entry.index, { select: false })
        }

        if (this.pendingBackgroundTabRestores.length) {
            this.scheduleNextBackgroundTabRestoreBatch()
            return
        }

        this.completeStartupTabRestore()
    }

    private clearPendingBackgroundTabRestore (): void {
        if (this.backgroundRestoreIdleHandle !== null) {
            const idleGlobal = globalThis as IdleCallbackGlobal
            if (idleGlobal.cancelIdleCallback) {
                idleGlobal.cancelIdleCallback(this.backgroundRestoreIdleHandle)
            } else {
                clearTimeout(this.backgroundRestoreIdleHandle)
            }
            this.backgroundRestoreIdleHandle = null
        }
        if (this.backgroundRestoreTimeoutHandle !== null) {
            clearTimeout(this.backgroundRestoreTimeoutHandle)
            this.backgroundRestoreTimeoutHandle = null
        }
        this.pendingBackgroundTabRestores = []
    }

    private completeStartupTabRestore (): void {
        if (this.startupTabRestoreCompleted) {
            return
        }
        this.startupTabRestoreCompleted = true
        this.startupTabRestoreComplete.next()
        this.startupTabRestoreComplete.complete()
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
        await this.tabRecovery.saveTabs(this.tabs, this.activeTab, {
            changedTabs: this.tabs,
            includeState: true,
            recoveryScrollbackLines: WINDOW_CLOSE_RECOVERY_SCROLLBACK_LINES,
            maxStateChars: WINDOW_CLOSE_RECOVERY_MAX_STATE_CHARS,
        })
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

    private markTabRecoveryDirty (tab: BaseTabComponent): void {
        if (!this.bootstrapData.isMainWindow || !this.tabs.includes(tab)) {
            return
        }
        this.dirtyRecoveryTabs.add(tab)
        this.recoveryStateChangedHint.next()
    }

    private scheduleRecoverySave (): void {
        if (!this.bootstrapData.isMainWindow || this.recoveryIdleHandle !== null) {
            return
        }

        const idleGlobal = globalThis as IdleCallbackGlobal
        const run = () => {
            this.recoveryIdleHandle = null
            void this.persistRecoveryState()
        }

        if (idleGlobal.requestIdleCallback) {
            this.recoveryIdleHandle = idleGlobal.requestIdleCallback(run, { timeout: 1000 })
        } else {
            this.recoveryIdleHandle = setTimeout(run, 50) as unknown as number
        }
    }

    private async persistRecoveryState (): Promise<void> {
        if (this.recoverySaveInFlight) {
            this.recoverySaveQueued = true
            return
        }

        this.recoverySaveInFlight = true
        try {
            const changedTabs = Array.from(this.dirtyRecoveryTabs).filter(tab => this.tabs.includes(tab))
            this.dirtyRecoveryTabs.clear()
            await this.tabRecovery.saveTabs(this.tabs, this.activeTab, {
                changedTabs,
                includeState: true,
                recoveryScrollbackLines: BACKGROUND_RECOVERY_SCROLLBACK_LINES,
                maxStateChars: BACKGROUND_RECOVERY_MAX_STATE_CHARS,
            })
        } finally {
            this.recoverySaveInFlight = false
            if (this.recoverySaveQueued) {
                this.recoverySaveQueued = false
                this.scheduleRecoverySave()
            }
        }
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
