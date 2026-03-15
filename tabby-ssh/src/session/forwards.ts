import socksv5 from '@luminati-io/socksv5'
import { Server, Socket, createServer } from 'net'

import { ForwardedPortConfig, PortForwardType } from '../api'

export class ForwardedPort implements ForwardedPortConfig {
    type: PortForwardType
    host = '127.0.0.1'
    port: number
    targetAddress: string
    targetPort: number
    description: string

    private listener: Server|null = null

    async startLocalListener (callback: (accept: () => Socket, reject: () => void, sourceAddress: string|null, sourcePort: number|null, targetAddress: string, targetPort: number) => void): Promise<void> {
        if (this.type === PortForwardType.Local) {
            const listener = this.listener = createServer(s => callback(
                () => s,
                () => s.destroy(),
                s.remoteAddress ?? null,
                s.remotePort ?? null,
                this.targetAddress,
                this.targetPort,
            ))
            return new Promise((resolve, reject) => {
                listener.listen(this.port, this.host)
                listener.on('error', reject)
                listener.on('listening', resolve)
            })
        } else if (this.type === PortForwardType.Dynamic) {
            return new Promise((resolve, reject) => {
                type SocksProxyInfo = { dstAddr: string, dstPort: number }
                type SocksAccept = (allow?: boolean) => Socket
                type SocksReject = () => void
                type SocksServer = Server & { useAuth?: (auth: unknown) => void }
                this.listener = socksv5.createServer((info: SocksProxyInfo, acceptConnection: SocksAccept, rejectConnection: SocksReject) => {
                    callback(
                        () => acceptConnection(true),
                        () => rejectConnection(),
                        null,
                        null,
                        info.dstAddr,
                        info.dstPort,
                    )
                }) as SocksServer
                this.listener.on('error', reject)
                this.listener.listen(this.port, this.host, resolve)
                const socksListener = this.listener as SocksServer
                socksListener.useAuth?.(socksv5.auth.None())
            })
        } else {
            throw new Error('Invalid forward type for a local listener')
        }
    }

    stopLocalListener (): void {
        this.listener?.close()
    }

    toString (): string {
        if (this.type === PortForwardType.Local) {
            return `(local) ${this.host}:${this.port} → (remote) ${this.targetAddress}:${this.targetPort}`
        } if (this.type === PortForwardType.Remote) {
            return `(remote) ${this.host}:${this.port} → (local) ${this.targetAddress}:${this.targetPort}`
        } else {
            return `(dynamic) ${this.host}:${this.port}`
        }
    }
}
