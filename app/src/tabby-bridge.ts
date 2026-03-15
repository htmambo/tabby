import type { TabbyRuntimeBridge } from '../../tabby-core/src/api/rendererRuntime'

export type BridgeIPCListener = (...args: any[]) => void

export interface BridgeIPC {
    send: (channel: string, ...args: any[]) => void
    sendSync: <T = any>(channel: string, ...args: any[]) => T
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
    on: (channel: string, listener: BridgeIPCListener) => void
    once: (channel: string, listener: BridgeIPCListener) => void
    off: (channel: string, listener: BridgeIPCListener) => void
}

export interface TabbyBridge {
    ipc: BridgeIPC
    runtime: TabbyRuntimeBridge
    shell: {
        openPath: (path: string) => Promise<string>
        openExternal: (url: string) => Promise<void>
        showItemInFolder: (path: string) => void
    }
    webUtils: {
        getPathForFile: (file: File) => string
    }
}

type BridgeWindow = Window & {
    nodeRequire?: NodeJS.Require
    tabbyBridge?: TabbyBridge
}

export function getTabbyBridge (): TabbyBridge {
    const bridge = (window as BridgeWindow).tabbyBridge
    if (!bridge) {
        throw new Error('Tabby preload bridge is unavailable')
    }
    return bridge
}

export function getNodeRequire (): NodeJS.Require {
    const nodeRequire = (window as BridgeWindow).nodeRequire
    if (!nodeRequire) {
        throw new Error('Node require is unavailable in the renderer')
    }
    return nodeRequire
}
