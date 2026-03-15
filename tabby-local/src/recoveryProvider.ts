import { Injectable, Injector } from '@angular/core'
import { GenericRecoveryProvider } from 'tabby-core'

import { TerminalTabComponent } from './components/terminalTab.component'

/** @hidden */
@Injectable()
export class RecoveryProvider extends GenericRecoveryProvider<TerminalTabComponent> {
    constructor (injector: Injector) {
        super(injector, 'app:local-tab', TerminalTabComponent)
    }
}
