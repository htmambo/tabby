import { createServer, type Server, type Socket } from 'node:net'

const SOCKS_VERSION = 0x05
const AUTH_NONE = 0x00
const AUTH_NOT_ACCEPTABLE = 0xff
const COMMAND_CONNECT = 0x01
const RESERVED_BYTE = 0x00
const ADDRESS_TYPE_IPV4 = 0x01
const ADDRESS_TYPE_DOMAIN = 0x03
const ADDRESS_TYPE_IPV6 = 0x04
const REPLY_SUCCEEDED = 0x00
const REPLY_GENERAL_FAILURE = 0x01
const REPLY_COMMAND_NOT_SUPPORTED = 0x07
const REPLY_ADDRESS_TYPE_NOT_SUPPORTED = 0x08

export interface SocksProxyInfo {
    dstAddr: string
    dstPort: number
}

export type SocksAccept = () => Socket
export type SocksReject = (replyCode?: number) => void
export type SocksConnectionHandler = (info: SocksProxyInfo, accept: SocksAccept, reject: SocksReject) => void | Promise<void>

class SocksProtocolError extends Error {
    constructor (
        message: string,
        readonly replyCode?: number,
        readonly greetingResponse?: Uint8Array,
    ) {
        super(message)
    }
}

export function createSocks5Server (handler: SocksConnectionHandler): Server {
    return createServer(socket => {
        let stage: 'greeting' | 'request' | 'pending' | 'done' = 'greeting'
        let pendingBuffer = Buffer.alloc(0)

        const onData = (chunk: Buffer) => {
            if (stage === 'done' || stage === 'pending') {
                return
            }

            try {
                pendingBuffer = Buffer.concat([toBytes(pendingBuffer), toBytes(chunk)])

                while (true) {
                    if (stage === 'greeting') {
                        const result = parseGreeting(pendingBuffer)
                        if (!result) {
                            return
                        }

                        pendingBuffer = pendingBuffer.subarray(result)
                        if (!socket.write(Uint8Array.from([SOCKS_VERSION, AUTH_NONE]))) {
                            return
                        }
                        stage = 'request'
                        continue
                    }

                    const request = parseConnectRequest(pendingBuffer)
                    if (!request) {
                        return
                    }

                    pendingBuffer = pendingBuffer.subarray(request.consumed)
                    stage = 'pending'
                    socket.off('data', onData)
                    socket.pause()

                    let completed = false

                    const accept = () => {
                        if (completed) {
                            return socket
                        }
                        completed = true
                        stage = 'done'
                        socket.write(buildReply(REPLY_SUCCEEDED))
                        if (pendingBuffer.length) {
                            socket.unshift(toBytes(pendingBuffer))
                            pendingBuffer = Buffer.alloc(0)
                        }
                        socket.resume()
                        return socket
                    }

                    const reject = (replyCode = REPLY_GENERAL_FAILURE) => {
                        if (completed) {
                            return
                        }
                        completed = true
                        stage = 'done'
                        socket.write(buildReply(replyCode), () => socket.destroy())
                    }

                    void Promise.resolve(handler(request.info, accept, reject)).catch(() => {
                        reject()
                    })
                    return
                }
            } catch (error) {
                stage = 'done'
                if (error instanceof SocksProtocolError) {
                    if (error.greetingResponse) {
                        socket.write(error.greetingResponse, () => socket.destroy())
                        return
                    }
                    if (error.replyCode !== undefined) {
                        socket.write(buildReply(error.replyCode), () => socket.destroy())
                        return
                    }
                }
                socket.destroy()
            }
        }

        socket.on('data', onData)
        socket.on('error', () => {
            stage = 'done'
        })
    })
}

function parseGreeting (buffer: Buffer): number | null {
    if (buffer.length < 2) {
        return null
    }

    if (buffer[0] !== SOCKS_VERSION) {
        throw new SocksProtocolError(`Unsupported SOCKS version: ${buffer[0]}`)
    }

    const methodCount = buffer[1]
    const totalLength = 2 + methodCount
    if (buffer.length < totalLength) {
        return null
    }

    const methods = buffer.subarray(2, totalLength)
    if (!methods.includes(AUTH_NONE)) {
        throw new SocksProtocolError(
            `No supported SOCKS authentication method: ${AUTH_NOT_ACCEPTABLE}`,
            undefined,
            Uint8Array.from([SOCKS_VERSION, AUTH_NOT_ACCEPTABLE]),
        )
    }

    return totalLength
}

function parseConnectRequest (buffer: Buffer): { consumed: number, info: SocksProxyInfo } | null {
    if (buffer.length < 4) {
        return null
    }

    if (buffer[0] !== SOCKS_VERSION) {
        throw new SocksProtocolError(`Unsupported SOCKS version: ${buffer[0]}`)
    }

    if (buffer[1] !== COMMAND_CONNECT) {
        throw new SocksProtocolError(`Unsupported SOCKS command: ${buffer[1]}`, REPLY_COMMAND_NOT_SUPPORTED)
    }

    if (buffer[2] !== RESERVED_BYTE) {
        throw new SocksProtocolError(`Invalid SOCKS reserved byte: ${buffer[2]}`)
    }

    const addressType = buffer[3]
    let offset = 4
    let destinationAddress: string

    if (addressType === ADDRESS_TYPE_IPV4) {
        if (buffer.length < offset + 4 + 2) {
            return null
        }
        destinationAddress = Array.from(buffer.subarray(offset, offset + 4)).join('.')
        offset += 4
    } else if (addressType === ADDRESS_TYPE_DOMAIN) {
        if (buffer.length < offset + 1) {
            return null
        }
        const length = buffer[offset]
        offset += 1
        if (buffer.length < offset + length + 2) {
            return null
        }
        destinationAddress = buffer.subarray(offset, offset + length).toString('utf8')
        offset += length
    } else if (addressType === ADDRESS_TYPE_IPV6) {
        if (buffer.length < offset + 16 + 2) {
            return null
        }
        destinationAddress = formatIPv6(buffer.subarray(offset, offset + 16))
        offset += 16
    } else {
        throw new SocksProtocolError(`Unsupported SOCKS address type: ${addressType}`, REPLY_ADDRESS_TYPE_NOT_SUPPORTED)
    }

    const destinationPort = buffer.readUInt16BE(offset)
    offset += 2

    return {
        consumed: offset,
        info: {
            dstAddr: destinationAddress,
            dstPort: destinationPort,
        },
    }
}

function formatIPv6 (buffer: Buffer): string {
    const groups: string[] = []
    for (let i = 0; i < buffer.length; i += 2) {
        groups.push(buffer.readUInt16BE(i).toString(16))
    }
    return groups.join(':')
}

function buildReply (replyCode: number): Uint8Array {
    return Uint8Array.from([
        SOCKS_VERSION,
        replyCode,
        RESERVED_BYTE,
        ADDRESS_TYPE_IPV4,
        0,
        0,
        0,
        0,
        0,
        0,
    ])
}

function toBytes (buffer: Buffer): Uint8Array {
    return Uint8Array.from(buffer)
}
