/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, HostListener, HostBinding, ViewChildren, ViewChild } from '@angular/core'
import { trigger, style, animate, transition, state } from '@angular/animations'
import { NgbDropdown, NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop'
import { TranslateService } from '@ngx-translate/core'

import { HostAppService, Platform } from '../api/hostApp'
import { HotkeysService } from '../services/hotkeys.service'
import { Logger, LogService } from '../services/log.service'
import { ConfigService } from '../services/config.service'
import { ThemesService } from '../services/themes.service'
import { UpdaterService } from '../services/updater.service'
import { CommandService } from '../services/commands.service'
import { ProfilesService } from '../services/profiles.service'

import { BaseTabComponent } from './baseTab.component'
import { SafeModeModalComponent } from './safeModeModal.component'
import { TabBodyComponent } from './tabBody.component'
import { SplitTabComponent } from './splitTab.component'
import { AppService, Command, CommandLocation, FileTransfer, HostWindowService, PartialProfile, PartialProfileGroup, PlatformService, Profile, ProfileGroup } from '../api'

type RoyalEnvironment = 'prod'|'lab'|'dev'|'other'

interface RoyalNavigationItem {
    tab: BaseTabComponent
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
    selector: 'app-root',
    templateUrl: './appRoot.component.pug',
    styleUrls: ['./appRoot.component.scss'],
    animations: [
        trigger('animateTab', makeTabAnimation('width', 200)),
    ],
})
export class AppRootComponent {
    Platform = Platform
    @Input() ready = false
    @Input() leftToolbarButtons: Command[]
    @Input() rightToolbarButtons: Command[]
    @HostBinding('class.platform-win32') platformClassWindows = process.platform === 'win32'
    @HostBinding('class.platform-darwin') platformClassMacOS = process.platform === 'darwin'
    @HostBinding('class.platform-linux') platformClassLinux = process.platform === 'linux'
    @HostBinding('class.no-tabs') noTabs = true
    @ViewChildren(TabBodyComponent) tabBodies: TabBodyComponent[]
    @ViewChild('activeTransfersDropdown') activeTransfersDropdown: NgbDropdown
    unsortedTabs: BaseTabComponent[] = []
    updatesAvailable = false
    activeTransfers: FileTransfer[] = []
    royalSidebarCollapsed = false
    sidebarFilter = ''
    royalConnectionGroups: RoyalConnectionGroup[] = []
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
    private royalCollapsedGroups = new Set<string>()
    private royalConnectionsRefreshToken = 0
    private royalSidebarResizing = false
    private royalSidebarResizeStartX = 0
    private royalSidebarResizeStartWidth = this.royalSidebarDefaultWidth

