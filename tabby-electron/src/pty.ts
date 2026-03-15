import { ChildProcess, PTYInterface, PTYProxy } from 'tabby-local'
import { getTabbyBridge } from '../../app/src/tabby-bridge'

const ipc = getTabbyBridge().ipc

export class ElectronPTYInterface extends PTYInterface {
    async spawn (...options: any[]): Promise<PTYProxy> {
        const id = ipc.sendSync('pty:spawn', ...options)
        return new ElectronPTYProxy(id)
    }

    async restore (id: string): Promise<ElectronPTYProxy|null> {
        if (ipc.sendSync('pty:exists', id)) {
            return new ElectronPTYProxy(id)
        }
        return null
    }
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class ElectronPTYProxy extends PTYProxy {
    private subscriptions: Map<string, any> = new Map()
    private truePID: Promise<number>

    constructor (
        private id: string,
    ) {
        super()
        this.truePID = ipc.invoke<number>('pty:get-true-pid', this.id)
        this.truePID = this.truePID.catch(() => this.getPID())
    }

    getID (): string {
        return this.id
    }

    async exists (): Promise<boolean> {
        return ipc.sendSync('pty:exists', this.id)
    }

    getTruePID (): Promise<number> {
        return this.truePID
    }

    async getPID (): Promise<number> {
        return ipc.sendSync('pty:get-pid', this.id)
    }

    subscribe (event: string, handler: (..._: any[]) => void): void {
        const key = `pty:${this.id}:${event}`
        const newHandler = (...args) => handler(...args)
        this.subscriptions.set(key, newHandler)
        ipc.on(key, newHandler)
    }

    ackData (length: number): void {
        ipc.send('pty:ack-data', this.id, length)
    }

    unsubscribeAll (): void {
        for (const k of this.subscriptions.keys()) {
            ipc.off(k, this.subscriptions.get(k))
        }
    }

    async resize (columns: number, rows: number): Promise<void> {
        ipc.send('pty:resize', this.id, columns, rows)
    }

    async write (data: Buffer): Promise<void> {
        ipc.send('pty:write', this.id, data)
    }

    async kill (signal?: string): Promise<void> {
        ipc.send('pty:kill', this.id, signal)
    }

    async getChildProcesses (): Promise<ChildProcess[]> {
        return ipc.invoke<ChildProcess[]>('pty:get-child-processes', this.id)
    }

    async getWorkingDirectory (): Promise<string|null> {
        return ipc.invoke<string|null>('pty:get-working-directory', this.id)
    }

}
