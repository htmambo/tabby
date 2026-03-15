import { Injectable, Injector } from '@angular/core'
import { GenericRecoveryProvider, RecoveryToken } from 'tabby-core'

import { SSHTabComponent } from './components/sshTab.component'

/** @hidden */
@Injectable()
export class RecoveryProvider extends GenericRecoveryProvider<SSHTabComponent> {
    constructor (injector: Injector) {
        super(injector, 'app:ssh-tab', SSHTabComponent)
    }

    protected buildInputs (recoveryToken: RecoveryToken): Record<string, any> {
        return {
            ...super.buildInputs(recoveryToken),
            sftpPanelVisible: !!recoveryToken.sftpPanelVisible,
            sftpPanelHeight: recoveryToken.sftpPanelHeight ?? 320,
        }
    }
}
