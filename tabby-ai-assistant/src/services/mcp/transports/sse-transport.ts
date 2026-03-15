import { BaseTransport } from './base-transport'
import { MCPRequest, MCPResponse } from '../mcp-message.types'

/**
 * SSE (Server-Sent Events) 传输层实现
 * 使用带认证头的 fetch 维持事件流，避免把令牌暴露到 URL 查询参数。
 */
export class SSETransport extends BaseTransport {
    private pendingRequests = new Map<string | number, {
        resolve: (value: MCPResponse) => void;
        reject: (reason: any) => void;
    }>()

    private requestId = 0
    private reconnectAttempts = 0
    private maxReconnectAttempts = 5
    private reconnectDelay = 3000
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null
    private eventsUrl: string
    private messageUrl: string
    private eventStreamController: AbortController | null = null
    private eventStreamTask: Promise<void> | null = null
    private streamReadyState = 2

    constructor(
        private url: string,
        private headers: Record<string, string> = {},
    ) {
        super()
        this.eventsUrl = this.buildEventsUrl()
        this.messageUrl = this.buildMessageUrl()
    }

    async connect(): Promise<void> {
        if (this.connected) {
            return
        }

        this.streamReadyState = 0
        try {
            await this.openEventStream()
            this.connected = true
            this.reconnectAttempts = 0
        } catch (error) {
            console.error('[MCP SSE] Failed to connect:', error)
            this.connected = false
            this.streamReadyState = 2
            throw error
        }
    }

    async disconnect(): Promise<void> {
        this.clearReconnectTimer()
        this.eventStreamController?.abort()
        this.eventStreamController = null
        await this.eventStreamTask?.catch(() => null)
        this.eventStreamTask = null

        this.connected = false
        this.streamReadyState = 2

        this.pendingRequests.forEach(({ reject }) => {
            reject(new Error('Transport disconnected'))
        })
        this.pendingRequests.clear()
    }

    override destroy(): void {
        this.clearReconnectTimer()
        super.destroy()
    }

