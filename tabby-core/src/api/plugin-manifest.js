function resolveProviderClass(provider) {
    if (typeof provider === 'function') {
        return provider;
    }
    if (provider && typeof provider === 'object') {
        const typedProvider = provider;
        const resolved = typedProvider.useClass ?? typedProvider.useExisting;
        return typeof resolved === 'function' ? resolved : null;
    }
    return null;
}
export function getManifestProviderClasses(manifest) {
    if (!manifest?.providers) {
        return [];
    }
    return manifest.providers
        .map(resolveProviderClass)
        .filter((provider) => !!provider);
}
//# sourceMappingURL=plugin-manifest.js.map