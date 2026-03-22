import { Inject, Injector, NgModule, Optional } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { lastValueFrom } from 'rxjs'

import TabbyCorePlugin, { ToolbarButtonProvider, HotkeyProvider, ConfigProvider, HotkeysService, SettingsTabOpener, TabbyPluginManifest, ConfigService, HostAppService, Platform, AppService } from 'tabby-core'

import { EditProfileModalComponent } from './components/editProfileModal.component'
import { EditProfileGroupModalComponent } from './components/editProfileGroupModal.component'
import { HotkeyInputModalComponent } from './components/hotkeyInputModal.component'
import { HotkeySettingsTabComponent } from './components/hotkeySettingsTab.component'
import { MultiHotkeyInputComponent } from './components/multiHotkeyInput.component'
import { SettingsTabComponent } from './components/settingsTab.component'
import { SettingsTabBodyComponent } from './components/settingsTabBody.component'
import { WindowSettingsTabComponent } from './components/windowSettingsTab.component'
import { VaultSettingsTabComponent }  from './components/vaultSettingsTab.component'
import { SetVaultPassphraseModalComponent } from './components/setVaultPassphraseModal.component'
import { ProfilesSettingsTabComponent } from './components/profilesSettingsTab.component'
import { ReleaseNotesComponent } from './components/releaseNotesTab.component'
import { ConfigSyncSettingsTabComponent } from './components/configSyncSettingsTab.component'
import { ShowSecretModalComponent } from './components/showSecretModal.component'

import { ConfigSyncService } from './services/configSync.service'
import { SettingsTabOpenerService } from './services/settingsTabOpener.service'

import { SettingsTabProvider } from './api'
import { ButtonProvider } from './buttonProvider'
import { SettingsHotkeyProvider } from './hotkeys'
import { SettingsConfigProvider } from './config'
import { HotkeySettingsTabProvider, WindowSettingsTabProvider, VaultSettingsTabProvider, ProfilesSettingsTabProvider, ConfigSyncSettingsTabProvider } from './settings'
import { SETTINGS_LAZY_RUNTIME } from './minimal/lazy-runtime.token'

const PROVIDERS = [
    { provide: ToolbarButtonProvider, useClass: ButtonProvider, multi: true },
    { provide: ConfigProvider, useClass: SettingsConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: SettingsHotkeyProvider, multi: true },
    SettingsTabOpenerService,
    { provide: SettingsTabOpener, useExisting: SettingsTabOpenerService },
    { provide: SettingsTabProvider, useClass: HotkeySettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: WindowSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: VaultSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: ProfilesSettingsTabProvider, multi: true },
    { provide: SettingsTabProvider, useClass: ConfigSyncSettingsTabProvider, multi: true },
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

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCorePlugin,
    ],
    providers: PROVIDERS,
    declarations: [
        EditProfileModalComponent,
        EditProfileGroupModalComponent,
        HotkeyInputModalComponent,
        HotkeySettingsTabComponent,
        MultiHotkeyInputComponent,
        ProfilesSettingsTabComponent,
        SettingsTabComponent,
        SettingsTabBodyComponent,
        SetVaultPassphraseModalComponent,
        VaultSettingsTabComponent,
        WindowSettingsTabComponent,
        ConfigSyncSettingsTabComponent,
        ReleaseNotesComponent,
        ShowSecretModalComponent,
    ],
})
export default class SettingsModule {
    private configSyncInitScheduled = false

    constructor (
        injector: Injector,
        config: ConfigService,
        hostApp: HostAppService,
        settingsTabOpener: SettingsTabOpener,
        hotkeys: HotkeysService,
        app: AppService,
        @Optional() @Inject(SETTINGS_LAZY_RUNTIME) lazyRuntime: boolean | null,
    ) {
        if (lazyRuntime) {
            return
        }

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

export * from './api'
export { SettingsTabComponent }
