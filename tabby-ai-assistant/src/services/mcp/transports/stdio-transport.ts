import { BaseTransport } from './base-transport'
import { MCPRequest, MCPResponse } from '../mcp-message.types'
import { getRuntimeCwd, getRuntimeEnvObject, getRuntimePlatform } from 'tabby-core'

const STDIO_TRANSPORT_ENV_KEYS = [
    'APPDATA',
    'COMSPEC',
    'HOME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'LOCALAPPDATA',
    'NO_PROXY',
    'no_proxy',
    'HTTP_PROXY',
    'http_proxy',
    'HTTPS_PROXY',
    'https_proxy',
    'PATH',
    'Path',
    'PATHEXT',
    'SHELL',
    'SystemRoot',
    'TEMP',
    'TERM',
    'TMP',
    'USER',
    'USERNAME',
    'USERPROFILE',
    'windir',
] as const

type BridgeIPCListener = (...args: any[]) => void

type BridgeIPC = {
    send: (channel: string, ...args: any[]) => void
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
    on: (channel: string, listener: BridgeIPCListener) => void
    off: (channel: string, listener: BridgeIPCListener) => void
}

type BridgeWindow = Window & {
    tabbyBridge?: {
        ipc?: BridgeIPC
    }
}

interface BridgeSerializedError {
    name?: string
    message?: string
    stack?: string
}

function getBridgeIPC(): BridgeIPC {
    const ipc = (window as BridgeWindow).tabbyBridge?.ipc
    if (!ipc) {
        throw new Error('Tabby IPC bridge is unavailable')
    }
    return ipc
}

/**
 * Stdio 传输层实现
 * 用于与本地 MCP 服务器进程通信
 */
export class StdioTransport extends BaseTransport {
    private processID: string | null = null
    private pendingRequests = new Map<string | number, {
        resolve: (value: MCPResponse) => void;
        reject: (reason: any) => void;
    }>()
    private subscriptions = new Map<string, BridgeIPCListener>()

    private buffer = ''
    private requestId = 0

    constructor(
        private command: string,
        private args: string[] = [],
        private options: { env?: Record<string, string>; cwd?: string } = {},
    ) {
        super()
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return
        }

