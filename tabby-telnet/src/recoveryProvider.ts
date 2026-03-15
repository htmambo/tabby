import { Injectable, Injector } from '@angular/core'
import { GenericRecoveryProvider } from 'tabby-core'

import { TelnetTabComponent } from './components/telnetTab.component'

/** @hidden */
@Injectable()
export class RecoveryProvider extends GenericRecoveryProvider<TelnetTabComponent> {
    constructor (injector: Injector) {
        super(injector, 'app:telnet-tab', TelnetTabComponent)
    }
}
