import { ALLOWED_RUNTIME_ENV_KEYS } from './runtimeEnv';
function getRuntimeBridge() {
    if (typeof window === 'undefined') {
        return undefined;
    }
    return window.tabbyBridge?.runtime;
}
function getNodeProcess() {
    if (typeof process === 'undefined') {
        throw new Error('Runtime process is unavailable');
    }
    return process;
}
export function getRuntimePlatform() {
    return getRuntimeBridge()?.platform ?? getNodeProcess().platform;
}
export function getRuntimeArch() {
    return getRuntimeBridge()?.arch ?? getNodeProcess().arch;
}
export function getRuntimeOSRelease() {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.osRelease;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('os').release();
}
export function getRuntimeVersion() {
    return getRuntimeBridge()?.version ?? getNodeProcess().version;
}
export function getRuntimeReleaseName() {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.releaseName;
    }
    return getNodeProcess().release?.name;
}
export function getRuntimePid() {
    return getRuntimeBridge()?.pid ?? getNodeProcess().pid;
}
export function getRuntimeArgv0() {
    return getRuntimeBridge()?.argv0 ?? getNodeProcess().argv0;
}
export function getRuntimeResourcesPath() {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.resourcesPath;
    }
    return getNodeProcess().resourcesPath;
}
export function getRuntimeCwd() {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.cwd();
    }
    return getNodeProcess().cwd();
}
export function getRuntimeEnv(name) {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.getEnv(name);
    }
    return getNodeProcess().env[name];
}
export function resolveRuntimeEnv(name) {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.resolveEnv(name);
    }
    return getNodeProcess().env[name];
}
export function listRuntimeEnvKeys() {
    if (getRuntimeBridge()) {
        return Array.from(ALLOWED_RUNTIME_ENV_KEYS);
    }
    return Object.keys(getNodeProcess().env);
}
export function getRuntimeEnvObject(names) {
    const result = {};
    const envNames = names ?? listRuntimeEnvKeys();
    for (const name of envNames) {
        const value = getRuntimeEnv(name);
        if (value !== undefined) {
            result[name] = value;
        }
    }
    return result;
}
export function hasRuntimeEnv(name) {
    const bridge = getRuntimeBridge();
    if (bridge) {
        return bridge.hasEnv(name);
    }
    return Object.prototype.hasOwnProperty.call(getNodeProcess().env, name);
}
export function setRuntimeEnv(name, value) {
    const bridge = getRuntimeBridge();
    if (bridge) {
        bridge.setEnv(name, value);
        return;
    }
    const runtimeProcess = getNodeProcess();
    if (value === undefined) {
        delete runtimeProcess.env[name];
    }
    else {
        runtimeProcess.env[name] = value;
    }
}
export function setRuntimePromiseAPIEnabled(enabled) {
    const bridge = getRuntimeBridge();
    if (bridge) {
        bridge.setPromiseAPIEnabled(enabled);
        return;
    }
    ;
    getNodeProcess().enablePromiseAPI = enabled;
}
export function isRuntimeDev() {
    return hasRuntimeEnv('TABBY_DEV');
}
//# sourceMappingURL=rendererRuntime.js.map