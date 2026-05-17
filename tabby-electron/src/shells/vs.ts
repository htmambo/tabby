import * as path from 'path'
import { Injectable } from '@angular/core'
import { HostAppService, Platform, getRuntimeEnv, readDirectory, readPathStat } from 'tabby-core'

import { ShellProvider, Shell } from 'tabby-local'

/* eslint-disable quote-props */
const vsIconMap: Record<string, string> = {
    '2017': require('../icons/vs2017.svg'),
    '2019': require('../icons/vs2019.svg'),
    '2022': require('../icons/vs2022.svg'),
}
/* eslint-enable quote-props */

/** @hidden */
@Injectable()
export class VSDevToolsProvider extends ShellProvider {
    constructor (
        private hostApp: HostAppService,
    ) {
        super()
    }

    async provide (): Promise<Shell[]> {
        if (this.hostApp.platform !== Platform.Windows) {
            return []
        }

        const x86ParentPath = path.join(getRuntimeEnv('programfiles(x86)') ?? 'C:\\Program Files (x86)', 'Microsoft Visual Studio')
        const x64ParentPath = path.join(getRuntimeEnv('programfiles') ?? 'C:\\Program Files', 'Microsoft Visual Studio')

        const result: Shell[] = []
        for (const parentPath of [x86ParentPath, x64ParentPath]) {
            const parentStat = await readPathStat(parentPath)
            if (!parentStat?.isDirectory) {
                continue
            }

            try {
                for (const entry of await readDirectory(parentPath)) {
                    if (!entry.isDirectory) {
                        continue
                    }

                    const bat = path.join(parentPath, entry.name, 'Community\\Common7\\Tools\\VsDevCmd.bat')
                    const batStat = await readPathStat(bat)
                    if (!batStat?.isFile) {
                        continue
                    }

                    result.push({
                        id: `vs-cmd-${entry.name}`,
                        name: `Developer Prompt for VS ${entry.name}`,
                        command: 'cmd.exe',
                        args: ['/k', bat],
                        icon: vsIconMap[entry.name],
                        env: {},
                        shellType: 'cmd',
                    })
                }
            } catch (_) {
                // Ignore
            }
        }
        return result
    }
}
