import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-core'
import { AiLazySettingsTabComponent } from './ai-lazy-settings-tab.component'

@Injectable()
export class AiMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'ai-assistant'
    icon = 'fa fa-robot'
    title = 'AI 助手'

    getComponentType (): any {
        return AiLazySettingsTabComponent
    }
}
