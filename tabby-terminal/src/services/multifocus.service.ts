import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent } from '../api/baseTerminalTab.component'
import { Subscription } from 'rxjs'
import { TranslateService, AppService, HotkeysService } from 'tabby-core'

@Injectable({ providedIn: 'root' })
export class MultifocusService {
    private inputSubscription: Subscription|null = null
    private warningElement: HTMLElement

    constructor (
        private app: AppService,
        hotkeys: HotkeysService,
        translate: TranslateService,
    ) {
        this.warningElement = document.createElement('div')
        this.warningElement.className = 'broadcast-status-warning'
        this.warningElement.innerText = translate.instant('Broadcast mode. Click anywhere to cancel.')
        this.warningElement.style.display = 'none'
        document.body.appendChild(this.warningElement)

        hotkeys.hotkey$.subscribe(hotkey => {
            switch (hotkey) {
                case 'focus-all-tabs':
                    this.focusAllTabs()
                    break
                case 'pane-focus-all':
                    this.focusAllPanes()
                    break
            }
        })
    }

    start (currentTab: BaseTerminalTabComponent<any>, tabs: BaseTerminalTabComponent<any>[]): void {
        if (this.inputSubscription) {
            return
        }

        this.inputSubscription = currentTab.frontend?.input$.subscribe(data => {
            for (const tab of tabs) {
                if (tab !== currentTab) {
                    tab.sendInput(data)
                }
            }
        }) ?? null
    }

    cancel (): void {
        this.warningElement.style.display = 'none'
        document.querySelector('app-root')!['style'].border = 'none'

        if (!this.inputSubscription) {
            return
        }
        this.inputSubscription.unsubscribe()
        this.inputSubscription = null
    }

    focusAllTabs (): void {
        const currentTab = this.app.activeTab
        if (!currentTab || !(currentTab instanceof BaseTerminalTabComponent)) {
            return
        }
        const tabs = this.app.tabs
            .filter(t => t instanceof BaseTerminalTabComponent)
        this.start(currentTab, tabs)

        this.warningElement.style.display = 'block'
        document.querySelector('app-root')!['style'].border = '5px solid red'
    }

    focusAllPanes (): void {
        // Not applicable without split tabs
        this.focusAllTabs()
    }
}
