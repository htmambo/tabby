import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-core'
import { PluginManagerLazySettingsTabComponent } from './plugin-manager-lazy-settings-tab.component'

@Injectable()
export class PluginManagerMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'plugins'
    title = 'Plugins'

    getComponentType (): any {
        return PluginManagerLazySettingsTabComponent
    }
}
