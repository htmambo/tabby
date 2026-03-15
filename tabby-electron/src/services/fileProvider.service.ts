import { Injectable } from '@angular/core'
import { FileProvider } from 'tabby-core'
import { ElectronService } from '../services/electron.service'

@Injectable()
export class ElectronFileProvider extends FileProvider {
    name = 'Filesystem'

    constructor (
        private electron: ElectronService,
    ) {
        super()
    }

    async selectAndStoreFile (description: string): Promise<string> {
        const result = await this.electron.dialog.showOpenDialog({
            buttonLabel: `Select ${description}`,
            properties: ['openFile', 'treatPackageAsDirectory'],
        })
        if (result.canceled || !result.filePaths.length) {
            throw new Error('canceled')
        }

        return `file://${result.filePaths[0]}`
    }

    async retrieveFile (key: string): Promise<Buffer> {
        if (key.startsWith('file://')) {
            key = key.substring('file://'.length)
        } else if (key.includes('://')) {
            throw new Error('Incorrect type')
        }
        const content = await this.electron.ipcRenderer.invoke<string>('bridge:file-provider:read-file', key)
        return Buffer.from(content, 'base64')
    }
}
