import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'

import { SettingsTabProvider, TabbyPluginManifest } from 'tabby-core'
import { PluginManagerLazySettingsTabComponent } from './minimal/plugin-manager-lazy-settings-tab.component'
import { PluginManagerMinimalSettingsTabProvider } from './minimal/plugin-manager-settings-tab.provider'

const PROVIDERS = [
    { provide: SettingsTabProvider, useClass: PluginManagerMinimalSettingsTabProvider, multi: true },
]

@NgModule({
    imports: [
        CommonModule,
    ],
    providers: PROVIDERS,
    declarations: [
        PluginManagerLazySettingsTabComponent,
    ],
})
export default class PluginManagerMinimalModule { } // eslint-disable-line @typescript-eslint/no-extraneous-class

export const manifest: TabbyPluginManifest = {
    name: 'plugin-manager',
    providers: PROVIDERS,
}

export const forRoot = (): typeof PluginManagerMinimalModule => {
    return PluginManagerMinimalModule
}

declare const module: any
if (typeof module !== 'undefined' && module.exports) {
    module.exports.forRoot = forRoot
    module.exports.default = PluginManagerMinimalModule
}
