import { Injectable } from '@angular/core'
import { AppService, SettingsTabOpener } from 'tabby-core'

import { SettingsTabComponent } from '../components/settingsTab.component'

@Injectable()
export class SettingsTabOpenerService extends SettingsTabOpener {
    constructor (
        private app: AppService,
    ) {
        super()
    }

    open (activeTab?: string): void {
        const settingsTab = this.app.tabs.find(tab => tab instanceof SettingsTabComponent) as SettingsTabComponent | undefined
        if (settingsTab) {
            if (activeTab) {
                settingsTab.activeTab = activeTab
            }
            this.app.selectTab(settingsTab)
            return
        }

        this.app.openNewTabRaw({
            type: SettingsTabComponent,
            inputs: activeTab ? { activeTab } : undefined,
        })
    }
}
