export function getTabbyBridge() {
    const bridge = window.tabbyBridge;
    if (!bridge) {
        throw new Error('Tabby preload bridge is unavailable');
    }
    return bridge;
}
export function getNodeRequire() {
    const nodeRequire = window.nodeRequire;
    if (!nodeRequire) {
        throw new Error('Node require is unavailable in the renderer');
    }
    return nodeRequire;
}
//# sourceMappingURL=tabby-bridge.js.map