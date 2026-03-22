/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, HostListener, HostBinding, ViewChildren, ViewChild, NgZone, ChangeDetectorRef, OnDestroy, Injector } from '@angular/core'
import { trigger, style, animate, transition, state } from '@angular/animations'
import { NgbDropdown, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop'
import { TranslateService } from '@ngx-translate/core'
import { firstValueFrom } from 'rxjs'

import { HostAppService, Platform } from '../api/hostApp'
import { HotkeysService } from '../services/hotkeys.service'
import { Logger, LogService } from '../services/log.service'
import { ConfigService } from '../services/config.service'
import { ThemesService } from '../services/themes.service'
import { UpdaterService } from '../services/updater.service'
import { CommandService } from '../services/commands.service'
import { ProfilesService } from '../services/profiles.service'
import { TabsService } from '../services/tabs.service'
import { getRendererSafeModeReason } from '../api/rendererState'

import { BaseTabComponent } from './baseTab.component'
import { SafeModeModalComponent } from './safeModeModal.component'
import { TabBodyComponent } from './tabBody.component'
import { AppService, Command, CommandLocation, FileTransfer, HostWindowService, MenuItemOptions, PartialProfile, PartialProfileGroup, PlatformService, Profile, ProfileGroup, WorkspaceLayoutService } from '../api'
import { SFTPTabOpener } from '../api/sftpTabOpener'

type RoyalEnvironment = 'prod'|'lab'|'dev'|'other'
type RoyalSidebarViewMode = 'cards'|'tree'

interface RoyalNavigationItem {
    hostTab: BaseTabComponent
    targetTab: BaseTabComponent
    title: string
    kind: string
}

interface RoyalNavigationGroup {
    id: RoyalEnvironment
    label: string
    toneClass: string
    items: RoyalNavigationItem[]
}

interface RoyalConnectionItem {
    profile: PartialProfile<Profile>
    title: string
    description: string|null
    kind: string
}

interface RoyalConnectionGroup {
    id: string
    label: string
    toneClass: string
    items: RoyalConnectionItem[]
}

interface RoyalTabTarget {
    hostTab: BaseTabComponent
    targetTab: BaseTabComponent
}

type IdleRequestCallbackLike = () => void
type IdleRequestOptionsLike = {
    timeout?: number
}
type IdleCallbackGlobal = typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallbackLike, options?: IdleRequestOptionsLike) => number
    cancelIdleCallback?: (handle: number) => void
}

function makeTabAnimation (dimension: string, size: number) {
    return [
        state('in', style({
            'flex-basis': '{{size}}',
            [dimension]: '{{size}}',
        }), {
            params: { size: `${size}px` },
        }),
        transition(':enter', [
            style({
                'flex-basis': '1px',
                [dimension]: '1px',
            }),
            animate('250ms ease-out', style({
                'flex-basis': '{{size}}',
                [dimension]: '{{size}}',
            })),
        ]),
        transition(':leave', [
            style({
                'flex-basis': 'auto',
                'padding-left': '*',
                'padding-right': '*',
                [dimension]: '*',
            }),
            animate('250ms ease-in-out', style({
                'padding-left': 0,
                'padding-right': 0,
                [dimension]: '0',
            })),
        ]),
    ]
}

/** @hidden */
@Component({
    standalone: false,
    selector: 'app-root',
    templateUrl: './appRoot.component.pug',
    styleUrls: ['./appRoot.component.scss'],
    animations: [
        trigger('animateTab', makeTabAnimation('width', 200)),
    ],
})
export class AppRootComponent implements OnDestroy {
    private readonly minMacOSWindowOpacity = 0.85
    private readonly minVibrantWindowOpacity = 0.4
    Platform = Platform
    @Input() ready = false
    @Input() leftToolbarButtons: Command[]
    @Input() rightToolbarButtons: Command[]
    @HostBinding('class.platform-win32') get platformClassWindows (): boolean { return this.hostApp.platform === Platform.Windows }
    @HostBinding('class.platform-darwin') get platformClassMacOS (): boolean { return this.hostApp.platform === Platform.macOS }
    @HostBinding('class.platform-linux') get platformClassLinux (): boolean { return this.hostApp.platform === Platform.Linux }
    @ViewChildren(TabBodyComponent) tabBodies: TabBodyComponent[]
    @ViewChild('activeTransfersDropdown') activeTransfersDropdown: NgbDropdown
    unsortedTabs: BaseTabComponent[] = []
    showStartPage = true
    updatesAvailable = false
    activeTransfers: FileTransfer[] = []
    royalSidebarCollapsed = false
    royalSidebarPreviewVisible = false
    sidebarFilter = ''
    royalConnectionGroups: RoyalConnectionGroup[] = []
    filteredRoyalConnectionGroups: RoyalConnectionGroup[] = []
    activeRoyalTab: BaseTabComponent|null = null
    royalSingleExpandMode = false
    royalSidebarViewMode: RoyalSidebarViewMode = 'cards'
    royalSessionGroups: RoyalNavigationGroup[] = []
    private readonly defaultFixedTabWidth = 200
    private readonly minFixedTabWidth = 84
    private readonly maxFixedTabWidth = 600
    private readonly royalSidebarDefaultWidth = 260
    private readonly royalSidebarMinWidth = Math.round(this.royalSidebarDefaultWidth * 2 / 3)
    private readonly royalSidebarMaxWidth = 520
    royalSidebarWidth = this.royalSidebarDefaultWidth
    private logger: Logger
    private readonly royalSidebarCollapsedStorageKey = 'tabby.royal.sidebar-collapsed'
    private readonly royalSidebarWidthStorageKey = 'tabby.royal.sidebar-width'
    private readonly royalCollapsedGroupsStorageKey = 'tabby.royal.collapsed-items'
    private readonly royalSingleExpandModeStorageKey = 'tabby.royal.single-expand-mode'
    private readonly royalSidebarViewModeStorageKey = 'tabby.royal.sidebar-view-mode'
    private royalCollapsedGroups = new Set<string>()
    private royalConnectionsRefreshToken = 0
    private royalSidebarResizing = false
    private royalSidebarResizeStartX = 0
    private royalSidebarResizeStartWidth = this.royalSidebarDefaultWidth
    private royalConnectionBindings = new Map<string, BaseTabComponent>()
    private royalRestoredBindingCandidates = new Set<BaseTabComponent>()
    private royalRestoreBindingsRetryHandle: number|null = null
    private royalRestoreBindingsAttempt = 0
    private readonly royalRestoreBindingsRetryDelay = 500
    private readonly royalRestoreBindingsMaxAttempts = 20
    private readonly royalSidebarPreviewCloseDelay = 120
    private readonly royalSidebarTransitionFallbackDelay = 260
    private readonly startupToolbarButtonsDelay = 400
    private readonly startupRoyalConnectionsDelay = 900
    private readonly startupUpdaterCheckDelay = 5000
    private readonly startupIdleFallbackDelay = 50
    private readonly startupToolbarButtonsIdleTimeout = 1400
    private readonly startupRoyalConnectionsIdleTimeout = 2200
    private readonly startupUpdaterCheckIdleTimeout = 6000
    private pendingVibrancySync: number|null = null
    private pendingPreloadHideCheck: number|null = null
    private pendingRoyalActiveSync: number|null = null
    private pendingViewRefresh: number|null = null
    private pendingTabSurfaceSync: number|null = null
    private royalSidebarPreviewCloseHandle: number|null = null
    private royalSidebarTransitionToken: number|null = null
    private royalSidebarTransitionFallbackHandle: number|null = null
    private readonly preloadHideRetryDelay = 50
    private preloadLogoHidden = false
    private destroyed = false
    private pendingTimeouts = new Set<number>()
    private pendingIdleCallbacks = new Set<number>()
    private updatesCheckInterval: number | null = null
    private automaticUpdatesEnabled = false
    private updaterCheckScheduled = false
    private updateAvailabilityRefreshToken = 0
    private updaterServiceInstance: UpdaterService | null = null
    private commandServiceInstance: CommandService | null = null
    private profilesServiceInstance: ProfilesService | null = null
    private tabsServiceInstance: TabsService | null = null
    private ngbModalInstance: NgbModal | null = null
    private sftpTabOpenerInstance: SFTPTabOpener | null | undefined
    private workspaceLayoutServiceInstance: WorkspaceLayoutService | null = null

