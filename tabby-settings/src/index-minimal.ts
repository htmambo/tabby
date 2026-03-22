import { Injector, NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { lastValueFrom } from 'rxjs'

import TabbyCorePlugin, {
    ToolbarButtonProvider,
    HotkeyProvider,
    ConfigProvider,
    HotkeysService,
    SettingsTabOpener,
    SettingsTabProvider,
    TabbyPluginManifest,
    ConfigService,
    HostAppService,
    Platform,
    AppService,
} from 'tabby-core'

import { ConfigSyncService } from './services/configSync.service'
import { SettingsHotkeyProvider } from './hotkeys'
import { SettingsConfigProvider } from './config'
import { SettingsMinimalButtonProvider } from './minimal/settings-button.provider'
import { SettingsLazyTabComponent } from './minimal/settings-lazy-tab.component'
import { SettingsLazyTabOpenerService } from './minimal/settings-tab-opener.service'
import {
    ConfigSyncMinimalSettingsTabProvider,
    HotkeyMinimalSettingsTabProvider,
    ProfilesMinimalSettingsTabProvider,
    VaultMinimalSettingsTabProvider,
    WindowMinimalSettingsTabProvider,
} from './minimal/settings-tab.providers'

const PROVIDERS = [
    { provide: ToolbarButtonProvider, useClass: SettingsMinimalButtonProvider, multi: true },
    { provide: ConfigProvider, useClass: SettingsConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: SettingsHotkeyProvider, multi: true },
    SettingsLazyTabOpenerService,
    { provide: SettingsTabOpener, useExisting: SettingsLazyTabOpenerService },
    { provide: SettingsTabProvider, useClass: HotkeyMinimalSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: WindowMinimalSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: VaultMinimalSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: ProfilesMinimalSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: ConfigSyncMinimalSettingsTabProvider, multi: true },
]

type IdleRequestCallbackLike = () => void
type IdleRequestOptionsLike = {
    timeout?: number
}
type IdleCallbackGlobal = typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallbackLike, options?: IdleRequestOptionsLike) => number
}

function shouldInitializeConfigSync (config: ConfigService): boolean {
    const sync = config.store?.configSync
    return !!sync?.auto && !!sync?.host?.trim() && !!sync?.token?.trim() && !!sync?.configID
}

@NgModule({
    imports: [
        CommonModule,
        TabbyCorePlugin,
    ],
    providers: PROVIDERS,
    declarations: [
        SettingsLazyTabComponent,
    ],
})
export default class SettingsMinimalModule {
    private configSyncInitScheduled = false

    constructor (
        injector: Injector,
        config: ConfigService,
        hostApp: HostAppService,
        settingsTabOpener: SettingsTabOpener,
        hotkeys: HotkeysService,
        app: AppService,
    ) {
        hotkeys.hotkey$.subscribe(async hotkey => {
            if (hotkey.startsWith('settings-tab.')) {
                const id = hotkey.substring(hotkey.indexOf('.') + 1)
                settingsTabOpener.open(id)
            }
        })

        app.ready$.subscribe(() => {
            void lastValueFrom(config.ready$).then(() => {
                if (hostApp.platform !== Platform.Web && shouldInitializeConfigSync(config)) {
                    this.scheduleConfigSyncInit(() => injector.get(ConfigSyncService))
                }
            })
        })
    }

    private scheduleConfigSyncInit (callback: () => void): void {
        if (this.configSyncInitScheduled) {
            return
        }
        this.configSyncInitScheduled = true

        const run = () => {
            callback()
        }
        const idleGlobal = globalThis as IdleCallbackGlobal
        if (idleGlobal.requestIdleCallback) {
            idleGlobal.requestIdleCallback(run, { timeout: 3000 })
            return
        }
        window.setTimeout(run, 1500)
    }
}

export const manifest: TabbyPluginManifest = {
    name: 'settings',
    providers: PROVIDERS,
}

export const forRoot = (): typeof SettingsMinimalModule => {
    return SettingsMinimalModule
}

declare const module: any
if (typeof module !== 'undefined' && module.exports) {
    module.exports.forRoot = forRoot
    module.exports.default = SettingsMinimalModule
}
