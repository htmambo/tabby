import { Injectable, Injector } from '@angular/core'
import { GenericRecoveryProvider } from 'tabby-core'

import { SerialTabComponent } from './components/serialTab.component'

/** @hidden */
@Injectable()
export class RecoveryProvider extends GenericRecoveryProvider<SerialTabComponent> {
    constructor (injector: Injector) {
        super(injector, 'app:serial-tab', SerialTabComponent)
    }
}
