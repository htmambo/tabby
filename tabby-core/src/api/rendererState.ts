export type RendererProviderLike = {
    useClass?: unknown
    useExisting?: unknown
} | unknown

export type RendererPluginModule = {
    pluginName: string
    ngModule?: {
        ɵinj?: {
            providers?: RendererProviderLike[]
        }
    }
    ɵinj?: {
        providers?: RendererProviderLike[]
    }
}

export type RendererState = {
    pluginModules?: RendererPluginModule[]
    safeModeReason?: Error
}

type RendererWindow = Window & {
    tabbyState?: RendererState
}

function getRendererState (): RendererState | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }
    const typedWindow = window as RendererWindow
    if (!typedWindow.tabbyState) {
        typedWindow.tabbyState = {}
    }
    return typedWindow.tabbyState
}

function normalizeError (reason: unknown): Error {
    if (reason instanceof Error) {
        return reason
    }
    if (typeof reason === 'string') {
        return new Error(reason)
    }
    return new Error('Unknown error')
}

export function setRendererPluginModules (modules: RendererPluginModule[]): void {
    const state = getRendererState()
    if (!state) {
        return
    }
    state.pluginModules = modules
}

export function getRendererPluginModules (): RendererPluginModule[] {
    const state = getRendererState()
    return state?.pluginModules ?? []
}

export function setRendererSafeModeReason (reason: unknown): void {
    const state = getRendererState()
    if (!state) {
        return
    }
    state.safeModeReason = normalizeError(reason)
}

export function getRendererSafeModeReason (): Error | undefined {
    return getRendererState()?.safeModeReason
}
