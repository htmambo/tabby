/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { debounce } from 'utils-decorators/dist/esm/debounce/debounce'
import { Component, HostBinding, Inject, NgZone, Optional } from '@angular/core'
import {
    DockingService,
    ConfigService,
    Theme,
    HostAppService,
    Platform,
    isWindowsBuild,
    WIN_BUILD_FLUENT_BG_SUPPORTED,
    BaseComponent,
    Screen,
    PlatformService,
} from 'tabby-core'


/** @hidden */
@Component({
    standalone: false,
    selector: 'window-settings-tab',
    templateUrl: './windowSettingsTab.component.pug',
})
export class WindowSettingsTabComponent extends BaseComponent {
    readonly minMacOSWindowOpacity = 0.85
    readonly minVibrantWindowOpacity = 0.4
    screens: Screen[]
    Platform = Platform
    isFluentVibrancySupported = false
    readonly minFixedTabWidth = 84
    readonly maxFixedTabWidth = 600
    readonly defaultFixedTabWidth = 200

    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        public platform: PlatformService,
        public zone: NgZone,
        @Inject(Theme) public themes: Theme[],
        @Optional() public docking?: DockingService,
    ) {
        super()

        this.themes = config.enabledServices(this.themes)

        const dockingService = docking
        if (dockingService) {
            this.subscribeUntilDestroyed(dockingService.screensChanged$, () => {
                this.zone.run(() => this.screens = dockingService.getScreens())
            })
            this.screens = dockingService.getScreens()
        }

        this.isFluentVibrancySupported = isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)
    }

    get minWindowOpacity (): number {
        if (this.hostApp.platform !== Platform.macOS) {
            return this.minVibrantWindowOpacity
        }
        return this.config.store?.appearance?.vibrancy ? this.minVibrantWindowOpacity : this.minMacOSWindowOpacity
    }

    get fixedTabWidth (): number {
        return this.normalizeFixedTabWidth(this.config.store?.appearance?.fixedTabWidth)
    }

    onFixedTabWidthChange (value: unknown): void {
        this.config.store.appearance.fixedTabWidth = this.normalizeFixedTabWidth(value)
        this.saveConfiguration()
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        if (typeof this.config.store?.appearance?.opacity === 'number') {
            this.config.store.appearance.opacity = Math.max(this.minWindowOpacity, Math.min(1, this.config.store.appearance.opacity))
        }
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }

    private normalizeFixedTabWidth (value: unknown): number {
        const numericValue = Number(value)
        if (!Number.isFinite(numericValue)) {
            return this.defaultFixedTabWidth
        }
        return Math.max(this.minFixedTabWidth, Math.min(this.maxFixedTabWidth, Math.round(numericValue)))
    }
}
