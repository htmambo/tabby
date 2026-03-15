const textEncoder = new TextEncoder()

function getCrypto (): Crypto {
    if (!globalThis.crypto?.subtle) {
        throw new Error('Web Crypto API is unavailable')
    }
    return globalThis.crypto
}

function toArrayBuffer (bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    return copy.buffer
}

function bytesToHex (bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function bytesToBase64 (bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

export async function sha256Base64 (value: Uint8Array): Promise<string> {
    const digest = await getCrypto().subtle.digest('SHA-256', toArrayBuffer(value))
    return bytesToBase64(new Uint8Array(digest))
}

export async function sha512Hex (value: Uint8Array|string): Promise<string> {
    const bytes = typeof value === 'string' ? textEncoder.encode(value) : value
    const digest = await getCrypto().subtle.digest('SHA-512', toArrayBuffer(bytes))
    return bytesToHex(new Uint8Array(digest))
}

export function randomHex (byteLength: number): string {
    const bytes = new Uint8Array(byteLength)
    getCrypto().getRandomValues(bytes)
    return bytesToHex(bytes)
}
