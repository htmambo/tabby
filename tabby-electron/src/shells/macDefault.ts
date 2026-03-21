import { Injectable } from '@angular/core'
import { HostAppService, Platform, TranslateService } from 'tabby-core'

import { ShellProvider, Shell } from 'tabby-local'
import { ElectronService } from '../services/electron.service'

/** @hidden */
@Injectable()
export class MacOSDefaultShellProvider extends ShellProvider {
    private cachedShell?: string

    constructor (
        private hostApp: HostAppService,
        private translate: TranslateService,
        private electron: ElectronService,
    ) {
        super()
    }

    async provide (): Promise<Shell[]> {
        if (this.hostApp.platform !== Platform.macOS) {
            return []
        }
        return [{
            id: 'default',
            name: this.translate.instant('OS default'),
            command: await this.getDefaultShellCached(),
            args: ['--login'],
            hidden: true,
            env: {},
        }]
    }

    private async getDefaultShellCached () {
        if (!this.cachedShell) {
            this.cachedShell = await this.getDefaultShell()
        }
        return this.cachedShell
    }

    private async getDefaultShell (): Promise<string> {
        return this.electron.ipcRenderer.invoke<string>('bridge:platform:get-default-mac-shell')
    }
}
