import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'

import TabbyCorePlugin, {
    ToolbarButtonProvider,
    HotkeyProvider,
    ConfigProvider,
    HotkeysService,
    SettingsTabOpener,
    SettingsTabProvider,
    TabbyPluginManifest,
    AppService,
} from 'tabby-core'

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
    constructor (
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
