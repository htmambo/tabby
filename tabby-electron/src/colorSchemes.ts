import { Injectable } from '@angular/core'
import { TerminalColorSchemeProvider, TerminalColorScheme } from 'tabby-terminal'
import { ElectronService } from './services/electron.service'

/** @hidden */
@Injectable()
export class HyperColorSchemes extends TerminalColorSchemeProvider {
    constructor (private electron: ElectronService) {
        super()
    }

    async getSchemes (): Promise<TerminalColorScheme[]> {
        return this.electron.ipcRenderer.invoke<TerminalColorScheme[]>('bridge:platform:list-hyper-color-schemes')
    }
}
