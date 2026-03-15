import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import { ToastrModule } from 'ngx-toastr'
import { NgxFilesizeModule } from 'ngx-filesize'
import TabbyCoreModule, { ConfigProvider, TabRecoveryProvider, HotkeyProvider, ProfileProvider, TabbyPluginManifest } from 'tabby-core'
import TabbyTerminalModule from 'tabby-terminal'

import { TelnetProfileSettingsComponent } from './components/telnetProfileSettings.component'
import { TelnetTabComponent } from './components/telnetTab.component'

import { TelnetConfigProvider } from './config'
import { RecoveryProvider } from './recoveryProvider'
import { TelnetHotkeyProvider } from './hotkeys'
import { TelnetProfilesService } from './profiles'

const PROVIDERS = [
    { provide: ConfigProvider, useClass: TelnetConfigProvider, multi: true },
    { provide: TabRecoveryProvider, useClass: RecoveryProvider, multi: true },
    { provide: HotkeyProvider, useClass: TelnetHotkeyProvider, multi: true },
    { provide: ProfileProvider, useExisting: TelnetProfilesService, multi: true },
]

/** @hidden */
@NgModule({
    imports: [
        NgbModule,
        NgxFilesizeModule,
        CommonModule,
        FormsModule,
        ToastrModule,
        TabbyCoreModule,
        TabbyTerminalModule,
    ],
    providers: PROVIDERS,
    declarations: [
        TelnetProfileSettingsComponent,
        TelnetTabComponent,
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class TelnetModule { }

export const manifest: TabbyPluginManifest = {
    name: 'telnet',
    providers: PROVIDERS,
}
