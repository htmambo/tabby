import { Injectable } from '@angular/core'
import { AppService, SettingsTabOpener } from 'tabby-core'
import { SettingsLazyTabComponent } from './settings-lazy-tab.component'

@Injectable()
export class SettingsLazyTabOpenerService extends SettingsTabOpener {
    constructor (
        private app: AppService,
    ) {
        super()
    }

    open (activeTab?: string): void {
        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsLazyTabComponent) as SettingsLazyTabComponent | undefined
        if (settingsTab) {
            if (activeTab) {
                settingsTab.activeTab = activeTab
            }
            this.app.selectTab(settingsTab)
            return
        }

        this.app.openNewTabRaw({
            type: SettingsLazyTabComponent,
            inputs: activeTab ? { activeTab } : undefined,
        })
    }
}