    private hidePreloadLogo (): void {
        if (this.preloadLogoHidden) {
            return
        }
        this.preloadLogoHidden = true
        this.pendingPreloadHideCheck = this.clearScheduledTimeout(this.pendingPreloadHideCheck)
        document.querySelector('app-root .preload-logo')?.remove()
    }

    private isStartupSurfaceReady (): boolean {
        if (!this.ready) {
            return false
        }
        const root = document.querySelector('app-root')
        if (!root) {
            return false
        }
        // 只要主内容容器已经挂载，就可以安全移除启动遮罩。
        // 继续等待某个具体 tab/start-page DOM 形态会导致首屏状态轻微抖动时永久卡在 splash。
        return !!root.querySelector('.content')
    }

    private schedulePreloadHideCheck (delay = 0): void {
        if (this.preloadLogoHidden || this.pendingPreloadHideCheck !== null) {
            return
        }
        this.pendingPreloadHideCheck = this.scheduleTimeout(() => {
            this.pendingPreloadHideCheck = null
            if (this.isStartupSurfaceReady()) {
                this.hidePreloadLogo()
                return
            }
            this.schedulePreloadHideCheck(this.preloadHideRetryDelay)
        }, delay)
    }

    private scheduleRoyalActiveSync (delay = 0): void {
        if (this.pendingRoyalActiveSync !== null) {
            return
        }
        this.pendingRoyalActiveSync = this.scheduleTimeout(() => {
            this.pendingRoyalActiveSync = null
            this.runInAngular(() => {
                this.syncRoyalActiveConnection()
                this.scheduleViewRefresh()
            })
        }, delay)
    }



    private scheduleViewRefresh (delay = 0): void {
        if (this.pendingViewRefresh !== null) {
            return
        }
        this.pendingViewRefresh = this.scheduleTimeout(() => {
            this.pendingViewRefresh = null
            this.changeDetector.markForCheck()
        }, delay)
    }

    private syncTabSurfaceState (): void {
        const knownTabs = new Set(this.unsortedTabs)
        const currentTabs = new Set(this.app.tabs)
        const nextUnsortedTabs = this.unsortedTabs.filter(tab => currentTabs.has(tab))
        for (const tab of this.app.tabs) {
            if (!knownTabs.has(tab)) {
                nextUnsortedTabs.push(tab)
            }
        }
        this.unsortedTabs = nextUnsortedTabs
        this.showStartPage = nextUnsortedTabs.length === 0
    }

    private scheduleTabSurfaceSync (delay = 0): void {
        if (this.pendingTabSurfaceSync !== null) {
            return
        }
        this.pendingTabSurfaceSync = this.scheduleTimeout(() => {
            this.pendingTabSurfaceSync = null
            this.syncTabSurfaceState()
            this.scheduleViewRefresh()
        }, delay)
    }

    private clearRoyalSidebarTransitionFallback (): void {
        this.royalSidebarTransitionFallbackHandle = this.clearScheduledTimeout(this.royalSidebarTransitionFallbackHandle)
    }

    private beginRoyalSidebarTransition (): void {
        const token = this.workspaceLayout.beginRoyalSidebarTransition()
        this.royalSidebarTransitionToken = token
        this.clearRoyalSidebarTransitionFallback()
        this.royalSidebarTransitionFallbackHandle = this.scheduleTimeout(() => {
            this.finishRoyalSidebarTransition(token)
        }, this.royalSidebarTransitionFallbackDelay)
    }

    private finishRoyalSidebarTransition (token = this.royalSidebarTransitionToken): void {
        if (token === null || token !== this.royalSidebarTransitionToken) {
            return
        }
        this.clearRoyalSidebarTransitionFallback()
        this.royalSidebarTransitionToken = null
        this.workspaceLayout.finishRoyalSidebarTransition(token)
    }

    constructor (
        private injector: Injector,
        private hotkeys: HotkeysService,
        private translate: TranslateService,
        public hostWindow: HostWindowService,
        public hostApp: HostAppService,
        public config: ConfigService,
        public app: AppService,
        private platform: PlatformService,
        log: LogService,
        _themes: ThemesService,
        private ngZone: NgZone,
        private changeDetector: ChangeDetectorRef,
    ) {
        this.restoreRoyalPreferences()

        // document.querySelector('app-root')?.remove()
        this.logger = log.create('main')
        this.logger.debug('v', this.platform.getAppVersion())
        this.syncTabSurfaceState()

        this.app.activeTabChange$.subscribe(() => {
            this.scheduleRoyalActiveSync()
        })
        this.app.tabsChanged$.subscribe(() => {
            this.scheduleRoyalActiveSync()
            this.scheduleTabSurfaceSync()
        })
        this.app.tabsRestored$.subscribe(() => {
            this.scheduleRoyalActiveSync()
        })
        this.app.startupTabRestoreComplete$.subscribe(() => {
            this.scheduleRoyalActiveSync()
            this.runInAngular(() => this.startRoyalRestoredBindingsRecovery())
        })
        this.app.tabs.forEach(tab => this.observeRoyalTab(tab))

        this.hotkeys.hotkey$.subscribe((hotkey: string) => {
            if (hotkey.startsWith('tab-')) {
                const index = parseInt(hotkey.split('-')[1])
                if (index <= this.app.tabs.length) {
                    this.app.selectTab(this.app.tabs[index - 1])
                }
            }
            if (this.app.activeTab) {
                if (hotkey === 'close-tab') {
                    this.app.closeTab(this.app.activeTab, true)
                }
                if (hotkey === 'toggle-last-tab') {
                    this.app.toggleLastTab()
                }
                if (hotkey === 'next-tab') {
                    this.app.nextTab()
                }
                if (hotkey === 'previous-tab') {
                    this.app.previousTab()
                }
                if (hotkey === 'move-tab-left') {
                    this.app.moveSelectedTabLeft()
                }
                if (hotkey === 'move-tab-right') {
                    this.app.moveSelectedTabRight()
                }
                if (hotkey === 'duplicate-tab') {
                    this.app.duplicateTab(this.app.activeTab)
                }
                if (hotkey === 'rename-tab') {
                    this.app.renameTab(this.app.activeTab)
                }
                if (hotkey === 'restart-tab') {
                    this.app.duplicateTab(this.app.activeTab)
                    this.app.closeTab(this.app.activeTab, true)
                }
            }
            if (hotkey === 'reopen-tab') {
                this.app.reopenLastTab()
            }
            if (hotkey === 'toggle-fullscreen') {
                hostWindow.toggleFullscreen()
            }
        })

        this.hostWindow.windowCloseRequest$.subscribe(async () => {
            this.app.closeWindow()
        })

        if (getRendererSafeModeReason()) {
            this.ngbModal.open(SafeModeModalComponent)
        }

        this.app.tabOpened$.subscribe(tab => {
            this.runInAngular(() => {
                this.observeRoyalTab(tab)
                this.restoreRoyalConnectionBindingsFromTabs()
                this.scheduleRoyalActiveSync()
                this.scheduleTabSurfaceSync()
                this.app.emitTabDragEnded()
                this.schedulePreloadHideCheck()
                this.scheduleViewRefresh()
            })
        })

        this.app.tabRemoved$.subscribe(tab => {
            this.runInAngular(() => {
                for (const tabBody of this.tabBodies) {
                    if (tabBody.tab === tab) {
                        tabBody.detach()
                    }
                }
                this.scheduleRoyalActiveSync()
                this.scheduleTabSurfaceSync()
                this.app.emitTabDragEnded()
                this.scheduleViewRefresh()
            })
        })

        platform.fileTransferStarted$.subscribe(transfer => {
            this.runInAngular(() => {
                this.activeTransfers.push(transfer)
                this.activeTransfersDropdown.open()
            })
        })

        void firstValueFrom(config.ready$).then(async () => {
            this.runInAngular(() => {
                this.syncWindowOpacity()
                this.scheduleViewRefresh()
            })
            this.automaticUpdatesEnabled = !!this.config.store.enableAutomaticUpdates
            this.scheduleIdleTask(() => {
                void this.loadToolbarButtons().catch(error => {
                    this.logger.warn('Failed to load startup toolbar buttons', error)
                })
            }, this.startupToolbarButtonsDelay, this.startupToolbarButtonsIdleTimeout)
            this.scheduleIdleTask(() => {
                if (!this.shouldShowRoyalSidebar()) {
                    return
                }
                void this.refreshRoyalConnections().then(() => this.scheduleRoyalActiveSync())
            }, this.startupRoyalConnectionsDelay, this.startupRoyalConnectionsIdleTimeout)
            this.config.changed$.subscribe(() => {
                this.runInAngular(() => {
                    this.syncWindowOpacity()
                    const automaticUpdatesEnabled = !!this.config.store.enableAutomaticUpdates
                    if (automaticUpdatesEnabled !== this.automaticUpdatesEnabled) {
                        this.automaticUpdatesEnabled = automaticUpdatesEnabled
                        if (automaticUpdatesEnabled) {
                            this.scheduleUpdateAvailabilityRefresh()
                        } else {
                            const refreshToken = ++this.updateAvailabilityRefreshToken
                            if (this.updatesAvailable) {
                                this.scheduleUpdateAvailabilityReset(refreshToken)
                            }
                        }
                    }
                    if (!this.shouldShowRoyalSidebar()) {
                        this.royalConnectionGroups = []
                        this.recomputeRoyalSidebarGroups()
                        this.scheduleViewRefresh()
                        return
                    }
                    void this.refreshRoyalConnections()
                })
            })

            this.scheduleUpdateAvailabilityRefresh(this.startupUpdaterCheckDelay)
            this.updatesCheckInterval = window.setInterval(() => {
                this.scheduleUpdateAvailabilityRefresh()
            }, 3600 * 12 * 1000)
        })
    }

