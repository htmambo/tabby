import { Injectable } from '@angular/core'
import { HostAppService, Platform } from 'tabby-core'
import { ElectronService } from '../services/electron.service'

@Injectable({ providedIn: 'root' })
export class ShellIntegrationService {
    private constructor (
        private electron: ElectronService,
        private hostApp: HostAppService,
    ) {
        void this.updatePaths()
    }

    async isInstalled (): Promise<boolean> {
        if (this.hostApp.platform === Platform.macOS || this.hostApp.platform === Platform.Windows) {
            return this.electron.ipcRenderer.invoke('bridge:shell-integration:is-installed')
        }
        return true
    }

    async install (): Promise<void> {
        if (this.hostApp.platform === Platform.macOS || this.hostApp.platform === Platform.Windows) {
            await this.electron.ipcRenderer.invoke('bridge:shell-integration:install')
        }
    }

    async remove (): Promise<void> {
        if (this.hostApp.platform === Platform.macOS || this.hostApp.platform === Platform.Windows) {
            await this.electron.ipcRenderer.invoke('bridge:shell-integration:remove')
        }
    }

    private async updatePaths (): Promise<void> {
        // Update paths in case of an update
        if (this.hostApp.platform === Platform.Windows) {
            if (await this.isInstalled()) {
                await this.install()
            }
        }
    }
}
