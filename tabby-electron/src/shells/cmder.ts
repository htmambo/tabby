import * as path from 'path'
import { Injectable } from '@angular/core'
import { HostAppService, Platform, getRuntimeEnv } from 'tabby-core'

import { ShellProvider, Shell } from 'tabby-local'

/** @hidden */
@Injectable()
export class CmderShellProvider extends ShellProvider {
    constructor (
        private hostApp: HostAppService,
    ) {
        super()
    }

    async provide (): Promise<Shell[]> {
        if (this.hostApp.platform !== Platform.Windows) {
            return []
        }

        const cmderRoot = getRuntimeEnv('CMDER_ROOT')
        if (!cmderRoot) {
            return []
        }

        return [
            {
                id: 'cmder',
                name: 'Cmder',
                command: 'cmd.exe',
                args: [
                    '/k',
                    path.join(cmderRoot, 'vendor', 'init.bat'),
                ],
                icon: require('../icons/cmder.svg'),
                env: {
                    TERM: 'cygwin',
                },
            },
            {
                id: 'cmderps',
                name: 'Cmder PowerShell',
                command: 'powershell.exe',
                args: [
                    '-ExecutionPolicy',
                    'Bypass',
                    '-nologo',
                    '-noprofile',
                    '-noexit',
                    '-command',
                    `Invoke-Expression '. ''${path.join(cmderRoot, 'vendor', 'profile.ps1')}'''`,
                ],
                icon: require('../icons/cmder-powershell.svg'),
                env: {},
            },
        ]
    }
}