    private get updater (): UpdaterService {
        this.updaterServiceInstance ??= this.injector.get(UpdaterService)
        return this.updaterServiceInstance
    }

    private get commands (): CommandService {
        this.commandServiceInstance ??= this.injector.get(CommandService)
        return this.commandServiceInstance
    }

    private get profilesService (): ProfilesService {
        this.profilesServiceInstance ??= this.injector.get(ProfilesService)
        return this.profilesServiceInstance
    }

    private get tabsService (): TabsService {
        this.tabsServiceInstance ??= this.injector.get(TabsService)
        return this.tabsServiceInstance
    }

    private get ngbModal (): NgbModal {
        this.ngbModalInstance ??= this.injector.get(NgbModal)
        return this.ngbModalInstance
    }

    private get sftpTabOpener (): SFTPTabOpener | null {
        if (this.sftpTabOpenerInstance === undefined) {
            this.sftpTabOpenerInstance = this.injector.get(SFTPTabOpener, null)
        }
        return this.sftpTabOpenerInstance
    }

    private get workspaceLayout (): WorkspaceLayoutService {
        this.workspaceLayoutServiceInstance ??= this.injector.get(WorkspaceLayoutService)
        return this.workspaceLayoutServiceInstance
    }

    async ngOnInit () {
        void firstValueFrom(this.config.ready$)
            .then(() => {
                this.scheduleTimeout(() => {
                    this.runInAngular(() => {
                        this.ready = true
                        this.syncWindowOpacity()
                        this.scheduleRoyalActiveSync()
                        this.schedulePreloadHideCheck()
                        this.scheduleViewRefresh()
                    })
                    this.scheduleTimeout(() => {
                        this.runInAngular(() => this.app.emitReady())
                    })
                })
            })
            .catch(error => {
                console.error('AppRoot waiting for config.ready failed:', error)
            })
    }

    @HostListener('dragover')
    onDragOver () {
        return false
    }

    @HostListener('drop')
    onDrop () {
        return false
    }

    hasVerticalTabs () {
        const tabsLocation = this.config.store?.appearance?.tabsLocation
        return tabsLocation === 'left' || tabsLocation === 'right'
    }

    get targetTabSize (): any {
        if (this.hasVerticalTabs()) {
            return '*'
        }
        return this.config.store.appearance.flexTabs ? '*' : `${this.fixedTabWidth}px`
    }

    get fixedTabWidth (): number {
        return this.normalizeFixedTabWidth(this.config.store?.appearance?.fixedTabWidth)
    }

    onTabsReordered (event: CdkDragDrop<BaseTabComponent[]>) {
        moveItemInArray(this.app.tabs, event.previousIndex, event.currentIndex)
        this.app.emitTabsChanged()
    }

    onTransfersChange () {
        if (this.activeTransfers.length === 0) {
            this.activeTransfersDropdown.close()
        }
    }

    private scheduleUpdateAvailabilityRefresh (delay = 0): void {
        if (this.updaterCheckScheduled) {
            return
        }
        this.updaterCheckScheduled = true
        this.scheduleIdleTask(() => {
            this.updaterCheckScheduled = false
            if (!this.automaticUpdatesEnabled) {
                return
            }
            void this.refreshUpdateAvailability()
        }, delay, this.startupUpdaterCheckIdleTimeout)
    }

    private scheduleUpdateAvailabilityReset (refreshToken = ++this.updateAvailabilityRefreshToken): void {
        // Delay the reset so config-driven startup writes don't mutate the bound
        // button visibility in the same Angular check cycle.
        this.scheduleTimeout(() => {
            if (
                this.destroyed
                || refreshToken !== this.updateAvailabilityRefreshToken
                || this.automaticUpdatesEnabled
                || !this.updatesAvailable
            ) {
                return
            }
            this.runInAngular(() => {
                if (
                    this.destroyed
                    || refreshToken !== this.updateAvailabilityRefreshToken
                    || this.automaticUpdatesEnabled
                    || !this.updatesAvailable
                ) {
                    return
                }
                this.updatesAvailable = false
                this.scheduleViewRefresh()
            })
        })
    }

    private async refreshUpdateAvailability (): Promise<void> {
        const refreshToken = ++this.updateAvailabilityRefreshToken
        try {
            const available = await this.updater.check()
            if (
                this.destroyed
                || !this.automaticUpdatesEnabled
                || refreshToken !== this.updateAvailabilityRefreshToken
            ) {
                return
            }
            this.runInAngular(() => {
                if (
                    this.destroyed
                    || !this.automaticUpdatesEnabled
                    || refreshToken !== this.updateAvailabilityRefreshToken
                ) {
                    return
                }
                this.updatesAvailable = available
                this.scheduleViewRefresh()
            })
        } catch (error) {
            if (!this.destroyed) {
                this.logger.warn('Automatic update check failed', error)
            }
        }
    }

    installUpdate (): void {
        void this.updater.update()
    }

    private async getToolbarButtons (aboveZero: boolean): Promise<Command[]> {
        return (await this.commands.getCommands({ tab: this.app.activeTab ?? undefined }))
            .filter(x => x.locations?.includes(aboveZero ? CommandLocation.RightToolbar : CommandLocation.LeftToolbar))
    }

