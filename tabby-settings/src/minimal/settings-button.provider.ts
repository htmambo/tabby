import { Injectable, Optional } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, HostAppService, HotkeysService, SettingsTabOpener, TranslateService } from 'tabby-core'

@Injectable()
export class SettingsMinimalButtonProvider extends ToolbarButtonProvider {
    constructor (
        hostApp: HostAppService,
        hotkeys: HotkeysService,
        @Optional() private settingsTabOpener: SettingsTabOpener | null,
        private translate: TranslateService,
    ) {
        super()
        hostApp.settingsUIRequest$.subscribe(() => this.open())

        hotkeys.hotkey$.subscribe(async hotkey => {
            if (hotkey === 'settings') {
                this.open()
            }
        })
    }

    provide (): ToolbarButton[] {
        return [{
            icon: require('../icons/cog.svg'),
            title: this.translate.instant('Settings'),
            touchBarNSImage: 'NSTouchBarComposeTemplate',
            weight: 10,
            click: (): void => this.open(),
        }]
    }

    open (): void {
        this.settingsTabOpener?.open()
    }
}
