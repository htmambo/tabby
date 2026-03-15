import { Injectable, Optional } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, HostAppService, HotkeysService, SettingsTabOpener, TranslateService, AppService } from 'tabby-core'

import { SettingsTabComponent } from './components/settingsTab.component'

/** @hidden */
@Injectable()
export class ButtonProvider extends ToolbarButtonProvider {
    constructor (
        hostApp: HostAppService,
        hotkeys: HotkeysService,
        @Optional() private settingsTabOpener: SettingsTabOpener | null,
        private app: AppService,
        private translate: TranslateService,
    ) {
        super()
        hostApp.settingsUIRequest$.subscribe(() => this.open())

        hotkeys.hotkey$.subscribe(async (hotkey) => {
            if (hotkey === 'settings') {
                this.open()
            }
        })
    }

    provide (): ToolbarButton[] {
        return [{
            icon: require('./icons/cog.svg'),
            title: this.translate.instant('Settings'),
            touchBarNSImage: 'NSTouchBarComposeTemplate',
            weight: 10,
            click: (): void => this.open(),
        }]
    }

    open (): void {
        if (this.settingsTabOpener) {
            this.settingsTabOpener.open()
            return
        }

        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsTabComponent) as SettingsTabComponent | undefined
        if (settingsTab) {
            this.app.selectTab(settingsTab)
        } else {
            this.app.openNewTabRaw({ type: SettingsTabComponent })
        }
    }
}
