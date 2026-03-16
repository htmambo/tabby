import { contextBridge, ipcRenderer, shell, webUtils } from 'electron';
import { ALLOWED_RUNTIME_ENV_KEYS } from '../../tabby-core/src/api/runtimeEnv';
const nodeRequire = __non_webpack_require__;
const os = nodeRequire('os');
const allowedRuntimeEnvKeys = new Set(ALLOWED_RUNTIME_ENV_KEYS);
function ensureAllowedRuntimeEnvKey(name) {
    if (!allowedRuntimeEnvKeys.has(name)) {
        throw new Error(`Access to environment variable "${name}" is not allowed through the preload bridge`);
    }
}
function ensureSafeRuntimeEnvLookupName(name) {
    if (!name || name.includes('\0') || name.includes('=')) {
        throw new Error(`Invalid environment variable name "${name}"`);
    }
}
const listenerWrappers = new WeakMap();
function wrapListener(listener) {
    let wrapped = listenerWrappers.get(listener);
    if (!wrapped) {
        wrapped = (_event, ...args) => listener(...args);
        listenerWrappers.set(listener, wrapped);
    }
    return wrapped;
}
const runtime = {
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    version: process.version,
    releaseName: process.release?.name,
    pid: process.pid,
    argv0: process.argv0,
    resourcesPath: process.resourcesPath,
    cwd: () => process.cwd(),
    getEnv: name => {
        ensureAllowedRuntimeEnvKey(name);
        return process.env[name];
    },
    resolveEnv: name => {
        ensureSafeRuntimeEnvLookupName(name);
        return process.env[name];
    },
    hasEnv: name => {
        ensureAllowedRuntimeEnvKey(name);
        return Object.prototype.hasOwnProperty.call(process.env, name);
    },
    setEnv: (name, value) => {
        ensureAllowedRuntimeEnvKey(name);
        if (value === undefined) {
            delete process.env[name];
        }
        else {
            process.env[name] = value;
        }
    },
    setPromiseAPIEnabled: enabled => {
        ;
        process.enablePromiseAPI = enabled;
    },
};
const tabbyBridge = {
    ipc: {
        send: (channel, ...args) => ipcRenderer.send(channel, ...args),
        sendSync: (channel, ...args) => ipcRenderer.sendSync(channel, ...args),
        invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
        on: (channel, listener) => {
            ipcRenderer.on(channel, wrapListener(listener));
        },
        once: (channel, listener) => {
            ipcRenderer.once(channel, (_event, ...args) => listener(...args));
        },
        off: (channel, listener) => {
            const wrapped = listenerWrappers.get(listener);
            if (wrapped) {
                ipcRenderer.off(channel, wrapped);
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
};
function exposeReadonlyGlobal(key, value) {
    Object.defineProperty(globalThis, key, {
        value,
        writable: false,
        configurable: false,
        enumerable: false,
    });
}
if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('tabbyBridge', tabbyBridge);
}
else {
    exposeReadonlyGlobal('tabbyBridge', tabbyBridge);
    exposeReadonlyGlobal('nodeRequire', nodeRequire);
}
//# sourceMappingURL=bridge.preload.js.map