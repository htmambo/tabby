"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PTYManager = exports.PTY = void 0;
const nodePTY = __importStar(require("node-pty"));
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
const electron_1 = require("electron");
const native_process_working_directory_1 = require("native-process-working-directory");
const utfSplitter_1 = require("../../tabby-core/src/utfSplitter");
const rxjs_1 = require("rxjs");
let macOSNativeProcessList = null;
try {
    macOSNativeProcessList = require('macos-native-processlist'); // eslint-disable-line @typescript-eslint/no-var-requires
}
catch (_a) { }
let windowsProcessTree = null;
try {
    windowsProcessTree = require('@tabby-gang/windows-process-tree'); // eslint-disable-line @typescript-eslint/no-var-requires
}
catch (_b) { }
function mergeEnv(...envs) {
    var _a;
    const result = {};
    const keyMap = {};
    for (const env of envs) {
        if (!env) {
            continue;
        }
        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) {
                continue;
            }
            const lookup = key.toLowerCase();
            (_a = keyMap[lookup]) !== null && _a !== void 0 ? _a : (keyMap[lookup] = key);
            result[keyMap[lookup]] = value;
        }
    }
    return result;
}
function substituteEnv(env, platform, baseEnv) {
    const resolvedEnv = Object.assign({}, (env !== null && env !== void 0 ? env : {}));
    const pattern = platform === 'win32' ? /%(\w+)%/g : /\$(\w+)\b/g;
    for (const [key, value] of Object.entries(resolvedEnv)) {
        resolvedEnv[key] = value.replace(pattern, (_substring, envName) => {
            var _a, _b, _c;
            if (platform === 'win32') {
                return (_b = (_a = Object.entries(baseEnv).find(([entryKey]) => entryKey.toLowerCase() === envName.toLowerCase())) === null || _a === void 0 ? void 0 : _a[1]) !== null && _b !== void 0 ? _b : '';
            }
            return (_c = baseEnv[envName]) !== null && _c !== void 0 ? _c : '';
        });
    }
    return resolvedEnv;
}
function normalizeSpawnOptions(options) {
    var _a;
    const { tabbyProfileEnv, tabbyTerminalEnv, tabbySetComSpec, tabbyExecutable } = options, ptyOptions = __rest(options, ["tabbyProfileEnv", "tabbyTerminalEnv", "tabbySetComSpec", "tabbyExecutable"]);
    let env = mergeEnv(process.env, ptyOptions.env, substituteEnv(tabbyProfileEnv, process.platform, process.env), tabbyTerminalEnv);
    if (process.platform === 'win32' && tabbySetComSpec && tabbyExecutable) {
        env = mergeEnv(env, { COMSPEC: tabbyExecutable });
    }
    if (process.platform === 'darwin' && !process.env.LC_ALL) {
        const locale = (_a = process.env.LC_CTYPE) !== null && _a !== void 0 ? _a : 'en_US.UTF-8';
        env = mergeEnv(env, {
            LANG: locale,
            LC_ALL: locale,
            LC_MESSAGES: locale,
            LC_NUMERIC: locale,
            LC_COLLATE: locale,
            LC_MONETARY: locale,
        });
    }
    delete env[''];
    return Object.assign(Object.assign({}, ptyOptions), { env });
}
class PTYDataQueue {
    constructor(pty, onData) {
        this.pty = pty;
        this.onData = onData;
        this.buffers = [];
        this.delta = 0;
        this.maxChunk = 1024 * 100;
        this.maxDelta = this.maxChunk * 5;
        this.flowPaused = false;
        this.decoder = new utfSplitter_1.UTF8Splitter();
        this.output$ = new rxjs_1.Subject();
        this.output$.pipe((0, rxjs_1.debounceTime)(500)).subscribe(() => {
            const remainder = this.decoder.flush();
            if (remainder.length) {
                this.onData(remainder);
            }
        });
    }
    push(data) {
        this.buffers.push(data);
        this.maybeEmit();
    }
    ack(length) {
        this.delta -= length;
        this.maybeEmit();
    }
    maybeEmit() {
        if (this.delta <= this.maxDelta && this.flowPaused) {
            this.resume();
            return;
        }
        if (this.buffers.length > 0) {
            if (this.delta > this.maxDelta && !this.flowPaused) {
                this.pause();
                return;
            }
            const buffersToSend = [];
            let totalLength = 0;
            while (totalLength < this.maxChunk && this.buffers.length) {
                totalLength += this.buffers[0].length;
                const nextBuffer = this.buffers.shift();
                if (!nextBuffer) {
                    break;
                }
                buffersToSend.push(nextBuffer);
            }
            if (buffersToSend.length === 0) {
                return;
            }
            let toSend = Buffer.concat(buffersToSend);
            if (toSend.length > this.maxChunk) {
                this.buffers.unshift(toSend.slice(this.maxChunk));
                toSend = toSend.slice(0, this.maxChunk);
            }
            this.emitData(toSend);
            this.delta += toSend.length;
            if (this.buffers.length) {
                const emitHandle = setImmediate(() => this.maybeEmit());
                if (typeof (emitHandle === null || emitHandle === void 0 ? void 0 : emitHandle.unref) === 'function') {
                    emitHandle.unref();
                }
            }
        }
    }
    emitData(data) {
        const validChunk = this.decoder.write(data);
        this.onData(validChunk);
        this.output$.next(validChunk);
    }
    pause() {
        this.pty.pause();
        this.flowPaused = true;
    }
    resume() {
        this.pty.resume();
        this.flowPaused = false;
        this.maybeEmit();
    }
}
class PTY {
    constructor(id, app, ...args) {
        this.id = id;
        this.app = app;
        this.exited = false;
        const normalizedArgs = [...args];
        if (normalizedArgs[2] && typeof normalizedArgs[2] === 'object') {
            normalizedArgs[2] = normalizeSpawnOptions(normalizedArgs[2]);
        }
        this.pty = nodePTY.spawn(...normalizedArgs);
        for (const key of ['close', 'exit']) {
            this.pty.on(key, (...eventArgs) => this.emit(key, ...eventArgs));
        }
        this.outputQueue = new PTYDataQueue(this.pty, data => {
            const dataHandle = setImmediate(() => this.emit('data', data));
            if (typeof (dataHandle === null || dataHandle === void 0 ? void 0 : dataHandle.unref) === 'function') {
                dataHandle.unref();
            }
        });
        this.pty.onData(data => this.outputQueue.push(Buffer.from(data)));
        this.pty.onExit(() => {
            this.exited = true;
        });
    }
    getPID() {
        return this.pty.pid;
    }
    resize(columns, rows) {
        if (this.pty._writable) {
            this.pty.resize(columns, rows);
        }
    }
    write(buffer) {
        if (this.pty._writable) {
            this.pty.write(buffer);
        }
    }
    ackData(length) {
        this.outputQueue.ack(length);
    }
    kill(signal) {
        this.pty.kill(signal);
    }
    emit(event, ...args) {
        this.app.broadcast(`pty:${this.id}:${event}`, ...args);
    }
}
exports.PTY = PTY;
class PTYManager {
    constructor() {
        this.ptys = {};
        this.truePIDCache = {};
    }
    async getChildProcessesByPID(parentPID) {
        if (!parentPID) {
            return [];
        }
        if (process.platform === 'darwin' && macOSNativeProcessList) {
            const processes = await macOSNativeProcessList.getProcessList();
            return processes
                .filter(processInfo => processInfo.ppid === parentPID)
                .map(processInfo => ({
                pid: processInfo.pid,
                ppid: processInfo.ppid,
                command: processInfo.name,
            }));
        }
        if (process.platform === 'win32' && windowsProcessTree) {
            return new Promise(resolve => {
                windowsProcessTree.getProcessTree(parentPID, tree => {
                    resolve(tree ? tree.children.map(child => ({
                        pid: child.pid,
                        ppid: tree.pid,
                        command: child.name,
                    })) : []);
                });
            });
        }
        return new Promise((resolve, reject) => {
            (0, child_process_1.execFile)('ps', ['-o', 'pid=,ppid=,comm=', '-ax'], (error, stdout) => {
                if (error) {
                    reject(error);
                    return;
                }
                const processes = stdout
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                    const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/);
                    if (!match) {
                        return null;
                    }
                    return {
                        pid: Number(match[1]),
                        ppid: Number(match[2]),
                        command: match[3],
                    };
                })
                    .filter((processInfo) => !!processInfo)
                    .filter(processInfo => processInfo.ppid === parentPID);
                resolve(processes);
            });
        });
    }
    async resolveTruePID(id) {
        if (this.truePIDCache[id]) {
            return this.truePIDCache[id];
        }
        this.truePIDCache[id] = (async () => {
            var _a, _b;
            let pid = (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.getPID();
            if (!pid) {
                throw new Error(`PTY ${id} is not available`);
            }
            await new Promise(resolve => {
                const timer = setTimeout(resolve, 2000);
                if (typeof timer === 'object' && typeof timer.unref === 'function') {
                    timer.unref();
                }
            });
            let processes = await this.getChildProcessesByPID(pid);
            while (pid && processes.length === 1) {
                const childPID = (_b = processes[0]) === null || _b === void 0 ? void 0 : _b.pid;
                if (!childPID) {
                    break;
                }
                pid = childPID;
                processes = await this.getChildProcessesByPID(pid);
            }
            return pid;
        })();
        this.truePIDCache[id] = this.truePIDCache[id].catch(error => {
            delete this.truePIDCache[id];
            throw error;
        });
        return this.truePIDCache[id];
    }
    init(app) {
        electron_1.ipcMain.on('pty:spawn', (event, ...options) => {
            const id = (0, uuid_1.v4)().toString();
            event.returnValue = id;
            delete this.truePIDCache[id];
            this.ptys[id] = new PTY(id, app, ...options);
        });
        electron_1.ipcMain.on('pty:exists', (event, id) => {
            event.returnValue = !!this.ptys[id] && !this.ptys[id].exited;
        });
        electron_1.ipcMain.on('pty:get-pid', (event, id) => {
            var _a;
            event.returnValue = (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.getPID();
        });
        electron_1.ipcMain.on('pty:resize', (_event, id, columns, rows) => {
            var _a;
            (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.resize(columns, rows);
        });
        electron_1.ipcMain.on('pty:write', (_event, id, data) => {
            var _a;
            (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.write(Buffer.from(data));
        });
        electron_1.ipcMain.on('pty:kill', (_event, id, signal) => {
            var _a;
            (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.kill(signal);
        });
        electron_1.ipcMain.on('pty:ack-data', (_event, id, length) => {
            var _a;
            (_a = this.ptys[id]) === null || _a === void 0 ? void 0 : _a.ackData(length);
        });
        electron_1.ipcMain.handle('pty:get-true-pid', async (_event, id) => {
            return this.resolveTruePID(id);
        });
        electron_1.ipcMain.handle('pty:get-child-processes', async (_event, id) => {
            const truePID = await this.resolveTruePID(id);
            return this.getChildProcessesByPID(truePID);
        });
        electron_1.ipcMain.handle('pty:get-working-directory', async (_event, id) => {
            const truePID = await this.resolveTruePID(id);
            return (0, native_process_working_directory_1.getWorkingDirectoryFromPID)(truePID);
        });
    }
}
exports.PTYManager = PTYManager;
//# sourceMappingURL=pty.js.map