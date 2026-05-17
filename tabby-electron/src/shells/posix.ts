import { readFile, stat } from 'node:fs/promises'
import slugify from 'slugify'
import { Injectable } from '@angular/core'
import { HostAppService, Platform } from 'tabby-core'

import { ShellProvider, Shell } from 'tabby-local'

/** @hidden */
@Injectable()
export class POSIXShellsProvider extends ShellProvider {
    constructor (
        private hostApp: HostAppService,
    ) {
        super()
    }

    async provide (): Promise<Shell[]> {
        if (this.hostApp.platform === Platform.Windows) {
            return []
        }
        let shellListPath = '/etc/shells'
        try {
            await stat(shellListPath)
        } catch {
            // Solus Linux
            shellListPath = '/usr/share/defaults/etc/shells'
        }
        return (await readFile(shellListPath, { encoding: 'utf-8' }))
            .split('\n')
            .map(x => x.trim())
            .filter(x => x && !x.startsWith('#'))
            .map(x => ({
                id: slugify(x),
                name: x.split('/').pop() ?? x,
                icon: 'fas fa-terminal',
                command: x,
                args: ['-l'],
                env: {},
                shellType: 'unix',
            }))
    }
}
