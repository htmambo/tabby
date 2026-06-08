import { Inject, NgModule, Optional } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'

import TabbyCorePlugin, { ToolbarButtonProvider, HotkeyProvider, ConfigProvider, HotkeysService, SettingsTabOpener, TabbyPluginManifest } from 'tabby-core'

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
import { CloudSyncSettingsTabComponent } from './components/cloudSyncSettingsTab.component'
import { ShowSecretModalComponent } from './components/showSecretModal.component'

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
        ReleaseNotesComponent,
        ShowSecretModalComponent,
        CloudSyncSettingsTabComponent,
    ],
})
export default class SettingsModule {
    constructor (
        settingsTabOpener: SettingsTabOpener,
        hotkeys: HotkeysService,
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
    }
}

export const manifest: TabbyPluginManifest = {
    name: 'settings',
    providers: PROVIDERS,
}

export * from './api'
export {
    SettingsTabComponent,
    EditProfileModalComponent,
    EditProfileGroupModalComponent,
}