    private async loadToolbarButtons (): Promise<void> {
        const [leftToolbarButtons, rightToolbarButtons] = await Promise.all([
            this.getToolbarButtons(false),
            this.getToolbarButtons(true),
        ])
        if (this.destroyed) {
            return
        }
        this.runInAngular(() => {
            this.leftToolbarButtons = leftToolbarButtons
            this.rightToolbarButtons = rightToolbarButtons
            this.scheduleViewRefresh()
        })
    }

    private runInAngular (callback: () => void): void {
        if (NgZone.isInAngularZone()) {
            callback()
            return
        }
        this.ngZone.run(callback)
    }

    toggleMaximize (): void {
        this.hostWindow.toggleMaximize()
    }

    protected isTitleBarNeeded (): boolean {
        return (
            this.config.store.appearance.frame === 'full'
            ||
                this.hostApp.platform !== Platform.macOS
                && this.config.store.appearance.frame === 'thin'
                && this.config.store.appearance.tabsLocation !== 'top'
                && this.config.store.appearance.tabsLocation !== 'bottom'
        )
    }

    shouldShowRoyalSidebar (): boolean {
        const tabsLocation = this.config.store?.appearance?.tabsLocation
        return tabsLocation === 'top' || tabsLocation === 'bottom'
    }

    get royalSidebarTitle (): string {
        return this.translate.instant('Explorer')
    }

    get isRoyalSidebarTreeMode (): boolean {
        return this.royalSidebarViewMode === 'tree'
    }

    get royalSidebarToggleAriaLabel (): string {
        if (this.royalSidebarCollapsed) {
            return this.translate.instant('Expand navigation panel')
        }
        return this.translate.instant('Collapse navigation panel')
    }

    get royalSidebarFilterPlaceholder (): string {
        return this.translate.instant('Filter connections and sessions')
    }

    get royalSidebarOptionsAriaLabel (): string {
        return this.translate.instant('Options')
    }

    get allConnectionsSectionTitle (): string {
        return this.translate.instant('All Connections')
    }

    get activeSessionsSectionTitle (): string {
        return this.translate.instant('Active Sessions')
    }

    toggleRoyalSidebar (): void {
        this.beginRoyalSidebarTransition()
        this.royalSidebarCollapsed = !this.royalSidebarCollapsed
        this.saveRoyalFlag(this.royalSidebarCollapsedStorageKey, this.royalSidebarCollapsed)
        this.hideRoyalSidebarPreview()
    }

    onRoyalSidebarTransitionEnd (event: TransitionEvent): void {
        if (
            event.target !== event.currentTarget ||
            !['width', 'flex-basis'].includes(event.propertyName)
        ) {
            return
        }
        this.finishRoyalSidebarTransition()
    }

    onRoyalSidebarBadgeMouseEnter (): void {
        if (!this.royalSidebarCollapsed) {
            return
        }
        this.clearRoyalSidebarPreviewCloseTimer()
        this.royalSidebarPreviewVisible = true
    }

    onRoyalSidebarBadgeMouseLeave (event?: MouseEvent): void {
        if (this.isRoyalSidebarHoverTransition(event?.relatedTarget, '.royal-sidebar')) {
            return
        }
        this.scheduleRoyalSidebarPreviewClose()
    }

    onRoyalSidebarContainerMouseEnter (): void {
        this.clearRoyalSidebarPreviewCloseTimer()
    }

    onRoyalSidebarContainerMouseLeave (): void {
        this.scheduleRoyalSidebarPreviewClose()
    }

    onRoyalSidebarPreviewMouseEnter (): void {
        this.clearRoyalSidebarPreviewCloseTimer()
    }

    onRoyalSidebarPreviewMouseLeave (event?: MouseEvent): void {
        if (this.isRoyalSidebarHoverTransition(event?.relatedTarget, '.royal-sidebar')) {
            return
        }
        this.scheduleRoyalSidebarPreviewClose()
    }

    onRoyalSidebarResizeStart (event: MouseEvent): void {
        if (this.royalSidebarCollapsed || event.button !== 0) {
            return
        }
        event.preventDefault()
        this.royalSidebarResizing = true
        this.royalSidebarResizeStartX = event.clientX
        this.royalSidebarResizeStartWidth = this.royalSidebarWidth
    }

    @HostListener('window:mousemove', ['$event'])
    onWindowMouseMove (event: MouseEvent): void {
        if (!this.royalSidebarResizing) {
            return
        }
        const delta = event.clientX - this.royalSidebarResizeStartX
        this.royalSidebarWidth = this.normalizeRoyalSidebarWidth(this.royalSidebarResizeStartWidth + delta)
    }

    @HostListener('window:mouseup')
    onWindowMouseUp (): void {
        if (!this.royalSidebarResizing) {
            return
        }
        this.royalSidebarResizing = false
        this.saveRoyalSidebarWidth()
    }

    @HostListener('window:blur')
    onWindowBlur (): void {
        this.hideRoyalSidebarPreview()
        if (!this.royalSidebarResizing) {
            return
        }
        this.royalSidebarResizing = false
        this.saveRoyalSidebarWidth()
    }

    @HostListener('window:resize')
    onWindowResize (): void {
        const normalized = this.normalizeRoyalSidebarWidth(this.royalSidebarWidth)
        if (normalized !== this.royalSidebarWidth) {
            this.royalSidebarWidth = normalized
            this.saveRoyalSidebarWidth()
        }
    }

    toggleRoyalGroup (groupKey: string): void {
        if (this.royalCollapsedGroups.has(groupKey)) {
            this.expandRoyalGroup(groupKey)
        } else {
            this.royalCollapsedGroups.add(groupKey)
            this.saveRoyalCollapsedGroups()
        }
    }

    toggleRoyalSingleExpandMode (): void {
        this.royalSingleExpandMode = !this.royalSingleExpandMode
        this.saveRoyalFlag(this.royalSingleExpandModeStorageKey, this.royalSingleExpandMode)
        if (this.royalSingleExpandMode) {
            this.normalizeRoyalExpandedGroups()
        }
    }

    setRoyalSidebarViewMode (mode: RoyalSidebarViewMode): void {
        if (this.royalSidebarViewMode === mode) {
            return
        }
        this.royalSidebarViewMode = mode
        this.saveRoyalSidebarViewMode()
    }

    isRoyalGroupCollapsed (groupKey: string): boolean {
        return this.royalCollapsedGroups.has(groupKey)
    }

    navGroupTrackBy (_index: number, group: RoyalNavigationGroup): RoyalEnvironment {
        return group.id
    }

    navItemTrackBy (_index: number, item: RoyalNavigationItem): BaseTabComponent {
        return item.targetTab
    }

    connectionGroupTrackBy (_index: number, group: RoyalConnectionGroup): string {
        return group.id
    }

    connectionItemTrackBy (_index: number, item: RoyalConnectionItem): string {
        return item.profile.id ?? `${item.profile.type}:${item.title}`
    }

    async activateRoyalConnection (item: RoyalConnectionItem): Promise<void> {
        const profileID = item.profile.id
        const boundTab = profileID ? this.getRoyalConnectionBinding(profileID) : null
        if (boundTab) {
            this.activateRoyalTab(boundTab)
            return
        }

        const tab = await this.profilesService.launchProfile(item.profile)
        if (!profileID || !tab) {
            return
        }

        this.setRoyalConnectionBinding(profileID, tab)
        this.activateRoyalTab(tab)
    }

