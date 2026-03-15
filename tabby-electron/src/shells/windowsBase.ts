import { ConfigService, HostAppService } from 'tabby-core'

import { ShellProvider } from 'tabby-local'

export abstract class WindowsBaseShellProvider extends ShellProvider {
    constructor (
        protected hostApp: HostAppService,
        protected config: ConfigService,
    ) {
        super()
    }

    protected getEnvironment (): any {
        const envByIdentification: Record<string, Record<string, string | number>> = {
            wt: {
                WT_SESSION: 0,
            },
            cygwin: {
                TERM: 'cygwin',
            },
        }
        return envByIdentification[this.config.store.terminal.identification] ?? {}
    }
}
