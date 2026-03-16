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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Application = void 0;
const electron_1 = require("electron");
const electron_promise_ipc_1 = __importDefault(require("electron-promise-ipc"));
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const module_1 = require("module");
const node_util_1 = require("node:util");
const rxjs_1 = require("rxjs");
const config_1 = require("./config");
const window_1 = require("./window");
const pluginManager_1 = require("./pluginManager");
const pty_1 = require("./pty");
/* eslint-disable block-scoped-var */
try {
    var wnr = require('windows-native-registry'); // eslint-disable-line @typescript-eslint/no-var-requires, no-var
    var windowsProcessTreeNative = require('@tabby-gang/windows-process-tree/build/Release/windows_process_tree.node'); // eslint-disable-line @typescript-eslint/no-var-requires, no-var
}
catch (_) { }
try {
    var keytar = require('keytar'); // eslint-disable-line @typescript-eslint/no-var-requires, no-var
}
catch (_) { }
const runtimeRequire = (0, module_1.createRequire)(__filename);
const exec = (0, node_util_1.promisify)(child_process_1.exec);
const execFile = (0, node_util_1.promisify)(child_process_1.execFile);
class Application {
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    constructor(configStore) {
        var _a, _b;
        this.configStore = configStore;
        this.ptyManager = new pty_1.PTYManager();
        this.windows = [];
        this.globalHotkey$ = new rxjs_1.Subject();
        this.bridgeSubprocesses = new Map();
        this.bridgeSubprocessOwners = new Map();
        this.bridgeFileTransfers = new Map();
        this.bridgeFileTransferOwners = new Map();
        this.quitRequested = false;
        this.shouldQuitWhenLastWindowCloses = process.platform !== 'darwin' || process.env.TABBY_DEV === '1';
        this.shellIntegrationWorkflows = ['Open Tabby here.workflow', 'Paste path into Tabby.workflow'];
        this.shellIntegrationRegistryKeys = [
            {
                path: 'Software\\Classes\\Directory\\Background\\shell\\Tabby',
                value: 'Open Tabby here',
                command: 'open "%V"',
            },
            {
                path: 'SOFTWARE\\Classes\\Directory\\shell\\Tabby',
                value: 'Open Tabby here',
                command: 'open "%V"',
            },
            {
                path: 'Software\\Classes\\*\\shell\\Tabby',
                value: 'Paste path into Tabby',
                command: 'paste "%V"',
            },
        ];
        this.bridgeLogWriteQueue = Promise.resolve();
        this.useBuiltinGraphics();
        this.ptyManager.init(this);
        this.setupRendererBridge();
        electron_1.ipcMain.handle('app:save-config', async (event, config) => {
            await (0, config_1.saveConfig)(config);
            this.broadcastExcept('host:config-change', event.sender, config);
        });
        electron_1.ipcMain.on('clipboard:read-text', event => {
            event.returnValue = electron_1.clipboard.readText();
        });
        electron_1.ipcMain.on('clipboard:write', (_event, content) => {
            var _a;
            electron_1.clipboard.write({
                text: (_a = content === null || content === void 0 ? void 0 : content.text) !== null && _a !== void 0 ? _a : '',
                html: content === null || content === void 0 ? void 0 : content.html,
            });
        });
        electron_1.ipcMain.on('app:register-global-hotkey', (_event, specs) => {
            electron_1.globalShortcut.unregisterAll();
            for (const spec of specs) {
                electron_1.globalShortcut.register(spec, () => this.globalHotkey$.next());
            }
        });
        this.globalHotkey$.pipe((0, rxjs_1.throttleTime)(100)).subscribe(() => {
            this.onGlobalHotkey();
        });
        electron_promise_ipc_1.default.on('plugin-manager:install', (name, version) => {
            return pluginManager_1.pluginManager.install(this.userPluginsPath, name, version);
        });
        electron_promise_ipc_1.default.on('plugin-manager:uninstall', (name) => {
            return pluginManager_1.pluginManager.uninstall(this.userPluginsPath, name);
        });
        electron_promise_ipc_1.default.on('get-default-mac-shell', async () => {
            try {
                const { stdout } = await exec(`/usr/bin/dscl . -read /Users/${process.env.LOGNAME} UserShell`);
                return stdout.toString().split(' ')[1].trim();
            }
            catch (_a) {
                return '/bin/bash';
            }
        });
        if (process.platform === 'linux') {
            electron_1.app.commandLine.appendSwitch('no-sandbox');
            electron_1.app.commandLine.appendSwitch('disable-dev-shm-usage');
            if ((((_a = this.configStore.appearance) === null || _a === void 0 ? void 0 : _a.opacity) || 1) !== 1) {
                electron_1.app.commandLine.appendSwitch('enable-transparent-visuals');
                // 不再自动禁用硬件加速，让透明背景也能使用 GPU 加速
                // 如果遇到透明背景渲染问题，可通过 hacks.disableGPU 手动禁用
                // app.disableHardwareAcceleration()
            }
        }
        if ((_b = this.configStore.hacks) === null || _b === void 0 ? void 0 : _b.disableGPU) {
            electron_1.app.commandLine.appendSwitch('disable-gpu');
            electron_1.app.disableHardwareAcceleration();
        }
        this.userPluginsPath = path.join(electron_1.app.getPath('userData'), 'plugins');
        if (!fs.existsSync(this.userPluginsPath)) {
            fs.mkdirSync(this.userPluginsPath);
        }
        electron_1.app.commandLine.appendSwitch('disable-http-cache');
        electron_1.app.commandLine.appendSwitch('max-active-webgl-contexts', '9000');
        electron_1.app.commandLine.appendSwitch('lang', 'EN');
        for (const flag of this.configStore.flags || [['force_discrete_gpu', '0']]) {
            electron_1.app.commandLine.appendSwitch(flag[0], flag[1]);
        }
        electron_1.app.on('before-quit', () => {
            this.quitRequested = true;
        });
        electron_1.app.on('window-all-closed', () => {
            if (this.quitRequested || this.shouldQuitWhenLastWindowCloses) {
                electron_1.app.quit();
            }
        });
    }
    init() {
        electron_1.screen.on('display-metrics-changed', () => this.broadcast('host:display-metrics-changed'));
        electron_1.screen.on('display-added', () => this.broadcast('host:displays-changed'));
        electron_1.screen.on('display-removed', () => this.broadcast('host:displays-changed'));
        electron_1.nativeTheme.on('updated', () => this.broadcast('bridge:native-theme-updated', this.getNativeThemeState()));
    }
    async newWindow(options) {
        const window = new window_1.Window(this, this.configStore, options);
        this.windows.push(window);
        if (this.windows.length === 1) {
            window.makeMain();
        }
        window.visible$.subscribe(visible => {
            if (visible) {
                this.disableTray();
            }
            else {
                this.enableTray();
            }
        });
        window.closed$.subscribe(() => {
            var _a, _b;
            this.windows = this.windows.filter(x => x !== window);
            if (!this.windows.some(x => x.isMainWindow)) {
                (_a = this.windows[0]) === null || _a === void 0 ? void 0 : _a.makeMain();
                (_b = this.windows[0]) === null || _b === void 0 ? void 0 : _b.present();
            }
        });
        if (process.platform === 'darwin') {
            this.setupMenu();
        }
        await window.ready;
        return window;
    }
    onGlobalHotkey() {
        let isPresent = this.windows.some(x => x.isFocused() && x.isVisible());
        const isDockedOnTop = this.windows.some(x => x.isDockedOnTop());
        if (isDockedOnTop) {
            // if docked and on top, hide even if not focused right now
            isPresent = this.windows.some(x => x.isVisible());
        }
        if (isPresent) {
            for (const window of this.windows) {
                window.hide();
            }
        }
        else {
            for (const window of this.windows) {
                window.present();
            }
        }
    }
    presentAllWindows() {
        for (const window of this.windows) {
            window.present();
        }
    }
    broadcast(event, ...args) {
        for (const window of this.windows) {
            window.send(event, ...args);
        }
    }
    broadcastExcept(event, except, ...args) {
        for (const window of this.windows) {
            if (window.webContents.id !== except.id) {
                window.send(event, ...args);
            }
        }
    }
    async send(event, ...args) {
        if (!this.hasWindows()) {
            await this.newWindow();
        }
        this.windows.filter(w => !w.isDestroyed())[0].send(event, ...args);
    }
    enableTray() {
        var _a;
        if (!!this.tray || process.platform === 'linux' || ((_a = this.configStore.hideTray) !== null && _a !== void 0 ? _a : false) === true) {
            return;
        }
        if (process.platform === 'darwin') {
            this.tray = new electron_1.Tray(`${electron_1.app.getAppPath()}/assets/tray-darwinTemplate.png`);
            this.tray.setPressedImage(`${electron_1.app.getAppPath()}/assets/tray-darwinHighlightTemplate.png`);
        }
        else {
            this.tray = new electron_1.Tray(`${electron_1.app.getAppPath()}/assets/tray.png`);
        }
        this.tray.on('click', () => {
            const timer = setTimeout(() => this.focus());
            if (typeof timer === 'object' && typeof timer.unref === 'function') {
                timer.unref();
            }
        });
        const contextMenu = electron_1.Menu.buildFromTemplate([{
                label: 'Show',
                click: () => this.focus(),
            }]);
        if (process.platform !== 'darwin') {
            this.tray.setContextMenu(contextMenu);
        }
        this.tray.setToolTip(`Tabby ${electron_1.app.getVersion()}`);
    }
    disableTray() {
        var _a;
        if (process.platform === 'linux') {
            return;
        }
        (_a = this.tray) === null || _a === void 0 ? void 0 : _a.destroy();
        this.tray = null;
    }
    hasWindows() {
        return !!this.windows.length;
    }
    focus() {
        for (const window of this.windows) {
            window.present();
        }
    }
    async handleSecondInstance(argv, cwd) {
        if (!this.windows.length) {
            await this.newWindow();
        }
        this.presentAllWindows();
        this.windows[this.windows.length - 1].passCliArguments(argv, cwd, true);
    }
    useBuiltinGraphics() {
        if (process.platform === 'win32') {
            const keyPath = 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences';
            const valueName = electron_1.app.getPath('exe');
            if (!wnr.getRegistryValue(wnr.HK.CU, keyPath, valueName)) {
                wnr.setRegistryValue(wnr.HK.CU, keyPath, valueName, wnr.REG.SZ, 'GpuPreference=1;');
            }
        }
    }
    setupRendererBridge() {
        electron_1.ipcMain.on('bridge:app:get-path', (event, name) => {
            event.returnValue = electron_1.app.getPath(name);
        });
        electron_1.ipcMain.on('bridge:app:get-version', event => {
            event.returnValue = electron_1.app.getVersion();
        });
        electron_1.ipcMain.on('bridge:app:get-app-path', event => {
            event.returnValue = electron_1.app.getAppPath();
        });
        electron_1.ipcMain.on('bridge:app:relaunch', (_event, options) => {
            electron_1.app.relaunch(options);
        });
        electron_1.ipcMain.on('bridge:app:exit', (_event, code = 0) => {
            electron_1.app.exit(code);
        });
        electron_1.ipcMain.on('bridge:app:quit', () => {
            electron_1.app.quit();
        });
        electron_1.ipcMain.on('bridge:app:set-jump-list', (event, categories) => {
            event.returnValue = process.platform === 'win32' ? electron_1.app.setJumpList(categories) : undefined;
        });
        electron_1.ipcMain.on('bridge:app:set-dock-menu', (event, template) => {
            var _a;
            if (process.platform !== 'darwin') {
                return;
            }
            const menu = electron_1.Menu.buildFromTemplate(this.buildBridgeMenuTemplate(template, event.sender));
            (_a = electron_1.app.dock) === null || _a === void 0 ? void 0 : _a.setMenu(menu);
        });
        electron_1.ipcMain.handle('bridge:dialog:show-open', async (event, options) => {
            const window = electron_1.BrowserWindow.fromWebContents(event.sender);
            if (window) {
                return electron_1.dialog.showOpenDialog(window, options);
            }
            return electron_1.dialog.showOpenDialog(options);
        });
        electron_1.ipcMain.handle('bridge:dialog:show-save', async (event, options) => {
            const window = electron_1.BrowserWindow.fromWebContents(event.sender);
            if (window) {
                return electron_1.dialog.showSaveDialog(window, options);
            }
            return electron_1.dialog.showSaveDialog(options);
        });
        electron_1.ipcMain.handle('bridge:dialog:show-message-box', async (event, options) => {
            const window = electron_1.BrowserWindow.fromWebContents(event.sender);
            if (window) {
                return electron_1.dialog.showMessageBox(window, options);
            }
            return electron_1.dialog.showMessageBox(options);
        });
        electron_1.ipcMain.handle('bridge:file-provider:read-file', async (_event, filePath) => {
            const content = await fs.promises.readFile(filePath);
            return content.toString('base64');
        });
        electron_1.ipcMain.on('bridge:log:write', (_event, entry) => {
            this.enqueueBridgeLogWrite(entry);
        });
        electron_1.ipcMain.handle('bridge:plugin-manager:install', async (_event, name, version) => {
            return pluginManager_1.pluginManager.install(this.userPluginsPath, name, version);
        });
        electron_1.ipcMain.handle('bridge:plugin-manager:uninstall', async (_event, name) => {
            return pluginManager_1.pluginManager.uninstall(this.userPluginsPath, name);
        });
        electron_1.ipcMain.handle('bridge:keytar:get-password', async (_event, service, account) => {
            if (!keytar) {
                throw new Error('keytar is unavailable');
            }
            return keytar.getPassword(service, account);
        });
        electron_1.ipcMain.handle('bridge:keytar:set-password', async (_event, service, account, password) => {
            if (!keytar) {
                throw new Error('keytar is unavailable');
            }
            await keytar.setPassword(service, account, password);
        });
        electron_1.ipcMain.handle('bridge:keytar:delete-password', async (_event, service, account) => {
            if (!keytar) {
                throw new Error('keytar is unavailable');
            }
            return keytar.deletePassword(service, account);
        });
        electron_1.ipcMain.handle('bridge:fs:exists', async (_event, filePath) => {
            try {
                await fs.promises.access(filePath);
                return true;
            }
            catch (_a) {
                return false;
            }
        });
        electron_1.ipcMain.on('bridge:fs:exists-sync', (event, filePath) => {
            try {
                fs.accessSync(filePath);
                event.returnValue = true;
            }
            catch (_a) {
                event.returnValue = false;
            }
        });
        electron_1.ipcMain.handle('bridge:fs:stat', async (_event, filePath) => {
            try {
                const stats = await fs.promises.lstat(filePath);
                return {
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    size: stats.size,
                    mode: stats.mode,
                    mtimeMs: stats.mtimeMs,
                };
            }
            catch (_a) {
                return null;
            }
        });
        electron_1.ipcMain.on('bridge:fs:stat-sync', (event, filePath) => {
            try {
                const stats = fs.lstatSync(filePath);
                event.returnValue = {
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    size: stats.size,
                    mode: stats.mode,
                    mtimeMs: stats.mtimeMs,
                };
            }
            catch (_a) {
                event.returnValue = null;
            }
        });
        electron_1.ipcMain.handle('bridge:fs:read-file-text', async (_event, filePath) => {
            return fs.promises.readFile(filePath, 'utf8');
        });
        electron_1.ipcMain.on('bridge:fs:read-file-text-sync', (event, filePath) => {
            event.returnValue = fs.readFileSync(filePath, 'utf8');
        });
        electron_1.ipcMain.handle('bridge:fs:write-file-text', async (_event, filePath, content) => {
            await fs.promises.writeFile(filePath, content, 'utf8');
        });
        electron_1.ipcMain.on('bridge:fs:write-file-text-sync', (event, filePath, content) => {
            fs.writeFileSync(filePath, content, 'utf8');
            event.returnValue = true;
        });
        electron_1.ipcMain.handle('bridge:fs:read-file-base64', async (_event, filePath) => {
            const content = await fs.promises.readFile(filePath);
            return content.toString('base64');
        });
        electron_1.ipcMain.handle('bridge:fs:write-file-base64', async (_event, filePath, content) => {
            const data = new Uint8Array(Buffer.from(content, 'base64'));
            await fs.promises.writeFile(filePath, data);
        });
        electron_1.ipcMain.handle('bridge:fs:read-dir', async (_event, filePath) => {
            const entries = await fs.promises.readdir(filePath, { withFileTypes: true });
            return entries.map(entry => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink(),
            }));
        });
        electron_1.ipcMain.on('bridge:fs:read-dir-sync', (event, filePath) => {
            const entries = fs.readdirSync(filePath, { withFileTypes: true });
            event.returnValue = entries.map(entry => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink(),
            }));
        });
        electron_1.ipcMain.on('bridge:fs:mkdir-sync', (event, filePath, recursive = false) => {
            fs.mkdirSync(filePath, { recursive });
            event.returnValue = true;
        });
        electron_1.ipcMain.on('bridge:fs:unlink-sync', (event, filePath) => {
            fs.unlinkSync(filePath);
            event.returnValue = true;
        });
        electron_1.ipcMain.handle('bridge:fs:realpath', async (_event, filePath) => {
            try {
                return await fs.promises.realpath(filePath);
            }
            catch (_a) {
                return null;
            }
        });
        electron_1.ipcMain.handle('bridge:fs:chmod', async (_event, filePath, mode) => {
            await fs.promises.chmod(filePath, mode);
        });
        electron_1.ipcMain.handle('bridge:fs:list-local-directory', async (_event, directory) => {
            const items = await fs.promises.readdir(directory, { withFileTypes: true });
            return Promise.all(items.map(async (item) => {
                const fullPath = path.join(directory, item.name);
                const linkStats = await fs.promises.lstat(fullPath);
                let fileStats = linkStats;
                let isDirectory = item.isDirectory();
                if (item.isSymbolicLink()) {
                    try {
                        fileStats = await fs.promises.stat(fullPath);
                        isDirectory = fileStats.isDirectory();
                    }
                    catch (_a) {
                        // Broken symbolic links are displayed but treated as files.
                    }
                }
                return {
                    name: item.name,
                    fullPath,
                    isDirectory,
                    isSymlink: item.isSymbolicLink(),
                    size: fileStats.size,
                    modified: fileStats.mtimeMs,
                    mode: fileStats.mode,
                };
            }));
        });
        electron_1.ipcMain.handle('bridge:file-transfer:open-upload', async (event, filePath) => {
            const stat = await fs.promises.stat(filePath);
            const file = await fs.promises.open(filePath, 'r');
            const id = this.createBridgeFileTransferID();
            this.registerBridgeFileTransfer(event.sender, id, {
                file,
                position: 0,
                mode: 'read',
                sender: event.sender,
            });
            return {
                id,
                size: stat.size,
                mode: stat.mode,
            };
        });
        electron_1.ipcMain.handle('bridge:file-transfer:read-upload', async (event, id, bytes) => {
            const transfer = this.getOwnedBridgeFileTransfer(event.sender, id);
            if (!transfer || transfer.mode !== 'read') {
                throw new Error(`Unknown upload transfer: ${id}`);
            }
            const buffer = new Uint8Array(bytes);
            const result = await transfer.file.read(buffer, 0, bytes, transfer.position);
            transfer.position += result.bytesRead;
            return Buffer.from(buffer.subarray(0, result.bytesRead)).toString('base64');
        });
        electron_1.ipcMain.handle('bridge:file-transfer:open-download', async (event, filePath, mode) => {
            const file = await fs.promises.open(filePath, 'w', mode);
            const id = this.createBridgeFileTransferID();
            this.registerBridgeFileTransfer(event.sender, id, {
                file,
                position: 0,
                mode: 'write',
                sender: event.sender,
            });
            return id;
        });
        electron_1.ipcMain.handle('bridge:file-transfer:write-download', async (event, id, base64) => {
            const transfer = this.getOwnedBridgeFileTransfer(event.sender, id);
            if (!transfer || transfer.mode !== 'write') {
                throw new Error(`Unknown download transfer: ${id}`);
            }
            const buffer = Uint8Array.from(Buffer.from(base64, 'base64'));
            let bytesWritten = 0;
            while (bytesWritten < buffer.length) {
                const result = await transfer.file.write(buffer, bytesWritten, buffer.length - bytesWritten, transfer.position + bytesWritten);
                bytesWritten += result.bytesWritten;
            }
            transfer.position += bytesWritten;
            return bytesWritten;
        });
        electron_1.ipcMain.handle('bridge:file-transfer:create-directory', async (_event, directoryPath) => {
            await fs.promises.mkdir(directoryPath, { recursive: true });
        });
        electron_1.ipcMain.handle('bridge:file-transfer:close', async (event, id) => {
            await this.closeOwnedBridgeFileTransfer(event.sender, id);
        });
        electron_1.ipcMain.on('bridge:screen:get-all-displays', event => {
            event.returnValue = electron_1.screen.getAllDisplays();
        });
        electron_1.ipcMain.on('bridge:screen:get-primary-display', event => {
            event.returnValue = electron_1.screen.getPrimaryDisplay();
        });
        electron_1.ipcMain.on('bridge:screen:get-cursor-screen-point', event => {
            event.returnValue = electron_1.screen.getCursorScreenPoint();
        });
        electron_1.ipcMain.on('bridge:screen:get-display-nearest-point', (event, point) => {
            event.returnValue = electron_1.screen.getDisplayNearestPoint(point);
        });
        electron_1.ipcMain.on('bridge:native-theme:get-state', event => {
            event.returnValue = this.getNativeThemeState();
        });
        electron_1.ipcMain.on('bridge:power-save-blocker:start', (event, type) => {
            event.returnValue = electron_1.powerSaveBlocker.start(type);
        });
        electron_1.ipcMain.on('bridge:power-save-blocker:stop', (_event, id) => {
            electron_1.powerSaveBlocker.stop(id);
        });
        electron_1.ipcMain.on('bridge:menu:popup', (event, menuID, template) => {
            var _a;
            const menu = electron_1.Menu.buildFromTemplate(this.buildBridgeMenuTemplate(template, event.sender));
            const window = (_a = electron_1.BrowserWindow.fromWebContents(event.sender)) !== null && _a !== void 0 ? _a : undefined;
            menu.popup({
                window,
                callback: () => {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('bridge:menu-dismissed', menuID);
                    }
                },
            });
        });
        electron_1.ipcMain.handle('bridge:subprocess:spawn', async (event, options) => {
            return this.createBridgeSubprocess(event.sender, options);
        });
        electron_1.ipcMain.on('bridge:subprocess:write', (event, id, data) => {
            var _a;
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id);
            if ((_a = subprocess === null || subprocess === void 0 ? void 0 : subprocess.child.stdin) === null || _a === void 0 ? void 0 : _a.writable) {
                subprocess.child.stdin.write(data);
            }
        });
        electron_1.ipcMain.on('bridge:subprocess:stdin-end', (event, id) => {
            var _a;
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id);
            (_a = subprocess === null || subprocess === void 0 ? void 0 : subprocess.child.stdin) === null || _a === void 0 ? void 0 : _a.end();
        });
        electron_1.ipcMain.on('bridge:subprocess:kill', (event, id, signal) => {
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id);
            subprocess === null || subprocess === void 0 ? void 0 : subprocess.child.kill(signal);
        });
        electron_1.ipcMain.on('bridge:platform:get-os-release', event => {
            event.returnValue = os.release();
        });
        electron_1.ipcMain.on('bridge:platform:get-home-dir', event => {
            event.returnValue = os.homedir();
        });
        electron_1.ipcMain.on('bridge:platform:get-winscp-path', event => {
            var _a;
            if (process.platform !== 'win32' || !wnr) {
                event.returnValue = null;
                return;
            }
            const key = wnr.getRegistryKey(wnr.HK.CR, 'WinSCP.Url\\DefaultIcon');
            if (!(key === null || key === void 0 ? void 0 : key[''])) {
                event.returnValue = null;
                return;
            }
            let detectedPath = (_a = key[''].value) === null || _a === void 0 ? void 0 : _a.split(',')[0];
            detectedPath = detectedPath === null || detectedPath === void 0 ? void 0 : detectedPath.substring(1, detectedPath.length - 1);
            event.returnValue = detectedPath !== null && detectedPath !== void 0 ? detectedPath : null;
        });
        electron_1.ipcMain.handle('bridge:platform:is-process-running', async (_event, name) => {
            if (process.platform !== 'win32' || !windowsProcessTreeNative) {
                throw new Error('Not supported');
            }
            return new Promise(resolve => {
                windowsProcessTreeNative.getProcessList((list) => {
                    resolve(list.some((x) => x.name === name));
                }, 0);
            });
        });
        electron_1.ipcMain.handle('bridge:platform:list-fonts', async () => {
            if (process.platform === 'win32' || process.platform === 'darwin') {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const fontManager = require('fontmanager-redux');
                let fonts = await new Promise(resolve => fontManager.getAvailableFonts(resolve));
                fonts = fonts.map(x => x.family.trim());
                return fonts;
            }
            if (process.platform === 'linux') {
                const { stdout } = await execFile('fc-list', [':spacing=mono']);
                const fonts = stdout.toString()
                    .split('\n')
                    .filter(x => !!x)
                    .map(x => x.split(':')[1].trim())
                    .map(x => x.split(',')[0].trim());
                fonts.sort();
                return fonts;
            }
            return [];
        });
        electron_1.ipcMain.handle('bridge:platform:list-hyper-color-schemes', async () => {
            return this.listHyperColorSchemes();
        });
        electron_1.ipcMain.handle('bridge:platform:exec-file', async (_event, executable, argv) => {
            await execFile(executable, argv);
        });
        electron_1.ipcMain.handle('bridge:shell-integration:is-installed', async () => {
            return this.isShellIntegrationInstalled();
        });
        electron_1.ipcMain.handle('bridge:shell-integration:install', async () => {
            await this.installShellIntegration();
        });
        electron_1.ipcMain.handle('bridge:shell-integration:remove', async () => {
            await this.removeShellIntegration();
        });
    }
    enqueueBridgeLogWrite(entry) {
        this.bridgeLogWriteQueue = this.bridgeLogWriteQueue
            .then(() => this.writeBridgeLogEntry(entry))
            .catch(error => {
            console.warn('Failed to write bridge log entry', error);
        });
    }
    async writeBridgeLogEntry(entry) {
        const logDirectory = electron_1.app.getPath('userData');
        const logPath = path.join(logDirectory, 'log.txt');
        await fs.promises.mkdir(logDirectory, { recursive: true });
        const normalizedLevel = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info';
        const normalizedName = (entry.name || 'renderer').replace(/\r?\n/g, ' ');
        const normalizedMessage = (entry.message || '').replace(/\r?\n/g, '\\n');
        const line = `${new Date().toISOString()} ${normalizedLevel}: [${normalizedName}] ${normalizedMessage}\n`;
        await this.rotateBridgeLogsIfNeeded(logPath, Buffer.byteLength(line));
        await fs.promises.appendFile(logPath, line, 'utf8');
    }
    async rotateBridgeLogsIfNeeded(logPath, incomingBytes) {
        const maxSize = 5 * 1024 * 1024;
        const maxFiles = 5;
        try {
            const stat = await fs.promises.stat(logPath);
            if (stat.size + incomingBytes <= maxSize) {
                return;
            }
        }
        catch (_a) {
            return;
        }
        const archiveCount = Math.max(maxFiles - 1, 0);
        if (archiveCount === 0) {
            await fs.promises.rm(logPath, { force: true });
            return;
        }
        await fs.promises.rm(`${logPath}.${archiveCount}`, { force: true });
        for (let index = archiveCount; index >= 1; index -= 1) {
            const source = index === 1 ? logPath : `${logPath}.${index - 1}`;
            const destination = `${logPath}.${index}`;
            try {
                await fs.promises.rm(destination, { force: true });
                await fs.promises.rename(source, destination);
            }
            catch (_b) {
                // Ignore missing archives during rotation.
            }
        }
    }
    async listHyperColorSchemes() {
        const pluginsPath = path.join(os.homedir(), '.hyper_plugins', 'node_modules');
        if (!fs.existsSync(pluginsPath)) {
            return [];
        }
        const plugins = await fs.promises.readdir(pluginsPath);
        const themes = [];
        for (const plugin of plugins) {
            try {
                const hyperPlugin = runtimeRequire(path.join(pluginsPath, plugin));
                if (!hyperPlugin.decorateConfig) {
                    continue;
                }
                let config = {};
                try {
                    config = hyperPlugin.decorateConfig({});
                }
                catch (_a) {
                    console.warn('Could not load Hyper theme:', plugin);
                    continue;
                }
                if (!config.colors) {
                    continue;
                }
                themes.push({
                    name: plugin,
                    foreground: config.foregroundColor,
                    background: config.backgroundColor,
                    cursor: config.cursorColor,
                    colors: config.colors.black ? [
                        config.colors.black,
                        config.colors.red,
                        config.colors.green,
                        config.colors.yellow,
                        config.colors.blue,
                        config.colors.magenta,
                        config.colors.cyan,
                        config.colors.white,
                        config.colors.lightBlack,
                        config.colors.lightRed,
                        config.colors.lightGreen,
                        config.colors.lightYellow,
                        config.colors.lightBlue,
                        config.colors.lightMagenta,
                        config.colors.lightCyan,
                        config.colors.lightWhite,
                    ] : config.colors,
                });
            }
            catch (error) {
                console.debug('Skipping Hyper plugin', plugin, error);
            }
        }
        return themes;
    }
    getAutomatorWorkflowsLocation() {
        return path.join(path.dirname(path.dirname(electron_1.app.getPath('exe'))), 'Resources', 'extras', 'automator-workflows');
    }
    getAutomatorWorkflowsDestination() {
        return path.join(os.homedir(), 'Library', 'Services');
    }
    getShellIntegrationExecutable() {
        var _a;
        return (_a = process.env.PORTABLE_EXECUTABLE_FILE) !== null && _a !== void 0 ? _a : electron_1.app.getPath('exe');
    }
    async isShellIntegrationInstalled() {
        if (process.platform === 'darwin') {
            const destination = this.getAutomatorWorkflowsDestination();
            return fs.existsSync(path.join(destination, this.shellIntegrationWorkflows[0]));
        }
        if (process.platform === 'win32') {
            if (!wnr) {
                throw new Error('windows-native-registry is unavailable');
            }
            return !!wnr.getRegistryKey(wnr.HK.CU, this.shellIntegrationRegistryKeys[0].path);
        }
        return true;
    }
    async installShellIntegration() {
        const exe = this.getShellIntegrationExecutable();
        if (process.platform === 'darwin') {
            const sourceRoot = this.getAutomatorWorkflowsLocation();
            const destinationRoot = this.getAutomatorWorkflowsDestination();
            await fs.promises.mkdir(destinationRoot, { recursive: true });
            for (const workflow of this.shellIntegrationWorkflows) {
                await fs.promises.cp(path.join(sourceRoot, workflow), path.join(destinationRoot, workflow), {
                    recursive: true,
                    force: true,
                });
            }
            return;
        }
        if (process.platform !== 'win32') {
            return;
        }
        if (!wnr) {
            throw new Error('windows-native-registry is unavailable');
        }
        for (const registryKey of this.shellIntegrationRegistryKeys) {
            wnr.createRegistryKey(wnr.HK.CU, registryKey.path);
            wnr.createRegistryKey(wnr.HK.CU, registryKey.path + '\\command');
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path, '', wnr.REG.SZ, registryKey.value);
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path, 'Icon', wnr.REG.SZ, exe);
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path + '\\command', '', wnr.REG.SZ, exe + ' ' + registryKey.command);
        }
        if (wnr.getRegistryKey(wnr.HK.CU, 'Software\\Classes\\Directory\\Background\\shell\\Open Tabby here')) {
            wnr.deleteRegistryKey(wnr.HK.CU, 'Software\\Classes\\Directory\\Background\\shell\\Open Tabby here');
        }
        if (wnr.getRegistryKey(wnr.HK.CU, 'Software\\Classes\\*\\shell\\Paste path into Tabby')) {
            wnr.deleteRegistryKey(wnr.HK.CU, 'Software\\Classes\\*\\shell\\Paste path into Tabby');
        }
    }
    async removeShellIntegration() {
        if (process.platform === 'darwin') {
            const destinationRoot = this.getAutomatorWorkflowsDestination();
            for (const workflow of this.shellIntegrationWorkflows) {
                await fs.promises.rm(path.join(destinationRoot, workflow), {
                    recursive: true,
                    force: true,
                });
            }
            return;
        }
        if (process.platform !== 'win32') {
            return;
        }
        if (!wnr) {
            throw new Error('windows-native-registry is unavailable');
        }
        for (const registryKey of this.shellIntegrationRegistryKeys) {
            wnr.deleteRegistryKey(wnr.HK.CU, registryKey.path);
        }
    }
    createBridgeFileTransferID() {
        return `transfer:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
    }
    registerBridgeFileTransfer(sender, id, state) {
        var _a;
        this.bridgeFileTransfers.set(id, state);
        this.ensureBridgeFileTransferOwner(sender);
        (_a = this.bridgeFileTransferOwners.get(sender.id)) === null || _a === void 0 ? void 0 : _a.add(id);
    }
    ensureBridgeFileTransferOwner(sender) {
        if (this.bridgeFileTransferOwners.has(sender.id)) {
            return;
        }
        this.bridgeFileTransferOwners.set(sender.id, new Set());
        sender.once('destroyed', () => {
            this.cleanupBridgeFileTransferOwner(sender.id);
        });
    }
    getOwnedBridgeFileTransfer(sender, id) {
        var _a;
        if (!((_a = this.bridgeFileTransferOwners.get(sender.id)) === null || _a === void 0 ? void 0 : _a.has(id))) {
            return undefined;
        }
        return this.bridgeFileTransfers.get(id);
    }
    async closeOwnedBridgeFileTransfer(sender, id) {
        var _a;
        if (!((_a = this.bridgeFileTransferOwners.get(sender.id)) === null || _a === void 0 ? void 0 : _a.has(id))) {
            return;
        }
        await this.closeBridgeFileTransfer(id);
    }
    async closeBridgeFileTransfer(id) {
        var _a;
        const transfer = this.bridgeFileTransfers.get(id);
        if (!transfer) {
            return;
        }
        this.bridgeFileTransfers.delete(id);
        (_a = this.bridgeFileTransferOwners.get(transfer.sender.id)) === null || _a === void 0 ? void 0 : _a.delete(id);
        try {
            await transfer.file.close();
        }
        catch (_b) {
            // Ignore already-closed descriptors.
        }
    }
    cleanupBridgeFileTransferOwner(ownerID) {
        var _a;
        const ids = Array.from((_a = this.bridgeFileTransferOwners.get(ownerID)) !== null && _a !== void 0 ? _a : []);
        this.bridgeFileTransferOwners.delete(ownerID);
        for (const id of ids) {
            void this.closeBridgeFileTransfer(id);
        }
    }
    ensureBridgeSubprocessOwner(sender) {
        if (this.bridgeSubprocessOwners.has(sender.id)) {
            return;
        }
        this.bridgeSubprocessOwners.set(sender.id, new Set());
        sender.once('destroyed', () => {
            this.cleanupBridgeSubprocessOwner(sender.id);
        });
    }
    async createBridgeSubprocess(sender, options) {
        this.ensureBridgeSubprocessOwner(sender);
        return new Promise((resolve, reject) => {
            var _a;
            const id = `bridge-subprocess:${Date.now()}:${Math.random().toString(36).slice(2)}`;
            const child = (0, child_process_1.spawn)(options.command, (_a = options.args) !== null && _a !== void 0 ? _a : [], {
                cwd: options.cwd,
                env: options.env,
                shell: options.shell,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const onSpawn = () => {
                var _a, _b, _c, _d, _e;
                child.off('error', onStartupError);
                (_a = child.stdout) === null || _a === void 0 ? void 0 : _a.setEncoding('utf8');
                (_b = child.stderr) === null || _b === void 0 ? void 0 : _b.setEncoding('utf8');
                this.bridgeSubprocesses.set(id, { child, sender });
                (_c = this.bridgeSubprocessOwners.get(sender.id)) === null || _c === void 0 ? void 0 : _c.add(id);
                (_d = child.stdout) === null || _d === void 0 ? void 0 : _d.on('data', data => {
                    this.sendBridgeSubprocessEvent(sender, id, 'stdout', data);
                });
                (_e = child.stderr) === null || _e === void 0 ? void 0 : _e.on('data', data => {
                    this.sendBridgeSubprocessEvent(sender, id, 'stderr', data);
                });
                child.on('error', error => {
                    this.sendBridgeSubprocessEvent(sender, id, 'error', this.serializeBridgeError(error));
                });
                child.on('close', (code, signal) => {
                    this.sendBridgeSubprocessEvent(sender, id, 'close', code, signal);
                    this.unregisterBridgeSubprocess(id);
                });
                resolve(id);
            };
            const onStartupError = (error) => {
                child.off('spawn', onSpawn);
                reject(error);
            };
            child.once('spawn', onSpawn);
            child.once('error', onStartupError);
        });
    }
    getOwnedBridgeSubprocess(sender, id) {
        const subprocess = this.bridgeSubprocesses.get(id);
        if (!subprocess || subprocess.sender.id !== sender.id) {
            return undefined;
        }
        return subprocess;
    }
    unregisterBridgeSubprocess(id) {
        const subprocess = this.bridgeSubprocesses.get(id);
        if (!subprocess) {
            return;
        }
        this.bridgeSubprocesses.delete(id);
        const ownerProcesses = this.bridgeSubprocessOwners.get(subprocess.sender.id);
        ownerProcesses === null || ownerProcesses === void 0 ? void 0 : ownerProcesses.delete(id);
        if ((ownerProcesses === null || ownerProcesses === void 0 ? void 0 : ownerProcesses.size) === 0) {
            this.bridgeSubprocessOwners.delete(subprocess.sender.id);
        }
    }
    cleanupBridgeSubprocessOwner(senderID) {
        const processIDs = this.bridgeSubprocessOwners.get(senderID);
        if (!processIDs) {
            return;
        }
        for (const id of processIDs) {
            const subprocess = this.bridgeSubprocesses.get(id);
            if (!subprocess) {
                continue;
            }
            subprocess.child.kill();
            this.bridgeSubprocesses.delete(id);
        }
        this.bridgeSubprocessOwners.delete(senderID);
    }
    sendBridgeSubprocessEvent(sender, id, event, ...args) {
        if (sender.isDestroyed()) {
            return;
        }
        sender.send(`bridge:subprocess:${id}:${event}`, ...args);
    }
    serializeBridgeError(error) {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        };
    }
    buildBridgeMenuTemplate(template, sender) {
        return template.map(item => ({
            accelerator: item.accelerator,
            checked: item.checked,
            enabled: item.enabled,
            label: item.label,
            role: item.role,
            type: item.type,
            click: item.commandID ? () => {
                if (!sender.isDestroyed()) {
                    sender.send('bridge:menu-click', item.commandID);
                }
            } : undefined,
            submenu: item.submenu ? this.buildBridgeMenuTemplate(item.submenu, sender) : undefined,
        }));
    }
    getNativeThemeState() {
        return {
            shouldUseDarkColors: electron_1.nativeTheme.shouldUseDarkColors,
        };
    }
    setupMenu() {
        const template = [
            {
                label: 'Application',
                submenu: [
                    { role: 'about', label: 'About Tabby' },
                    { type: 'separator' },
                    {
                        label: 'Preferences',
                        accelerator: 'Cmd+,',
                        click: async () => {
                            if (!this.hasWindows()) {
                                await this.newWindow();
                            }
                            this.windows[0].send('host:preferences-menu');
                        },
                    },
                    { type: 'separator' },
                    { role: 'services', submenu: [] },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    {
                        label: 'Quit',
                        accelerator: 'Cmd+Q',
                        click: () => {
                            this.quitRequested = true;
                            electron_1.app.quit();
                        },
                    },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'View',
                submenu: [
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' },
                ],
            },
            {
                role: 'window',
                submenu: [
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { type: 'separator' },
                    { role: 'front' },
                ],
            },
            {
                role: 'help',
                submenu: [
                    {
                        label: 'Website',
                        click() {
                            electron_1.shell.openExternal('https://eugeny.github.io/tabby');
                        },
                    },
                ],
            },
        ];
        if (process.env.TABBY_DEV) {
            const viewMenu = template[2];
            if (Array.isArray(viewMenu.submenu)) {
                viewMenu.submenu.unshift({ role: 'reload' });
            }
        }
        electron_1.Menu.setApplicationMenu(electron_1.Menu.buildFromTemplate(template));
    }
}
exports.Application = Application;
//# sourceMappingURL=app.js.map