    async showRoyalConnectionContextMenu (item: RoyalConnectionItem, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()

        const profileID = item.profile.id
        const hasProfileID = typeof profileID === 'string' && profileID.length > 0
        const canDeleteProfile = hasProfileID && item.profile.isBuiltin !== true
        const boundTab = hasProfileID ? this.getRoyalConnectionBinding(profileID) : null
        const hasOpenConnections = hasProfileID && this.getRoyalSessionTargets().some(target => this.getRoyalTabProfileID(target.targetTab) === profileID)
        const menu: MenuItemOptions[] = [
            {
                label: this.translate.instant('Connect'),
                click: () => {
                    void this.profilesService.launchProfile(item.profile)
                },
            },
        ]

        if (item.profile.type === 'ssh') {
            menu.push({
                label: this.translate.instant('Connect SFTP'),
                click: () => {
                    void this.openRoyalSFTPConnection(item.profile)
                },
            })
        }

        menu.push(
            { type: 'separator' },
            {
                label: this.translate.instant('Rename'),
                commandLabel: this.translate.instant('Rename tab'),
                enabled: !!boundTab,
                click: () => {
                    if (boundTab) {
                        this.app.renameTab(boundTab)
                    }
                },
            },
            {
                label: this.translate.instant('Duplicate'),
                commandLabel: this.translate.instant('Duplicate tab'),
                enabled: !!boundTab,
                click: () => {
                    if (boundTab) {
                        void this.duplicateRoyalTab(boundTab)
                    }
                },
            },
        )

        if (canDeleteProfile) {
            menu.push({
                type: 'separator',
            }, {
                label: this.translate.instant('Delete'),
                click: () => {
                    void this.deleteRoyalConnection(item.profile)
                },
            })
        }

        menu.push(
            { type: 'separator' },
            {
                label: this.translate.instant('Close all connections'),
                enabled: hasOpenConnections,
                click: () => {
                    void this.closeRoyalConnections(item.profile)
                },
            },
        )

        this.platform.popupContextMenu(menu, event)
    }

    activateRoyalSession (item: RoyalNavigationItem): void {
        this.activateRoyalTabTarget(item)
    }

    showRoyalSessionContextMenu (item: RoyalNavigationItem, event: MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()

        const menu: MenuItemOptions[] = [
            {
                label: this.translate.instant('Close'),
                commandLabel: this.translate.instant('Close tab'),
                click: () => {
                    void this.closeRoyalSession(item)
                },
            },
        ]

        this.platform.popupContextMenu(menu, event)
    }

    isRoyalConnectionActive (item: RoyalConnectionItem): boolean {
        const boundTab = item.profile.id ? this.getRoyalConnectionBinding(item.profile.id) : null
        return !!boundTab && this.activeRoyalTab === boundTab
    }

    isRoyalSessionActive (item: RoyalNavigationItem): boolean {
        return this.activeRoyalTab === item.targetTab
    }

    royalSessionGroupKey (groupID: RoyalEnvironment): string {
        return `sessions:${groupID}`
    }

    royalConnectionGroupKey (groupID: string): string {
        return `connections:${groupID}`
    }

    private buildFilteredRoyalConnectionGroups (): RoyalConnectionGroup[] {
        const filterText = this.sidebarFilter.trim().toLowerCase()
        if (!filterText) {
            return this.royalConnectionGroups
        }
        return this.royalConnectionGroups
            .map(group => ({
                ...group,
                items: group.items.filter(item => {
                    const searchable = `${item.title} ${item.kind} ${item.description ?? ''}`.toLowerCase()
                    return searchable.includes(filterText)
                }),
            }))
            .filter(group => group.items.length > 0)
    }

    private buildRoyalSessionGroups (): RoyalNavigationGroup[] {
        const groups: Record<RoyalEnvironment, RoyalNavigationGroup> = {
            prod: {
                id: 'prod',
                label: this.translate.instant('Production'),
                toneClass: 'tone-prod',
                items: [],
            },
            lab: {
                id: 'lab',
                label: this.translate.instant('Lab / Stage'),
                toneClass: 'tone-lab',
                items: [],
            },
            dev: {
                id: 'dev',
                label: this.translate.instant('Dev / Test'),
                toneClass: 'tone-dev',
                items: [],
            },
            other: {
                id: 'other',
                label: this.translate.instant('Other'),
                toneClass: 'tone-other',
                items: [],
            },
        }

        const normalizedFilter = this.sidebarFilter.trim().toLowerCase()
        const primaryTabs = new Set([...this.getRoyalPrimaryConnectionTargets().values()].map(target => target.targetTab))
        for (const target of this.getRoyalSessionTargets()) {
            const tab = target.targetTab
            if (primaryTabs.has(tab)) {
                continue
            }

            const title = this.getRoyalTabLabel(tab)
            const kind = this.getRoyalTabKind(tab)
            const profileID = this.getRoyalTabProfileID(tab)
            const isSFTPTab = this.isRoyalSFTPTab(tab)

            let environment = this.detectRoyalEnvironment(title)
            if ((profileID ?? false) || isSFTPTab) {
                environment = 'other'
            }
            const searchText = `${title} ${kind} ${environment}`.toLowerCase()

            if (normalizedFilter.length > 0 && !searchText.includes(normalizedFilter)) {
                continue
            }

            groups[environment].items.push({
                hostTab: target.hostTab,
                targetTab: tab,
                title,
                kind,
            })
        }

        return (['prod', 'lab', 'dev', 'other'] as RoyalEnvironment[])
            .map(groupID => groups[groupID])
            .filter(group => group.items.length > 0)
    }

    private recomputeRoyalSidebarGroups (): void {
        if (!this.shouldShowRoyalSidebar()) {
            this.filteredRoyalConnectionGroups = []
            this.royalSessionGroups = []
            return
        }
        this.filteredRoyalConnectionGroups = this.buildFilteredRoyalConnectionGroups()
        this.royalSessionGroups = this.buildRoyalSessionGroups()
    }

    onSidebarFilterChange (value: string): void {
        this.sidebarFilter = value
        this.recomputeRoyalSidebarGroups()
    }

    private getRoyalTabLabel (tab: BaseTabComponent): string {
        const customTitle = typeof tab.customTitle === 'string' ? tab.customTitle.trim() : ''
        const title = typeof tab.title === 'string' ? tab.title.trim() : ''
        return customTitle || title || this.translate.instant('Untitled session')
    }

    private getRoyalTabKind (tab: BaseTabComponent): string {
        const kinds = this.getRoyalTabKinds(tab)
        if (kinds.length === 0) {
            return this.translate.instant('Session')
        }
        if (kinds.length === 1) {
            return kinds[0]
        }
        if (kinds.length === 2) {
            return `${kinds[0]} · ${kinds[1]}`
        }
        return `${kinds[0]} · ${kinds[1]} +${kinds.length - 2}`
    }

    private getRoyalTabKinds (tab: BaseTabComponent): string[] {
        const constructorKind = this.getRoyalConstructorKind(tab)
        const profileKind = this.getRoyalProfileTypeKind(tab)

        if (profileKind && (!constructorKind || this.isGenericRoyalTabKind(constructorKind))) {
            return [profileKind]
        }
        if (constructorKind) {
            return [constructorKind]
        }
        if (profileKind) {
            return [profileKind]
        }
        return []
    }

    private getRoyalResolvedActiveTab (): BaseTabComponent|null {
        const activeTab = this.app.activeTab
        if (!activeTab) {
            return null
        }
        return activeTab
    }

    private getRoyalSessionTargets (): RoyalTabTarget[] {
        return this.app.tabs.map(tab => ({ hostTab: tab, targetTab: tab }))
    }

    private getRoyalPrimaryConnectionTargets (): Map<string, RoyalTabTarget> {
        this.cleanupRoyalConnectionBindings()

        const result = new Map<string, RoyalTabTarget>()
        for (const [profileID, tab] of this.royalConnectionBindings.entries()) {
            const target = this.getRoyalTabTarget(tab)
            if (!target) {
                continue
            }
            result.set(profileID, target)
        }

        return result
    }