    constructor (
        private hotkeys: HotkeysService,
        private commands: CommandService,
        private profilesService: ProfilesService,
        private translate: TranslateService,
        public updater: UpdaterService,
        public hostWindow: HostWindowService,
        public hostApp: HostAppService,
        public config: ConfigService,
        public app: AppService,
        platform: PlatformService,
        log: LogService,
        ngbModal: NgbModal,
        _themes: ThemesService,
    ) {
        this.restoreRoyalPreferences()

        // document.querySelector('app-root')?.remove()
        this.logger = log.create('main')
        this.logger.info('v', platform.getAppVersion())

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
                if (hotkey === 'restart-tab') {
                    this.app.duplicateTab(this.app.activeTab)
                    this.app.closeTab(this.app.activeTab, true)
                }
                if (hotkey === 'explode-tab' && this.app.activeTab instanceof SplitTabComponent) {
                    this.app.explodeTab(this.app.activeTab)
                }
                if (hotkey === 'combine-tabs' && this.app.activeTab instanceof SplitTabComponent) {
                    this.app.combineTabsInto(this.app.activeTab)
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

        if (window['safeModeReason']) {
            ngbModal.open(SafeModeModalComponent)
        }

        this.app.tabOpened$.subscribe(tab => {
            this.unsortedTabs.push(tab)
            this.noTabs = false
            this.app.emitTabDragEnded()
        })

        this.app.tabRemoved$.subscribe(tab => {
            for (const tabBody of this.tabBodies) {
                if (tabBody.tab === tab) {
                    tabBody.detach()
                }
            }
            this.unsortedTabs = this.unsortedTabs.filter(x => x !== tab)
            this.noTabs = app.tabs.length === 0
            this.app.emitTabDragEnded()
        })

        platform.fileTransferStarted$.subscribe(transfer => {
            this.activeTransfers.push(transfer)
            this.activeTransfersDropdown.open()
        })

        config.ready$.toPromise().then(async () => {
            this.leftToolbarButtons = await this.getToolbarButtons(false)
            this.rightToolbarButtons = await this.getToolbarButtons(true)
            await this.refreshRoyalConnections()
            this.syncWindowOpacity()
            this.config.changed$.subscribe(() => {
                this.syncWindowOpacity()
                void this.refreshRoyalConnections()
            })

            setInterval(() => {
                if (this.config.store.enableAutomaticUpdates) {
                    this.updater.check().then(available => {
                        this.updatesAvailable = available
                    })
                }
            }, 3600 * 12 * 1000)
        })
    }

    async ngOnInit () {
        this.config.ready$.toPromise().then(() => {
            this.ready = true
            this.syncWindowOpacity()
            this.app.emitReady()
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
        return this.config.store.appearance.tabsLocation === 'left' || this.config.store.appearance.tabsLocation === 'right'
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
        const tab: BaseTabComponent = event.item.data
        if (!this.app.tabs.includes(tab)) {
            if (tab.parent instanceof SplitTabComponent) {
                tab.parent.removeTab(tab)
                this.app.wrapAndAddTab(tab)
            }
        }
        moveItemInArray(this.app.tabs, event.previousIndex, event.currentIndex)
        this.app.emitTabsChanged()
    }

    onTransfersChange () {
        if (this.activeTransfers.length === 0) {
            this.activeTransfersDropdown.close()
        }
    }

    @HostBinding('class.vibrant') get isVibrant () {
        return this.config.store?.appearance.vibrancy
    }

    private async getToolbarButtons (aboveZero: boolean): Promise<Command[]> {
        return (await this.commands.getCommands({ tab: this.app.activeTab ?? undefined }))
            .filter(x => x.locations?.includes(aboveZero ? CommandLocation.RightToolbar : CommandLocation.LeftToolbar))
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
        const tabsLocation = this.config.store.appearance.tabsLocation
        return tabsLocation === 'top' || tabsLocation === 'bottom'
    }

    get royalSidebarTitle (): string {
        return this.translate.instant('Explorer')
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

    get allConnectionsSectionTitle (): string {
        return this.translate.instant('All Connections')
    }

    get activeSessionsSectionTitle (): string {
        return this.translate.instant('Active Sessions')
    }

    toggleRoyalSidebar (): void {
        this.royalSidebarCollapsed = !this.royalSidebarCollapsed
        this.saveRoyalFlag(this.royalSidebarCollapsedStorageKey, this.royalSidebarCollapsed)
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
            this.royalCollapsedGroups.delete(groupKey)
        } else {
            this.royalCollapsedGroups.add(groupKey)
        }
        this.saveRoyalCollapsedGroups()
    }

    isRoyalGroupCollapsed (groupKey: string): boolean {
        return this.royalCollapsedGroups.has(groupKey)
    }

    royalGroupToggleIcon (groupKey: string): string {
        return this.isRoyalGroupCollapsed(groupKey) ? '▸' : '▾'
    }

    navGroupTrackBy (_index: number, group: RoyalNavigationGroup): RoyalEnvironment {
        return group.id
    }

    navItemTrackBy (_index: number, item: RoyalNavigationItem): BaseTabComponent {
        return item.tab
    }

    connectionGroupTrackBy (_index: number, group: RoyalConnectionGroup): string {
        return group.id
    }

    connectionItemTrackBy (_index: number, item: RoyalConnectionItem): string {
        return item.profile.id ?? `${item.profile.type}:${item.title}`
    }

    launchRoyalConnection (item: RoyalConnectionItem): void {
        this.profilesService.launchProfile(item.profile)
    }

    royalSessionGroupKey (groupID: RoyalEnvironment): string {
        return `sessions:${groupID}`
    }

    royalConnectionGroupKey (groupID: string): string {
        return `connections:${groupID}`
    }

    get filteredRoyalConnectionGroups (): RoyalConnectionGroup[] {
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

    get royalSessionGroups (): RoyalNavigationGroup[] {
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
        for (const tab of this.app.tabs) {
            const title = this.getRoyalTabLabel(tab)
            const kind = this.getRoyalTabKind(tab)
            const environment = this.detectRoyalEnvironment(title)
            const searchText = `${title} ${kind} ${environment}`.toLowerCase()

            if (normalizedFilter.length > 0 && !searchText.includes(normalizedFilter)) {
                continue
            }

            groups[environment].items.push({ tab, title, kind })
        }

        return (['prod', 'lab', 'dev', 'other'] as RoyalEnvironment[])
            .map(groupID => groups[groupID])
            .filter(group => group.items.length > 0)
    }

    private getRoyalTabLabel (tab: BaseTabComponent): string {
        const title = tab.customTitle.trim() || tab.title.trim()
        return title || this.translate.instant('Untitled session')
    }

    private getRoyalTabKind (tab: BaseTabComponent): string {
        const constructorName = tab.constructor.name || 'Session'
        return constructorName
            .replace(/Component$/, '')
            .replace(/Tab$/, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .trim() || this.translate.instant('Session')
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

    private async refreshRoyalConnections (): Promise<void> {
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
        const opacity = this.config.store?.appearance?.opacity
        if (typeof hostWindowWithOpacity.setOpacity === 'function' && typeof opacity === 'number') {
            hostWindowWithOpacity.setOpacity(opacity)
        }
    }
}
