import { Provider } from '@angular/core'

export interface TabbyPluginManifest {
    name: string
    providers?: Provider[]
}

function resolveProviderClass (provider: Provider | unknown): Function | null {
    if (typeof provider === 'function') {
        return provider
    }
    if (provider && typeof provider === 'object') {
        const typedProvider = provider as { useClass?: unknown; useExisting?: unknown }
        const resolved = typedProvider.useClass ?? typedProvider.useExisting
        return typeof resolved === 'function' ? resolved : null
    }
    return null
}

export function getManifestProviderClasses (manifest?: TabbyPluginManifest): Function[] {
    if (!manifest?.providers) {
        return []
    }
    return manifest.providers
        .map(resolveProviderClass)
        .filter((provider): provider is Function => !!provider)
}
