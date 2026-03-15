import * as path from 'path'
import * as which from 'which'
import { Injectable } from '@angular/core'
import { HostAppService, Platform, ConfigService, getRuntimeArch, getRuntimeEnv, isRuntimeDev, readPathStat } from 'tabby-core'
import { ElectronService } from '../services/electron.service'

import { Shell } from 'tabby-local'
import { WindowsBaseShellProvider } from './windowsBase'

/** @hidden */
@Injectable()
export class WindowsStockShellsProvider extends WindowsBaseShellProvider {
    constructor (
        hostApp: HostAppService,
        config: ConfigService,
        private electron: ElectronService,
    ) {
        super(hostApp, config)
    }

    async provide (): Promise<Shell[]> {
        if (this.hostApp.platform !== Platform.Windows) {
            return []
        }

        let clinkPath = path.join(
            path.dirname(this.electron.app.getPath('exe')),
            'resources',
            'extras',
            'clink',
            `clink_${getRuntimeArch()}.exe`,
        )

        if (isRuntimeDev()) {
            clinkPath = path.join(
                path.dirname(this.electron.app.getPath('exe')),
                '..', '..', '..',
                'extras',
                'clink',
                `clink_${getRuntimeArch()}.exe`,
            )
        }
        return [
            {
                id: 'clink',
                name: 'CMD (clink)',
                command: 'cmd.exe',
                args: ['/k', clinkPath, 'inject'],
                env: {
                    // Tell clink not to emulate ANSI handling
                    WT_SESSION: '0',
                },
                icon: require('../icons/clink.svg'),
            },
            {
                id: 'cmd',
                name: 'CMD (stock)',
                command: 'cmd.exe',
                env: {},
                icon: require('../icons/cmd.svg'),
            },
            {
                id: 'powershell',
                name: 'PowerShell',
                command: await this.getPowerShellPath(),
                args: ['-nologo'],
                icon: require('../icons/powershell.svg'),
                env: this.getEnvironment(),
            },
        ]
    }

    private async getPowerShellPath () {
        for (const name of ['pwsh.exe', 'powershell.exe']) {
            if (await which(name, { nothrow: true })) {
                return name
            }
        }
        for (const psPath of [
            `${getRuntimeEnv('USERPROFILE') ?? 'C:\\Users\\Default'}\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe`,
            `${getRuntimeEnv('SystemRoot') ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
            `${getRuntimeEnv('SystemRoot') ?? 'C:\\Windows'}\\System32\\powershell.exe`,
            `${getRuntimeEnv('SystemRoot') ?? 'C:\\Windows'}\\powerhshell.exe`,
        ]) {
            const stat = await readPathStat(psPath)
            if (stat?.isFile) {
                return psPath
            }
        }
        return 'powershell.exe'
    }
}