    private getRoyalConnectionBinding (profileID: string|null|undefined): BaseTabComponent|null {
        if (!profileID) {
            return null
        }

        const tab = this.royalConnectionBindings.get(profileID) ?? null
        if (!tab) {
            return null
        }

        if (this.getRoyalTabProfileID(tab) !== profileID || !this.getRoyalTabTarget(tab)) {
            this.royalConnectionBindings.delete(profileID)
            return null
        }

        return tab
    }

    private setRoyalConnectionBinding (profileID: string, tab: BaseTabComponent): void {
        if (this.getRoyalTabProfileID(tab) !== profileID || this.isRoyalSFTPTab(tab) || !this.getRoyalTabTarget(tab)) {
            return
        }

        this.royalConnectionBindings.set(profileID, tab)
    }

    private cleanupRoyalConnectionBindings (): void {
        for (const [profileID, tab] of [...this.royalConnectionBindings.entries()]) {
            if (this.getRoyalTabProfileID(tab) !== profileID || !this.getRoyalTabTarget(tab)) {
                this.royalConnectionBindings.delete(profileID)
            }
        }
    }

    private restoreRoyalConnectionBindingsFromTabs (): void {
        for (const target of this.getRoyalSessionTargets()) {
            const profileID = this.getRoyalTabProfileID(target.targetTab)
            if (!profileID || this.getRoyalConnectionBinding(profileID) !== null || this.isRoyalSFTPTab(target.targetTab)) {
                continue
            }
            this.setRoyalConnectionBinding(profileID, target.targetTab)
        }
        this.scheduleRoyalActiveSync()
    }

    private startRoyalRestoredBindingsRecovery (): void {
        this.restoreRoyalConnectionBindingsFromTabs()
        this.royalRestoredBindingCandidates = new Set(this.app.tabs)
        this.royalRestoreBindingsAttempt = 0
        this.stopRoyalRestoredBindingsRecovery()
        this.restoreRoyalConnectionBindingsFromRestoredCandidates()
    }

    private stopRoyalRestoredBindingsRecovery (): void {
        this.royalRestoreBindingsRetryHandle = this.clearScheduledTimeout(this.royalRestoreBindingsRetryHandle)
    }

    private restoreRoyalConnectionBindingsFromRestoredCandidates (): void {
        this.cleanupRoyalConnectionBindings()

        for (const hostTab of [...this.royalRestoredBindingCandidates]) {
            if (!this.app.tabs.includes(hostTab)) {
                this.royalRestoredBindingCandidates.delete(hostTab)
                continue
            }

            const targetTabs = this.getRoyalRestoredBindingTargets(hostTab)
            if (!targetTabs.length) {
                this.royalRestoredBindingCandidates.delete(hostTab)
                continue
            }

            for (const targetTab of targetTabs) {
                if (this.isRoyalSFTPTab(targetTab)) {
                    continue
                }

                const profileID = this.getRoyalTabProfileID(targetTab)
                if (!profileID || this.getRoyalConnectionBinding(profileID)) {
                    continue
                }

                this.setRoyalConnectionBinding(profileID, targetTab)
            }

            this.royalRestoredBindingCandidates.delete(hostTab)
        }

        this.scheduleRoyalActiveSync()

        if (!this.royalRestoredBindingCandidates.size) {
            this.stopRoyalRestoredBindingsRecovery()
            return
        }

        this.royalRestoreBindingsAttempt++
        if (this.royalRestoreBindingsAttempt >= this.royalRestoreBindingsMaxAttempts) {
            this.royalRestoredBindingCandidates.clear()
            this.stopRoyalRestoredBindingsRecovery()
            return
        }

        this.royalRestoreBindingsRetryHandle = this.scheduleTimeout(() => {
            this.restoreRoyalConnectionBindingsFromRestoredCandidates()
        }, this.royalRestoreBindingsRetryDelay)
    }

    private getRoyalRestoredBindingTargets (hostTab: BaseTabComponent): BaseTabComponent[] {
        return [hostTab]
    }

    private getRoyalTabProfileID (tab: BaseTabComponent|null): string|null {
        const profile = (tab as BaseTabComponent & { profile?: PartialProfile<Profile>|null }).profile
        return profile?.id ?? null
    }

    private isRoyalSFTPTab (tab: BaseTabComponent): boolean {
        return this.getRoyalConstructorKind(tab) === 'SFTP'
    }

    private getRoyalTabTarget (tab: BaseTabComponent|null): RoyalTabTarget|null {
        if (!tab) {
            return null
        }

        const hostTab = tab.topmostParent ?? tab
        if (!this.app.tabs.includes(hostTab)) {
            return null
        }

        return {
            hostTab,
            targetTab: tab,
        }
    }

    private activateRoyalTab (tab: BaseTabComponent): void {
        const target = this.getRoyalTabTarget(tab)
        if (!target) {
            return
        }
        this.activateRoyalTabTarget(target)
    }

    private activateRoyalTabTarget (target: RoyalTabTarget): void {
        this.app.selectTab(target.hostTab)
        this.scheduleRoyalActiveSync()
    }

    private observeRoyalTab (_tab: BaseTabComponent): void {
        // No-op without split tabs
    }

    private syncRoyalActiveConnection (): void {
        this.cleanupRoyalConnectionBindings()
        this.activeRoyalTab = this.getRoyalResolvedActiveTab()
        this.recomputeRoyalSidebarGroups()
        this.ensureRoyalActiveGroupExpanded()
    }

    private getRoyalProfileTypeKind (tab: BaseTabComponent): string|null {
        const profile = (tab as BaseTabComponent & { profile?: PartialProfile<Profile>|null }).profile
        if (!profile?.type) {
            return null
        }
        return profile.type
            .replace(/[-_]+/g, ' ')
            .trim()
            .toUpperCase()
    }

