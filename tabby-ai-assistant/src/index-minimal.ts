import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'

// Tabby modules
import { ToolbarButtonProvider, ConfigProvider, HotkeyProvider, TabbyPluginManifest } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { AiConfigProvider } from './providers/tabby/ai-config.provider'
import { AiHotkeyProvider } from './providers/tabby/ai-hotkey.provider'
import { AiLazySettingsTabComponent } from './minimal/ai-lazy-settings-tab.component'
import { AiMinimalSettingsTabProvider } from './minimal/ai-settings-tab.provider'
import { AiMinimalToolbarButtonProvider } from './minimal/ai-toolbar-button.provider'
import { AiAssistantMinimalRuntimeService } from './minimal/ai-runtime.service'

const PROVIDERS = [
    { provide: ToolbarButtonProvider, useClass: AiMinimalToolbarButtonProvider, multi: true },
    { provide: SettingsTabProvider, useClass: AiMinimalSettingsTabProvider, multi: true },
    { provide: ConfigProvider, useClass: AiConfigProvider, multi: true },
    { provide: HotkeyProvider, useClass: AiHotkeyProvider, multi: true },
]

@NgModule({
    imports: [
        CommonModule,
    ],
    providers: PROVIDERS,
    declarations: [
        AiLazySettingsTabComponent,
    ],
})
export default class AiAssistantMinimalModule {
    constructor (runtime: AiAssistantMinimalRuntimeService) {
        runtime.init()
    }
}

export const manifest: TabbyPluginManifest = {
    name: 'ai-assistant',
    providers: PROVIDERS,
}

export const forRoot = (): typeof AiAssistantMinimalModule => {
    return AiAssistantMinimalModule
}

declare const module: any
if (typeof module !== 'undefined' && module.exports) {
    module.exports.forRoot = forRoot
    module.exports.default = AiAssistantMinimalModule
}
