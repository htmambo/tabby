import { Injector, Type } from '@angular/core'
import { BaseTabComponent } from '../components/baseTab.component'
import { ProfilesService } from '../services/profiles.service'
import { NewTabParameters } from '../services/tabs.service'
import { RecoveryToken, TabRecoveryProvider } from './tabRecovery'

export abstract class GenericRecoveryProvider<T extends BaseTabComponent> extends TabRecoveryProvider<T> {
    protected constructor (
        private injector: Injector,
        private tokenType: string,
        private tabComponent: Type<T>,
    ) {
        super()
    }

    async applicableTo (recoveryToken: RecoveryToken): Promise<boolean> {
        return recoveryToken.type === this.tokenType
    }

    async recover (recoveryToken: RecoveryToken): Promise<NewTabParameters<T>> {
        return {
            type: this.tabComponent,
            inputs: this.buildInputs(recoveryToken),
        }
    }

    protected buildInputs (recoveryToken: RecoveryToken): Record<string, any> {
        return {
            profile: this.injector.get(ProfilesService).getConfigProxyForProfile(recoveryToken.profile),
            savedState: recoveryToken.savedState,
        }
    }
}
