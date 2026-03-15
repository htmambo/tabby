export interface LocalFileSystemStat {
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
    size: number
    mode: number
    mtimeMs: number
}

export interface LocalFileSystemDirEntry {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
}

interface RendererIPCBridge {
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
}

type BridgeWindow = Window & {
    tabbyBridge?: {
        ipc?: RendererIPCBridge
    }
}

function getBridgeIPC (): RendererIPCBridge | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }
    return (window as BridgeWindow).tabbyBridge?.ipc
}

function getNodeFSPromises (): typeof import('fs/promises') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('fs/promises')
}

function getBufferCtor (): typeof Buffer {
    if (typeof Buffer !== 'undefined') {
        return Buffer
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('buffer').Buffer
}

export async function pathExists (filePath: string): Promise<boolean> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<boolean>('bridge:fs:exists', filePath)
    }

    try {
        await getNodeFSPromises().access(filePath)
        return true
    } catch {
        return false
    }
}

export async function readPathStat (filePath: string): Promise<LocalFileSystemStat | null> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<LocalFileSystemStat | null>('bridge:fs:stat', filePath)
    }

    try {
        const stat = await getNodeFSPromises().lstat(filePath)
        return {
            isFile: stat.isFile(),
            isDirectory: stat.isDirectory(),
            isSymbolicLink: stat.isSymbolicLink(),
            size: stat.size,
            mode: stat.mode,
            mtimeMs: stat.mtimeMs,
        }
    } catch {
        return null
    }
}

export async function readTextFile (filePath: string): Promise<string> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<string>('bridge:fs:read-file-text', filePath)
    }

    return getNodeFSPromises().readFile(filePath, 'utf8')
}

export async function writeTextFile (filePath: string, content: string): Promise<void> {
    const ipc = getBridgeIPC()
    if (ipc) {
        await ipc.invoke('bridge:fs:write-file-text', filePath, content)
        return
    }

    await getNodeFSPromises().writeFile(filePath, content, 'utf8')
}

export async function readBinaryFile (filePath: string): Promise<Buffer> {
    const ipc = getBridgeIPC()
    if (ipc) {
        const content = await ipc.invoke<string>('bridge:fs:read-file-base64', filePath)
        return getBufferCtor().from(content, 'base64')
    }

    return getNodeFSPromises().readFile(filePath)
}

export async function writeBinaryFile (filePath: string, content: Uint8Array): Promise<void> {
    const ipc = getBridgeIPC()
    if (ipc) {
        await ipc.invoke('bridge:fs:write-file-base64', filePath, getBufferCtor().from(content).toString('base64'))
        return
    }

    await getNodeFSPromises().writeFile(filePath, content)
}

export async function readDirectory (filePath: string): Promise<LocalFileSystemDirEntry[]> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<LocalFileSystemDirEntry[]>('bridge:fs:read-dir', filePath)
    }

    const entries = await getNodeFSPromises().readdir(filePath, { withFileTypes: true })
    return entries.map(entry => ({
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
    }))
}

export async function resolveRealPath (filePath: string): Promise<string | null> {
    const ipc = getBridgeIPC()
    if (ipc) {
        return ipc.invoke<string | null>('bridge:fs:realpath', filePath)
    }

    try {
        return await getNodeFSPromises().realpath(filePath)
    } catch {
        return null
    }
}

export async function chmodPath (filePath: string, mode: number): Promise<void> {
    const ipc = getBridgeIPC()
    if (ipc) {
        await ipc.invoke('bridge:fs:chmod', filePath, mode)
        return
    }

    await getNodeFSPromises().chmod(filePath, mode)
}
