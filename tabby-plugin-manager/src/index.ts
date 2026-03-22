import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'

import TabbyCorePlugin, { SettingsTabProvider, TabbyPluginManifest } from 'tabby-core'

import { PluginsSettingsTabComponent } from './components/pluginsSettingsTab.component'
import { PluginManagerService } from './services/pluginManager.service'
import { PluginsSettingsTabProvider } from './settings'

const PROVIDERS = [
    { provide: SettingsTabProvider, useClass: PluginsSettingsTabProvider, multi: true },
]

@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCorePlugin,
    ],
    providers: PROVIDERS,
    declarations: [
        PluginsSettingsTabComponent,
    ],
})
export default class PluginManagerModule { } // eslint-disable-line @typescript-eslint/no-extraneous-class

export const manifest: TabbyPluginManifest = {
    name: 'plugin-manager',
    providers: PROVIDERS,
}

export { PluginManagerService }
