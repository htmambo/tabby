import { ALLOWED_RUNTIME_ENV_KEYS } from './runtimeEnv'

export interface TabbyRuntimeBridge {
    platform: NodeJS.Platform
    arch: string
    osRelease: string
    version: string
    releaseName?: string
    pid: number
    argv0: string
    resourcesPath?: string
    cwd: () => string
    getEnv: (name: string) => string | undefined
    resolveEnv: (name: string) => string | undefined
    hasEnv: (name: string) => boolean
    setEnv: (name: string, value?: string) => void
    setPromiseAPIEnabled: (enabled: boolean) => void
}

type RuntimeWindow = Window & {
    tabbyBridge?: {
        runtime?: TabbyRuntimeBridge
    }
}

function getRuntimeBridge (): TabbyRuntimeBridge | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }
    return (window as RuntimeWindow).tabbyBridge?.runtime
}

function getNodeProcess (): NodeJS.Process {
    if (typeof process === 'undefined') {
        throw new Error('Runtime process is unavailable')
    }
    return process
}

export function getRuntimePlatform (): NodeJS.Platform {
    return getRuntimeBridge()?.platform ?? getNodeProcess().platform
}

export function getRuntimeArch (): string {
    return getRuntimeBridge()?.arch ?? getNodeProcess().arch
}

export function getRuntimeOSRelease (): string {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.osRelease
    }

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('os').release()
}

export function getRuntimeVersion (): string {
    return getRuntimeBridge()?.version ?? getNodeProcess().version
}

export function getRuntimeReleaseName (): string | undefined {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.releaseName
    }
    return getNodeProcess().release?.name
}

export function getRuntimePid (): number {
    return getRuntimeBridge()?.pid ?? getNodeProcess().pid
}

export function getRuntimeArgv0 (): string {
    return getRuntimeBridge()?.argv0 ?? getNodeProcess().argv0
}

export function getRuntimeResourcesPath (): string | undefined {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.resourcesPath
    }
    return (getNodeProcess() as NodeJS.Process & { resourcesPath?: string }).resourcesPath
}

export function getRuntimeCwd (): string {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.cwd()
    }
    return getNodeProcess().cwd()
}

export function getRuntimeEnv (name: string): string | undefined {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.getEnv(name)
    }
    return getNodeProcess().env[name]
}

export function resolveRuntimeEnv (name: string): string | undefined {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.resolveEnv(name)
    }
    return getNodeProcess().env[name]
}

export function listRuntimeEnvKeys (): string[] {
    if (getRuntimeBridge()) {
        return Array.from(ALLOWED_RUNTIME_ENV_KEYS)
    }
    return Object.keys(getNodeProcess().env)
}

export function getRuntimeEnvObject (names?: readonly string[]): Record<string, string> {
    const result: Record<string, string> = {}
    const envNames = names ?? listRuntimeEnvKeys()
    for (const name of envNames) {
        const value = getRuntimeEnv(name)
        if (value !== undefined) {
            result[name] = value
        }
    }
    return result
}

export function hasRuntimeEnv (name: string): boolean {
    const bridge = getRuntimeBridge()
    if (bridge) {
        return bridge.hasEnv(name)
    }
    return Object.prototype.hasOwnProperty.call(getNodeProcess().env, name)
}

export function setRuntimeEnv (name: string, value?: string): void {
    const bridge = getRuntimeBridge()
    if (bridge) {
        bridge.setEnv(name, value)
        return
    }

    const runtimeProcess = getNodeProcess()
    if (value === undefined) {
        delete runtimeProcess.env[name]
    } else {
        runtimeProcess.env[name] = value
    }
}

export function setRuntimePromiseAPIEnabled (enabled: boolean): void {
    const bridge = getRuntimeBridge()
    if (bridge) {
        bridge.setPromiseAPIEnabled(enabled)
        return
    }
    ;(getNodeProcess() as NodeJS.Process & { enablePromiseAPI?: boolean }).enablePromiseAPI = enabled
}

export function isRuntimeDev (): boolean {
    return hasRuntimeEnv('TABBY_DEV')
}