    private getRoyalConstructorKind (tab: BaseTabComponent): string {
        const constructorName = tab.constructor.name || 'Session'
        return constructorName
            .replace(/Component$/, '')
            .replace(/Tab$/, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .trim()
    }

    private isGenericRoyalTabKind (kind: string): boolean {
        return ['Session', 'Tab', 'Terminal'].includes(kind)
    }

    private detectRoyalEnvironment (name: string): RoyalEnvironment {
        const normalized = name.toLowerCase()
        if (/\b(prod|production|live)\b/.test(normalized)) {
            return 'prod'
        }
        if (/\b(lab|stage|staging|preprod|uat)\b/.test(normalized)) {
            return 'lab'
        }
        if (/\b(dev|test|qa|sandbox)\b/.test(normalized)) {
            return 'dev'
        }
        return 'other'
    }

    private toneClassForEnvironment (environment: RoyalEnvironment): string {
        return {
            prod: 'tone-prod',
            lab: 'tone-lab',
            dev: 'tone-dev',
            other: 'tone-other',
        }[environment]
    }

    private ensureRoyalActiveGroupExpanded (): void {
        const activeGroupKey = this.getRoyalActiveGroupKey()
        if (!activeGroupKey) {
            return
        }
        this.expandRoyalGroup(activeGroupKey)
    }

    private getRoyalActiveGroupKey (): string|null {
        const activeTab = this.activeRoyalTab
        if (!activeTab) {
            return null
        }

        const profileID = this.getRoyalTabProfileID(activeTab)
        if (profileID && this.getRoyalConnectionBinding(profileID) === activeTab) {
            for (const group of this.royalConnectionGroups) {
                if (group.items.some(item => item.profile.id === profileID)) {
                    return this.royalConnectionGroupKey(group.id)
                }
            }
        }

        for (const group of this.royalSessionGroups) {
            if (group.items.some(item => item.targetTab === activeTab)) {
                return this.royalSessionGroupKey(group.id)
            }
        }

        return null
    }

    private expandRoyalGroup (groupKey: string): void {
        let changed = false

        if (this.royalSingleExpandMode) {
            changed = this.collapseRoyalSiblingGroups(groupKey) || changed
        }

        if (this.royalCollapsedGroups.delete(groupKey)) {
            changed = true
        }

        if (changed) {
            this.saveRoyalCollapsedGroups()
        }
    }

    private collapseRoyalSiblingGroups (groupKey: string): boolean {
        let changed = false
        for (const key of this.getRoyalSectionGroupKeys(groupKey)) {
            if (key === groupKey) {
                continue
            }
            if (!this.royalCollapsedGroups.has(key)) {
                this.royalCollapsedGroups.add(key)
                changed = true
            }
        }
        return changed
    }

    private normalizeRoyalExpandedGroups (): void {
        const activeGroupKey = this.getRoyalActiveGroupKey()
        const connectionChanged = this.normalizeRoyalExpandedSection(this.getRoyalConnectionGroupKeys(), activeGroupKey)
        const sessionChanged = this.normalizeRoyalExpandedSection(this.getRoyalSessionGroupKeys(), activeGroupKey)

        if (connectionChanged || sessionChanged) {
            this.saveRoyalCollapsedGroups()
        }
    }

    private normalizeRoyalExpandedSection (groupKeys: string[], preferredGroupKey: string|null): boolean {
        const expandedGroupKeys = groupKeys.filter(key => !this.royalCollapsedGroups.has(key))
        if (expandedGroupKeys.length <= 1) {
            return false
        }

        const keepGroupKey = preferredGroupKey && groupKeys.includes(preferredGroupKey) ? preferredGroupKey : expandedGroupKeys[0]
        let changed = false

        if (this.royalCollapsedGroups.delete(keepGroupKey)) {
            changed = true
        }

        for (const key of groupKeys) {
            if (key === keepGroupKey) {
                continue
            }
            if (!this.royalCollapsedGroups.has(key)) {
                this.royalCollapsedGroups.add(key)
                changed = true
            }
        }

        return changed
    }

    private getRoyalSectionGroupKeys (groupKey: string): string[] {
        if (groupKey.startsWith('connections:')) {
            return this.getRoyalConnectionGroupKeys()
        }
        if (groupKey.startsWith('sessions:')) {
            return this.getRoyalSessionGroupKeys()
        }
        return []
    }

    private getRoyalConnectionGroupKeys (): string[] {
        return this.royalConnectionGroups.map(group => this.royalConnectionGroupKey(group.id))
    }

    private getRoyalSessionGroupKeys (): string[] {
        return (['prod', 'lab', 'dev', 'other'] as RoyalEnvironment[])
            .map(groupID => this.royalSessionGroupKey(groupID))
    }

    private async refreshRoyalConnections (): Promise<void> {
        if (!this.shouldShowRoyalSidebar()) {
            this.royalConnectionGroups = []
            this.recomputeRoyalSidebarGroups()
            return
        }
        const refreshToken = ++this.royalConnectionsRefreshToken
        try {
            const groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })
            groups.sort((a, b) => a.name.localeCompare(b.name))
            groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !b.editable ? 1 : 0))
            groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))

            const mapped = groups
                .map(group => this.intoRoyalConnectionGroup(group))
                .filter(group => group.items.length > 0)

            if (refreshToken !== this.royalConnectionsRefreshToken) {
                return
            }

            this.royalConnectionGroups = mapped
            this.scheduleRoyalActiveSync()
        } catch (error) {
            this.logger.warn('Failed to refresh connection sidebar', error)
        }
    }

    private intoRoyalConnectionGroup (group: PartialProfileGroup<ProfileGroup>): RoyalConnectionGroup {
        const environment = this.detectRoyalEnvironment(group.name)
        return {
            id: group.id,
            label: group.name || this.translate.instant('Ungrouped'),
            toneClass: this.toneClassForEnvironment(environment),
            items: (group.profiles ?? [])
                .filter(profile => this.isRoyalConnectionVisible(profile))
                .map(profile => ({
                    profile,
                    title: profile.name,
                    description: this.profilesService.getDescription(profile),
                    kind: this.getRoyalConnectionKind(profile),
                })),
        }
    }

    private getRoyalConnectionKind (profile: PartialProfile<Profile>): string {
        return this.profilesService.providerForProfile(profile)?.name ?? profile.type.toUpperCase()
    }

    private async openRoyalSFTPConnection (profile: PartialProfile<Profile>): Promise<void> {
        if (!this.sftpTabOpener) {
            this.logger.warn('SFTP tab opener is unavailable')
            return
        }

        try {
            await this.sftpTabOpener.openForProfile(profile)
        } catch (error) {
            this.logger.warn('Failed to open SFTP tab from connection sidebar', error)
        }
    }

    private async closeRoyalConnections (profile: PartialProfile<Profile>): Promise<void> {
        if (!profile.id) {
            return
        }

        const tabs = [...new Set(
            this.getRoyalSessionTargets()
                .filter(target => this.getRoyalTabProfileID(target.targetTab) === profile.id)
                .map(target => target.targetTab),
        )]

        for (const tab of tabs) {
            await this.closeRoyalTab(tab)
        }
    }

    private async deleteRoyalConnection (profile: PartialProfile<Profile>): Promise<void> {
        const profileID = typeof profile.id === 'string' && profile.id.length > 0 ? profile.id : null
        if (profileID === null || profile.isBuiltin === true) {
            return
        }

        const confirmed = (await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', profile),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0

        if (!confirmed) {
            return
        }

        await this.closeRoyalConnections(profile)
        await this.profilesService.deleteProfile(profile)
        await this.config.save()
        this.royalConnectionBindings.delete(profileID)
        this.recomputeRoyalSidebarGroups()
        this.scheduleViewRefresh()
    }

    private async duplicateRoyalTab (tab: BaseTabComponent): Promise<void> {
        const duplicate = await this.tabsService.duplicate(tab)
        if (!duplicate) {
            return
        }

        const target = this.getRoyalTabTarget(tab)
        const hostTabIndex = target ? this.app.tabs.indexOf(target.hostTab) : -1
        this.app.addTabRaw(duplicate, hostTabIndex >= 0 ? hostTabIndex + 1 : null)
    }

    private async closeRoyalSession (item: RoyalNavigationItem): Promise<void> {
        await this.closeRoyalTab(item.targetTab)
    }

    private async closeRoyalTab (tab: BaseTabComponent): Promise<void> {
        await this.app.closeTab(tab, true)
    }

    private isRoyalConnectionVisible (profile: PartialProfile<Profile>): boolean {
        if (!profile.id) {
            return false
        }

        if (profile.isTemplate) {
            return false
        }

        if (!this.config.store.terminal.showBuiltinProfiles && profile.isBuiltin) {
            return false
        }

        if (this.config.store.profileBlacklist.includes(profile.id)) {
            return false
        }

        return true
    }

    private restoreRoyalPreferences (): void {
        this.royalSidebarCollapsed = this.readRoyalFlag(this.royalSidebarCollapsedStorageKey, false)
        this.royalSidebarWidth = this.readRoyalSidebarWidth()
        this.royalCollapsedGroups = new Set(this.readRoyalCollapsedGroups())
        this.royalSingleExpandMode = this.readRoyalFlag(this.royalSingleExpandModeStorageKey, false)
        this.royalSidebarViewMode = this.readRoyalSidebarViewMode()
    }

    private readRoyalFlag (key: string, fallback: boolean): boolean {
        try {
            const value = localStorage.getItem(key)
            if (value === null) {
                return fallback
            }
            return value === '1'
        } catch {
            return fallback
        }
    }

    private saveRoyalFlag (key: string, value: boolean): void {
        try {
            localStorage.setItem(key, value ? '1' : '0')
        } catch {
            // Ignore storage errors (private mode, restricted env).
        }
    }

    private readRoyalSidebarViewMode (): RoyalSidebarViewMode {
        try {
            return localStorage.getItem(this.royalSidebarViewModeStorageKey) === 'tree' ? 'tree' : 'cards'
        } catch {
            return 'cards'
        }
    }

    private saveRoyalSidebarViewMode (): void {
        try {
            localStorage.setItem(this.royalSidebarViewModeStorageKey, this.royalSidebarViewMode)
        } catch {
            // Ignore storage errors (private mode, restricted env).
        }
    }

    private readRoyalSidebarWidth (): number {
        try {
            return this.normalizeRoyalSidebarWidth(localStorage.getItem(this.royalSidebarWidthStorageKey))
        } catch {
            return this.royalSidebarDefaultWidth
        }
    }

    private saveRoyalSidebarWidth (): void {
        try {
            localStorage.setItem(this.royalSidebarWidthStorageKey, `${this.royalSidebarWidth}`)
        } catch {
            // Ignore storage errors (private mode, restricted env).
        }
    }

    private clearRoyalSidebarPreviewCloseTimer (): void {
        this.royalSidebarPreviewCloseHandle = this.clearScheduledTimeout(this.royalSidebarPreviewCloseHandle)
    }

    private scheduleRoyalSidebarPreviewClose (): void {
        if (!this.royalSidebarCollapsed) {
            this.hideRoyalSidebarPreview()
            return
        }
        this.clearRoyalSidebarPreviewCloseTimer()
        this.royalSidebarPreviewCloseHandle = this.scheduleTimeout(() => {
            this.royalSidebarPreviewCloseHandle = null
            this.royalSidebarPreviewVisible = false
        }, this.royalSidebarPreviewCloseDelay)
    }

    private hideRoyalSidebarPreview (): void {
        this.clearRoyalSidebarPreviewCloseTimer()
        this.royalSidebarPreviewVisible = false
    }

    private isRoyalSidebarHoverTransition (target: EventTarget|null|undefined, selector: string): boolean {
        if (!(target instanceof Element)) {
            return false
        }
        return !!target.closest(selector)
    }

    private readRoyalCollapsedGroups (): string[] {
        try {
            const serialized = localStorage.getItem(this.royalCollapsedGroupsStorageKey)
            if (!serialized) {
                return []
            }
            return serialized.split(',').filter(item => item.length > 0)
        } catch {
            return []
        }
    }

    private saveRoyalCollapsedGroups (): void {
        try {
            localStorage.setItem(this.royalCollapsedGroupsStorageKey, [...this.royalCollapsedGroups].join(','))
        } catch {
            // Ignore storage errors (private mode, restricted env).
        }
    }

    private normalizeFixedTabWidth (value: unknown): number {
        return this.clampNumber(value, this.minFixedTabWidth, this.maxFixedTabWidth, this.defaultFixedTabWidth)
    }

    private normalizeRoyalSidebarWidth (value: unknown): number {
        return this.clampNumber(value, this.royalSidebarMinWidth, this.royalSidebarMaxWidth, this.royalSidebarDefaultWidth)
    }

    private clampNumber (value: unknown, min: number, max: number, fallback: number): number {
        const numericValue = Number(value)
        if (!Number.isFinite(numericValue)) {
            return fallback
        }
        return Math.max(min, Math.min(max, Math.round(numericValue)))
    }

    private syncWindowOpacity (): void {
        const hostWindowWithOpacity = this.hostWindow as HostWindowService & { setOpacity?: (opacity: number) => void }
        const shouldBeVibrant = this.ready && !!this.config.store?.appearance?.vibrancy
        if (this.pendingVibrancySync) {
            this.pendingVibrancySync = this.clearScheduledTimeout(this.pendingVibrancySync)
        }
        this.pendingVibrancySync = this.scheduleTimeout(() => {
            document.querySelector('app-root')?.classList.toggle('vibrant', shouldBeVibrant)
            this.pendingVibrancySync = null
        })
        const opacity = this.normalizeWindowOpacity(this.config.store?.appearance?.opacity)
        if (typeof hostWindowWithOpacity.setOpacity === 'function' && typeof opacity === 'number') {
            hostWindowWithOpacity.setOpacity(opacity)
        }
    }

    private normalizeWindowOpacity (value: unknown): number {
        const numericValue = Number(value)
        const maxOpacity = 1
        const minOpacity = this.getMinWindowOpacity()
        if (!Number.isFinite(numericValue)) {
            return maxOpacity
        }
        return Math.max(minOpacity, Math.min(maxOpacity, numericValue))
    }

    private getMinWindowOpacity (): number {
        if (this.hostApp.platform !== Platform.macOS) {
            return this.minVibrantWindowOpacity
        }
        return this.config.store?.appearance?.vibrancy ? this.minVibrantWindowOpacity : this.minMacOSWindowOpacity
    }

    ngOnDestroy (): void {
        this.destroyed = true
        this.pendingPreloadHideCheck = this.clearScheduledTimeout(this.pendingPreloadHideCheck)
        this.pendingRoyalActiveSync = this.clearScheduledTimeout(this.pendingRoyalActiveSync)
        this.pendingViewRefresh = this.clearScheduledTimeout(this.pendingViewRefresh)
        this.pendingTabSurfaceSync = this.clearScheduledTimeout(this.pendingTabSurfaceSync)
        this.pendingVibrancySync = this.clearScheduledTimeout(this.pendingVibrancySync)
        this.royalSidebarPreviewCloseHandle = this.clearScheduledTimeout(this.royalSidebarPreviewCloseHandle)
        this.royalSidebarTransitionFallbackHandle = this.clearScheduledTimeout(this.royalSidebarTransitionFallbackHandle)
        this.royalRestoreBindingsRetryHandle = this.clearScheduledTimeout(this.royalRestoreBindingsRetryHandle)
        this.clearPendingIdleCallbacks()
        this.clearPendingTimeouts()
        if (this.updatesCheckInterval !== null) {
            clearInterval(this.updatesCheckInterval)
            this.updatesCheckInterval = null
        }
    }

    private scheduleIdleTask (fn: () => void, delay = 0, timeout = 1000): void {
        this.scheduleTimeout(() => {
            this.scheduleIdleCallback(fn, timeout)
        }, delay)
    }

    private scheduleIdleCallback (fn: () => void, timeout = 1000): number | null {
        if (this.destroyed) {
            return null
        }
        const idleGlobal = globalThis as IdleCallbackGlobal
        if (idleGlobal.requestIdleCallback) {
            let handle = 0
            handle = idleGlobal.requestIdleCallback(() => {
                this.pendingIdleCallbacks.delete(handle)
                if (this.destroyed) {
                    return
                }
                fn()
            }, { timeout })
            this.pendingIdleCallbacks.add(handle)
            return handle
        }
        return this.scheduleTimeout(fn, this.startupIdleFallbackDelay)
    }

    private scheduleTimeout (fn: () => void, delay = 0): number | null {
        if (this.destroyed) {
            return null
        }
        const handle = window.setTimeout(() => {
            this.pendingTimeouts.delete(handle)
            if (this.destroyed) {
                return
            }
            fn()
        }, delay)
        this.pendingTimeouts.add(handle)
        return handle
    }

    private clearScheduledTimeout (handle: number | null): number | null {
        if (handle === null) {
            return null
        }
        window.clearTimeout(handle)
        this.pendingTimeouts.delete(handle)
        return null
    }

    private clearPendingIdleCallbacks (): void {
        const idleGlobal = globalThis as IdleCallbackGlobal
        if (!idleGlobal.cancelIdleCallback) {
            this.pendingIdleCallbacks.clear()
            return
        }
        for (const handle of this.pendingIdleCallbacks) {
            idleGlobal.cancelIdleCallback(handle)
        }
        this.pendingIdleCallbacks.clear()
    }

    private clearPendingTimeouts (): void {
        for (const handle of this.pendingTimeouts) {
            window.clearTimeout(handle)
        }
        this.pendingTimeouts.clear()
    }
}
