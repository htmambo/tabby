/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, HostBinding, HostListener, Injector, NgZone } from '@angular/core'
import { auditTime } from 'rxjs'
import { TabContextMenuItemProvider } from '../api/tabContextMenuProvider'
import { BaseTabComponent } from './baseTab.component'
import { AppService } from '../services/app.service'
import { HostAppService, Platform } from '../api/hostApp'
import { ConfigService } from '../services/config.service'
import { BaseComponent } from './base.component'
import { MenuItemOptions } from '../api/menu'
import { PlatformService } from '../api/platform'

/** @hidden */
@Component({
    standalone: false,
    selector: 'tab-header',
    templateUrl: './tabHeader.component.pug',
    styleUrls: ['./tabHeader.component.scss'],
})
export class TabHeaderComponent extends BaseComponent {
    @Input() index: number
    @Input() @HostBinding('class.active') active: boolean
    @Input() tab: BaseTabComponent
    @Input() progress: number|null
    Platform = Platform
    private dragEndTimeout: number | null = null
    private contextMenuProvidersInstance: TabContextMenuItemProvider[] | null = null
    private platformInstance: PlatformService | null = null

    constructor (
        private injector: Injector,
        public app: AppService,
        public config: ConfigService,
        public hostApp: HostAppService,
        private zone: NgZone,
    ) {
        super()
    }

    protected get contextMenuProviders (): TabContextMenuItemProvider[] {
        if (this.contextMenuProvidersInstance !== null) {
            return this.contextMenuProvidersInstance
        }

        const providers = (this.injector.get<any>(TabContextMenuItemProvider, null, { optional: true }) ?? []) as TabContextMenuItemProvider[]
        providers.sort((a: TabContextMenuItemProvider, b: TabContextMenuItemProvider) => a.weight - b.weight)
        this.contextMenuProvidersInstance = providers
        return providers
    }

    private get platform (): PlatformService {
        this.platformInstance ??= this.injector.get(PlatformService)
        return this.platformInstance
    }

    ngOnInit () {
        this.subscribeUntilDestroyed(this.tab.progress$.pipe(
            auditTime(300),
        ), progress => {
            this.zone.run(() => {
                this.progress = progress
            })
        })
    }

    async buildContextMenu (): Promise<MenuItemOptions[]> {
        let items: MenuItemOptions[] = []
        // Top-level tab menu
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(this.tab, true)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    onTabDragStart (tab: BaseTabComponent) {
        this.app.emitTabDragStarted(tab)
    }

    onTabDragEnd () {
        this.dragEndTimeout = window.setTimeout(() => {
            this.dragEndTimeout = null
            this.app.emitTabDragEnded()
            this.app.emitTabsChanged()
        })
    }

    override ngOnDestroy (): void {
        if (this.dragEndTimeout !== null) {
            window.clearTimeout(this.dragEndTimeout)
            this.dragEndTimeout = null
        }
        super.ngOnDestroy()
    }

    @HostBinding('class.flex-width') get isFlexWidthEnabled (): boolean {
        return this.config.store.appearance.flexTabs
    }

    @HostListener('dblclick', ['$event']) onDoubleClick ($event: MouseEvent): void {
        this.app.renameTab(this.tab)
        $event.stopPropagation()
    }

    @HostListener('mousedown', ['$event']) async onMouseDown ($event: MouseEvent) {
        if ($event.which === 2) {
            $event.preventDefault()
        }
    }

    @HostListener('mouseup', ['$event']) async onMouseUp ($event: MouseEvent) {
        if ($event.which === 2) {
            this.app.closeTab(this.tab, true)
        }
    }

    @HostListener('contextmenu', ['$event']) async onContextMenu ($event: MouseEvent) {
        $event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(), $event)
    }
}
