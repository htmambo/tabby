function getRendererState() {
    if (typeof window === 'undefined') {
        return undefined;
    }
    const typedWindow = window;
    if (!typedWindow.tabbyState) {
        typedWindow.tabbyState = {};
    }
    return typedWindow.tabbyState;
}
function normalizeError(reason) {
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === 'string') {
        return new Error(reason);
    }
    return new Error('Unknown error');
}
export function setRendererPluginModules(modules) {
    const state = getRendererState();
    if (!state) {
        return;
    }
    state.pluginModules = modules;
}
export function getRendererPluginModules() {
    const state = getRendererState();
    return state?.pluginModules ?? [];
}
export function setRendererSafeModeReason(reason) {
    const state = getRendererState();
    if (!state) {
        return;
    }
    state.safeModeReason = normalizeError(reason);
}
export function getRendererSafeModeReason() {
    return getRendererState()?.safeModeReason;
}
//# sourceMappingURL=rendererState.js.map