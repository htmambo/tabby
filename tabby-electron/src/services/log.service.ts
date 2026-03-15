import { Injectable } from '@angular/core'
import { ConsoleLogger, Logger } from 'tabby-core'
import { ElectronService } from '../services/electron.service'

interface BridgeLogEntry {
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    name: string
}

function normalizeLogLevel (level: string): BridgeLogEntry['level'] {
    if (level === 'debug' || level === 'info' || level === 'warn' || level === 'error') {
        return level
    }
    return 'info'
}

function formatLogArg (arg: any): string {
    if (arg instanceof Error) {
        return arg.stack ?? `${arg.name}: ${arg.message}`
    }
    if (typeof arg === 'string') {
        return arg
    }
    if (arg === undefined) {
        return 'undefined'
    }
    if (arg === null) {
        return 'null'
    }
    if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') {
        return String(arg)
    }

    try {
        return JSON.stringify(arg)
    } catch {
        return String(arg)
    }
}

export class BridgeAndConsoleLogger extends ConsoleLogger {
    constructor (private electron: ElectronService, name: string) {
        super(name)
    }

    protected doLog (level: string, ...args: any[]): void {
        super.doLog(level, ...args)

        const entry: BridgeLogEntry = {
            level: normalizeLogLevel(level),
            message: args.map(arg => formatLogArg(arg)).join(' '),
            name: this.name,
        }
        this.electron.ipcRenderer.send('bridge:log:write', entry)
    }
}

@Injectable({ providedIn: 'root' })
export class ElectronLogService {
    /** @hidden */
    constructor (private electron: ElectronService) { }

    create (name: string): Logger {
        return new BridgeAndConsoleLogger(this.electron, name)
    }
}
