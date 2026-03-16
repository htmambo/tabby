import { contextBridge, ipcRenderer, shell, webUtils } from 'electron'
import type { BridgeIPCListener, TabbyBridge } from './tabby-bridge'
import type { TabbyRuntimeBridge } from '../../tabby-core/src/api/rendererRuntime'
import { ALLOWED_RUNTIME_ENV_KEYS } from '../../tabby-core/src/api/runtimeEnv'

declare const __non_webpack_require__: NodeJS.Require

type GlobalTarget = typeof globalThis & {
    nodeRequire?: NodeJS.Require
    tabbyBridge?: TabbyBridge
}

const nodeRequire = __non_webpack_require__
const os = nodeRequire('os') as typeof import('os')
const allowedRuntimeEnvKeys = new Set<string>(ALLOWED_RUNTIME_ENV_KEYS)

function ensureAllowedRuntimeEnvKey (name: string): void {
    if (!allowedRuntimeEnvKeys.has(name)) {
        throw new Error(`Access to environment variable "${name}" is not allowed through the preload bridge`)
    }
}

function ensureSafeRuntimeEnvLookupName (name: string): void {
    if (!name || name.includes('\0') || name.includes('=')) {
        throw new Error(`Invalid environment variable name "${name}"`)
    }
}

const listenerWrappers = new WeakMap<BridgeIPCListener, (_event: unknown, ...args: any[]) => void>()

function wrapListener (listener: BridgeIPCListener): (_event: unknown, ...args: any[]) => void {
    let wrapped = listenerWrappers.get(listener)
    if (!wrapped) {
        wrapped = (_event, ...args) => listener(...args)
        listenerWrappers.set(listener, wrapped)
    }
    return wrapped
}

const runtime: TabbyRuntimeBridge = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    version: process.version,
    releaseName: process.release?.name,
    pid: process.pid,
    argv0: process.argv0,
    resourcesPath: (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath,
    cwd: () => process.cwd(),
    getEnv: name => {
        ensureAllowedRuntimeEnvKey(name)
        return process.env[name]
    },
    resolveEnv: name => {
        ensureSafeRuntimeEnvLookupName(name)
        return process.env[name]
    },
    hasEnv: name => {
        ensureAllowedRuntimeEnvKey(name)
        return Object.prototype.hasOwnProperty.call(process.env, name)
    },
    setEnv: (name, value) => {
        ensureAllowedRuntimeEnvKey(name)
        if (value === undefined) {
            delete process.env[name]
        } else {
            process.env[name] = value
        }
    },
    setPromiseAPIEnabled: enabled => {
        ;(process as NodeJS.Process & { enablePromiseAPI?: boolean }).enablePromiseAPI = enabled
    },
}

const tabbyBridge: TabbyBridge = {
    ipc: {
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
        sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        on: (channel, listener) => {
            ipcRenderer.on(channel, wrapListener(listener))
        },
        once: (channel, listener) => {
            ipcRenderer.once(channel, (_event, ...args) => listener(...args))
        },
        off: (channel, listener) => {
            const wrapped = listenerWrappers.get(listener)
            if (wrapped) {
                ipcRenderer.off(channel, wrapped)
            }
        },
    },
    runtime,
    shell: {
        openPath: path => shell.openPath(path),
        openExternal: url => shell.openExternal(url),
        showItemInFolder: path => shell.showItemInFolder(path),
    },
    webUtils: {
        getPathForFile: file => webUtils.getPathForFile(file),
    },
}

function exposeReadonlyGlobal<K extends keyof GlobalTarget> (key: K, value: NonNullable<GlobalTarget[K]>): void {
    Object.defineProperty(globalThis, key, {
        value,
        writable: false,
        configurable: false,
        enumerable: false,
    })
}

if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('tabbyBridge', tabbyBridge)
} else {
    exposeReadonlyGlobal('tabbyBridge', tabbyBridge)
    exposeReadonlyGlobal('nodeRequire', nodeRequire)
}