        try {
            // 构建环境变量
            const env = {
                ...getRuntimeEnvObject(STDIO_TRANSPORT_ENV_KEYS),
                ...this.options.env,
                // 确保 NODE_ENV 设置正确
                NODE_ENV: 'production',
            }

            // 检测操作系统
            const isWindows = getRuntimePlatform() === 'win32'

            // Windows 兼容性处理：对于 npx/npm/node 命令使用 shell 模式
            const command = this.command
            const needsShell = ['npx', 'npm', 'node', 'yarn', 'pnpm'].some(
                cmd => this.command.toLowerCase() === cmd || this.command.toLowerCase().endsWith(`/${cmd}`) || this.command.toLowerCase().endsWith(`\\${cmd}`),
            )

            this.processID = await getBridgeIPC().invoke<string>('bridge:subprocess:spawn', {
                command,
                args: this.args,
                env,
                cwd: this.options.cwd ?? getRuntimeCwd(),
                shell: isWindows && needsShell,
            })

            this.subscribe('stdout', (data: string) => {
                this.handleData(data)
            })
            this.subscribe('stderr', (data: string) => {
                console.error('[MCP Stdio] stderr:', data)
            })
            this.subscribe('close', (code: number | null, signal?: string | null) => {
                this.handleClose(code, signal)
            })
            this.subscribe('error', (error: BridgeSerializedError) => {
                this.handleError(this.deserializeError(error))
            })

            this.connected = true
        } catch (error) {
            console.error('[MCP Stdio] Failed to connect:', error)
            this.teardownConnection()
            throw error
        }
    }

    async disconnect(): Promise<void> {
        if (!this.processID) {
            return
        }

        try {
            getBridgeIPC().send('bridge:subprocess:stdin-end', this.processID)
            getBridgeIPC().send('bridge:subprocess:kill', this.processID, 'SIGTERM')
        } catch (error) {
            console.error('[MCP Stdio] Error during disconnect:', error)
        }

        this.teardownConnection()
        this.rejectPendingRequests(new Error('Transport disconnected'))
    }

    async send(request: MCPRequest, signal?: AbortSignal): Promise<MCPResponse> {
        if (!this.connected || !this.processID) {
            throw new Error('Transport not connected')
        }

        // 检查是否已取消
        if (signal?.aborted) {
            throw new DOMException('Operation cancelled', 'AbortError')
        }

        // 确保请求有 ID
        if (!request.id) {
            request.id = this.generateId()
        }

        return new Promise((resolve, reject) => {
            // 监听取消信号
            const abortHandler = () => {
                this.pendingRequests.delete(request.id)
                reject(new DOMException('Operation cancelled', 'AbortError'))
            }
            signal?.addEventListener('abort', abortHandler, { once: true })

            try {
                this.pendingRequests.set(request.id, {
                    resolve: (value) => {
                        signal?.removeEventListener('abort', abortHandler)
                        resolve(value)
                    },
                    reject: (reason) => {
                        signal?.removeEventListener('abort', abortHandler)
                        reject(reason)
                    },
                })

                const message = JSON.stringify(request) + '\n'
                getBridgeIPC().send('bridge:subprocess:write', this.processID, message)
            } catch (error) {
                signal?.removeEventListener('abort', abortHandler)
                this.pendingRequests.delete(request.id)
                reject(error)
            }
        })
    }

    /**
     * 处理接收到的数据
     */
    private handleData(data: string): void {
        this.buffer += data
        const lines = this.buffer.split('\n')
        this.buffer = lines.pop() ?? ''

        for (const line of lines) {
            if (line.trim()) {
                this.parseMessage(line)
            }
        }
    }

    /**
     * 解析 JSON-RPC 消息
     */
    private parseMessage(raw: string): void {
        try {
            const message = JSON.parse(raw)

            if ('id' in message) {
                // 这是一个响应
                const pending = this.pendingRequests.get(message.id)
                if (pending) {
                    this.pendingRequests.delete(message.id)
                    pending.resolve(message)
                } else {
                    console.warn('[MCP Stdio] Unexpected response ID:', message.id)
                }
            } else if (message.method) {
                // 这是一个通知
                this.emitMessage(message)
            }
        } catch (error) {
            this.handleParseError(error)
        }
    }

    /**
     * 处理进程关闭
     */
    private handleClose(code: number | null, signal?: string | null): void {
        if (!this.isDestroyed()) {
            console.debug('[MCP Stdio] Process closed', { code, signal })
            this.teardownConnection()
            const reason = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`
            this.rejectPendingRequests(new Error(`Process exited with ${reason}`))
        }
    }

    /**
     * 处理进程错误
     */
    private handleError(error: Error): void {
        console.error('[MCP Stdio] Process error:', error)
        this.teardownConnection()
        this.rejectPendingRequests(error)
    }

    /**
     * 生成请求 ID
     */
    private generateId(): number {
        this.requestId++
        return this.requestId
    }

    /**
     * 获取进程对象（用于测试）
     */
    getProcess(): any {
        return this.processID
    }

    private subscribe(event: string, handler: BridgeIPCListener): void {
        if (!this.processID) {
            return
        }

        const channel = `bridge:subprocess:${this.processID}:${event}`
        this.subscriptions.set(channel, handler)
        getBridgeIPC().on(channel, handler)
    }

    private unsubscribeAll(): void {
        for (const [channel, handler] of this.subscriptions.entries()) {
            getBridgeIPC().off(channel, handler)
        }
        this.subscriptions.clear()
    }

    private teardownConnection(): void {
        this.unsubscribeAll()
        this.processID = null
        this.connected = false
        this.buffer = ''
    }

    private rejectPendingRequests(error: Error): void {
        this.pendingRequests.forEach(({ reject }) => {
            reject(error)
        })
        this.pendingRequests.clear()
    }

    private deserializeError(error: BridgeSerializedError): Error {
        const restored = new Error(error.message ?? 'Unknown subprocess error')
        restored.name = error.name ?? 'Error'
        restored.stack = error.stack
        return restored
    }
}