    async send(request: MCPRequest): Promise<MCPResponse> {
        if (!this.connected) {
            throw new Error('Transport not connected')
        }

        if (!request.id) {
            request.id = this.generateId()
        }

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(request.id, { resolve, reject })

            void this.sendRequest(request)
                .then(response => {
                    const pending = this.pendingRequests.get(request.id!)
                    if (pending && response && typeof response === 'object' && 'id' in response && response.id === request.id) {
                        this.pendingRequests.delete(request.id!)
                        pending.resolve(response)
                    }
                })
                .catch(error => {
                    this.pendingRequests.delete(request.id!)
                    reject(error)
                })
        })
    }

    private async openEventStream(): Promise<void> {
        const controller = new AbortController()
        const url = new URL(this.eventsUrl)
        url.searchParams.set('_t', Date.now().toString())

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Accept: 'text/event-stream',
                'Cache-Control': 'no-cache',
                ...this.headers,
            },
            signal: controller.signal,
        })

        if (!response.ok) {
            throw new Error(`HTTP error: ${response.status}`)
        }
        if (!response.body) {
            throw new Error('Event stream body is unavailable')
        }

        this.eventStreamController = controller
        this.streamReadyState = 1
        console.log('[MCP SSE] Connection opened')

        this.eventStreamTask = this.consumeEventStream(response.body, controller).catch(error => {
            if (controller.signal.aborted || this.destroyed) {
                return
            }
            console.error('[MCP SSE] Connection error:', error)
            void this.handleError()
        })
    }

    private async consumeEventStream(body: ReadableStream<Uint8Array>, controller: AbortController): Promise<void> {
        const reader = body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) {
                    break
                }

                buffer += decoder.decode(value, { stream: true }).replace(/\r/g, '')
                buffer = this.processEventBuffer(buffer)
            }

            buffer += decoder.decode().replace(/\r/g, '')
            this.processEventBuffer(buffer, true)
        } finally {
            reader.releaseLock()
        }

        if (!controller.signal.aborted && !this.destroyed) {
            throw new Error('Connection closed')
        }
    }

    private processEventBuffer(buffer: string, flush = false): string {
        let workingBuffer = buffer
        let separatorIndex = workingBuffer.indexOf('\n\n')

        while (separatorIndex !== -1) {
            const eventBlock = workingBuffer.slice(0, separatorIndex).trim()
            workingBuffer = workingBuffer.slice(separatorIndex + 2)
            if (eventBlock) {
                this.handleEventBlock(eventBlock)
            }
            separatorIndex = workingBuffer.indexOf('\n\n')
        }

        if (flush) {
            const trailingEvent = workingBuffer.trim()
            if (trailingEvent) {
                this.handleEventBlock(trailingEvent)
            }
            return ''
        }

        return workingBuffer
    }

    private handleEventBlock(block: string): void {
        let eventName = 'message'
        const dataLines: string[] = []

        for (const line of block.split('\n')) {
            if (!line || line.startsWith(':')) {
                continue
            }

            const separatorIndex = line.indexOf(':')
            const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex)
            let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1)
            if (value.startsWith(' ')) {
                value = value.slice(1)
            }

            if (field === 'event') {
                eventName = value
                continue
            }
            if (field === 'data') {
                dataLines.push(value)
            }
        }

        if (!dataLines.length || eventName === 'ping') {
            return
        }

        this.handleMessage(dataLines.join('\n'))
    }

    private handleMessage(data: string): void {
        try {
            const message = JSON.parse(data)

            if ('id' in message && message.id !== null) {
                const pending = this.pendingRequests.get(message.id)
                if (pending) {
                    this.pendingRequests.delete(message.id)
                    pending.resolve(message)
                }
            } else if (message.jsonrpc && message.method) {
                this.emitMessage(message)
            }
        } catch (error) {
            this.handleParseError(error)
        }
    }

    private async handleError(): Promise<void> {
        this.connected = false
        this.streamReadyState = 0
        this.eventStreamController = null

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++
            console.log(`[MCP SSE] Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)

            this.clearReconnectTimer()
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null
                if (this.destroyed) {
                    return
                }

                void this.openEventStream()
                    .then(() => {
                        this.connected = true
                        this.reconnectAttempts = 0
                    })
                    .catch(error => {
                        console.error('[MCP SSE] Reconnect failed:', error)
                        void this.handleError()
                    })
            }, this.reconnectDelay * this.reconnectAttempts)
            return
        }

        console.error('[MCP SSE] Max reconnect attempts reached')
        this.streamReadyState = 2

        this.pendingRequests.forEach(({ reject }) => {
            reject(new Error('Connection failed after max reconnect attempts'))
        })
        this.pendingRequests.clear()
    }

    private clearReconnectTimer (): void {
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = null
        }
    }

    private async sendRequest(request: MCPRequest): Promise<MCPResponse|null> {
        const timeout = 30000

        try {
            const response = await fetch(this.messageUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.headers,
                },
                body: JSON.stringify(request),
                signal: AbortSignal.timeout(timeout),
            })

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`)
            }

            if (response.status === 202 || response.status === 204) {
                return null
            }

            const contentType = response.headers.get('content-type') ?? ''
            if (!contentType.includes('application/json')) {
                return null
            }

            return await response.json()
        } catch (error) {
            if (error instanceof TypeError && error.message.includes('fetch')) {
                throw new Error('Network request failed. Please ensure the server URL is accessible.')
            }
            throw error
        }
    }

    private buildEventsUrl(): string {
        if (this.url.endsWith('/')) {
            return this.url + 'events'
        }
        if (this.url.includes('/message')) {
            return this.url.replace('/message', '/events')
        }
        if (this.url.includes('/send')) {
            return this.url.replace('/send', '/events')
        }
        return this.url + '/events'
    }

    private buildMessageUrl(): string {
        if (this.url.endsWith('/events')) {
            return this.url.replace('/events', '/message')
        }
        if (this.url.endsWith('/sse')) {
            return this.url.replace('/sse', '/message')
        }
        if (this.url.includes('/events')) {
            return this.url.replace('/events', '/message')
        }
        if (this.url.endsWith('/')) {
            return this.url + 'message'
        }
        return this.url + '/message'
    }

    private generateId(): number {
        this.requestId++
        return this.requestId
    }

    get readyState(): number {
        return this.streamReadyState
    }
}
