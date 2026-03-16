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
exports.Window = void 0;
const glasstron = __importStar(require("glasstron"));
const electron_updater_1 = require("electron-updater");
const rxjs_1 = require("rxjs");
const electron_1 = require("electron");
const electron_config_1 = __importDefault(require("electron-config"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const macos_release_1 = __importDefault(require("macos-release"));
const compare_versions_1 = require("compare-versions");
const cli_1 = require("./cli");
const urlHandler_1 = require("./urlHandler");
let DwmEnableBlurBehindWindow = null;
if (process.platform === 'win32') {
    DwmEnableBlurBehindWindow = require('@tabby-gang/windows-blurbehind').DwmEnableBlurBehindWindow;
}
const macOSVibrancyType = process.platform === 'darwin' ? (0, compare_versions_1.compare)((0, macos_release_1.default)().version || '0.0', '10.14', '>=') ? 'fullscreen-ui' : 'dark' : null;
const activityIcon = electron_1.nativeImage.createFromPath(`${electron_1.app.getAppPath()}/assets/activity.png`);
class Window {
    get visible$() { return this.visible; }
    get closed$() { return this.closed; }
    openDevTools() {
        var _a;
        if (!((_a = this.window) === null || _a === void 0 ? void 0 : _a.isDestroyed()) && !this.webContents.isDevToolsOpened()) {
            this.webContents.openDevTools({ mode: 'detach' });
        }
    }
    toggleDevTools() {
        var _a;
        if ((_a = this.window) === null || _a === void 0 ? void 0 : _a.isDestroyed()) {
            return;
        }
        if (this.webContents.isDevToolsOpened()) {
            this.webContents.closeDevTools();
        }
        else {
            this.openDevTools();
        }
    }
    isDevToolsShortcut(input) {
        var _a, _b;
        const key = (_a = input.key) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const code = (_b = input.code) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        return key === 'f12'
            || code === 'f12'
            || !!((input.control || input.meta) && input.shift && (key === 'i' || code === 'keyi'));
    }
    isReloadShortcut(input) {
        var _a, _b;
        const key = (_a = input.key) === null || _a === void 0 ? void 0 : _a.toLowerCase();
        const code = (_b = input.code) === null || _b === void 0 ? void 0 : _b.toLowerCase();
        return key === 'f5'
            || code === 'f5'
            || !!((input.control || input.meta) && !input.shift && (key === 'r' || code === 'keyr'));
    }
    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    constructor(application, configStore, options) {
        var _a;
        this.application = application;
        this.configStore = configStore;
        this.isMainWindow = false;
        this.visible = new rxjs_1.Subject();
        this.closed = new rxjs_1.Subject();
        this.closing = false;
        this.lastVibrancy = null;
        this.disableVibrancyWhileDragging = false;
        this.isFluentVibrancy = false;
        this.dockHidden = false;
        this.pendingTimeouts = new Set();
        options = options !== null && options !== void 0 ? options : {};
        const useNativeBrowserWindow = this.shouldUseNativeBrowserWindow();
        this.windowConfig = new electron_config_1.default({ name: 'window' });
        this.windowBounds = this.windowConfig.get('windowBoundaries');
        const maximized = this.windowConfig.get('maximized');
        const bwOptions = {
            width: 800,
            height: 600,
            title: 'Tabby',
            minWidth: 400,
            minHeight: 300,
            webPreferences: {
                nodeIntegration: true,
                preload: path.join(__dirname, 'bridge.js'),
                backgroundThrottling: false,
                contextIsolation: false,
            },
            maximizable: true,
            frame: false,
            show: false,
            backgroundColor: '#00000000',
            acceptFirstMouse: true,
        };
        if (useNativeBrowserWindow && process.platform === 'linux') {
            bwOptions.backgroundColor = '#131d27';
        }
        if (this.windowBounds) {
            Object.assign(bwOptions, this.windowBounds);
            const closestDisplay = electron_1.screen.getDisplayNearestPoint({ x: this.windowBounds.x, y: this.windowBounds.y });
            const [left1, top1, right1, bottom1] = [this.windowBounds.x, this.windowBounds.y, this.windowBounds.x + this.windowBounds.width, this.windowBounds.y + this.windowBounds.height];
            const [left2, top2, right2, bottom2] = [closestDisplay.bounds.x, closestDisplay.bounds.y, closestDisplay.bounds.x + closestDisplay.bounds.width, closestDisplay.bounds.y + closestDisplay.bounds.height];
            if ((left2 > right1 || right2 < left1 || top2 > bottom1 || bottom2 < top1) && !maximized) {
                bwOptions.x = closestDisplay.bounds.width / 2 - bwOptions.width / 2;
                bwOptions.y = closestDisplay.bounds.height / 2 - bwOptions.height / 2;
            }
        }
        if (((_a = this.configStore.appearance) === null || _a === void 0 ? void 0 : _a.frame) === 'native') {
            bwOptions.frame = true;
        }
        else {
            bwOptions.titleBarStyle = 'hidden';
            if (process.platform === 'win32') {
                bwOptions.titleBarOverlay = {
                    color: '#00000000',
                };
            }
        }
        if (process.platform === 'darwin') {
            bwOptions.visualEffectState = 'active';
        }
        if (useNativeBrowserWindow) {
            this.window = new electron_1.BrowserWindow(bwOptions);
        }
        else {
            this.window = new glasstron.BrowserWindow(bwOptions);
        }
        this.webContents = this.window.webContents;
        if (options.debug) {
            this.webContents.on('console-message', details => {
                console.log(`[renderer:${details.level}] ${details.sourceId}:${details.lineNumber} ${details.message}`);
            });
            this.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
                console.error('[renderer] did-fail-load', { errorCode, errorDescription, validatedURL, isMainFrame });
            });
            this.webContents.on('render-process-gone', (_event, details) => {
                console.error('[renderer] render-process-gone', details);
            });
            this.webContents.on('unresponsive', () => {
                console.error('[renderer] window became unresponsive');
            });
            this.webContents.on('devtools-opened', () => {
                console.log('[renderer] DevTools opened');
            });
        }
        this.webContents.on('before-input-event', (event, input) => {
            var _a;
            if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') {
                return;
            }
            if (!this.isDevToolsShortcut(input)) {
                if (!options.debug || !this.isReloadShortcut(input)) {
                    return;
                }
                event.preventDefault();
                (_a = this.window) === null || _a === void 0 ? void 0 : _a.webContents.reloadIgnoringCache();
                return;
            }
            event.preventDefault();
            this.toggleDevTools();
        });
        const scheduleDebugOpen = () => {
            if (!options.debug) {
                return;
            }
            let attempts = 0;
            const maxAttempts = 10;
            const tryOpen = () => {
                var _a;
                attempts++;
                this.openDevTools();
                if (attempts < maxAttempts && !((_a = this.window) === null || _a === void 0 ? void 0 : _a.isDestroyed()) && !this.webContents.isDevToolsOpened()) {
                    this.scheduleTimeout(tryOpen, 500);
                }
            };
            this.scheduleTimeout(tryOpen, 250);
        };
        this.webContents.once('dom-ready', () => {
            scheduleDebugOpen();
        });
        this.window.webContents.once('did-finish-load', () => {
            var _a, _b, _c;
            scheduleDebugOpen();
            if (process.platform === 'darwin') {
                this.window.setVibrancy(macOSVibrancyType);
            }
            else if (process.platform === 'win32' && ((_a = this.configStore.appearance) === null || _a === void 0 ? void 0 : _a.vibrancy)) {
                this.setVibrancy(true);
            }
            this.setDarkMode((_c = (_b = this.configStore.appearance) === null || _b === void 0 ? void 0 : _b.colorSchemeMode) !== null && _c !== void 0 ? _c : 'dark');
            if (!options.hidden) {
                if (maximized) {
                    this.window.maximize();
                }
                else {
                    this.window.show();
                }
                this.window.focus();
                this.window.moveTop();
                application.focus();
            }
        });
        this.window.on('blur', () => {
            var _a, _b, _c;
            if (((_b = (_a = this.configStore.appearance) === null || _a === void 0 ? void 0 : _a.dock) !== null && _b !== void 0 ? _b : 'off') !== 'off' &&
                ((_c = this.configStore.appearance) === null || _c === void 0 ? void 0 : _c.dockHideOnBlur) &&
                !electron_1.BrowserWindow.getFocusedWindow()) {
                this.hide();
            }
        });
        this.window.loadFile(path.join(electron_1.app.getAppPath(), 'dist', 'index.html'));
        this.window.webContents.setVisualZoomLevelLimits(1, 1);
        this.window.webContents.setZoomFactor(1);
        const allowedPermissions = new Set(['notifications']);
        this.window.webContents.session.setPermissionCheckHandler((_wc, permission) => allowedPermissions.has(permission));
        this.window.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => callback(allowedPermissions.has(permission)));
        this.window.webContents.session.setDevicePermissionHandler(() => false);
        if (process.platform === 'darwin') {
            this.touchBarControl = new electron_1.TouchBar.TouchBarSegmentedControl({
                segments: [],
                change: index => this.send('touchbar-selection', index),
            });
            this.window.setTouchBar(new electron_1.TouchBar({
                items: [this.touchBarControl],
            }));
        }
        else {
            this.window.setMenu(null);
        }
        this.setupWindowManagement();
        this.setupUpdater();
        this.ready = new Promise(resolve => {
            const listener = (event) => {
                if (event.sender === this.window.webContents) {
                    electron_1.ipcMain.removeListener('app:ready', listener);
                    resolve();
                }
            };
            electron_1.ipcMain.on('app:ready', listener);
        });
    }
    makeMain() {
        this.isMainWindow = true;
        this.window.webContents.send('host:became-main-window');
    }
    setVibrancy(enabled, type, userRequested) {
        var _a, _b, _c, _d;
        if (userRequested !== null && userRequested !== void 0 ? userRequested : true) {
            this.lastVibrancy = { enabled, type };
        }
        if (process.platform === 'win32') {
            if (parseFloat(os.release()) >= 10) {
                if (this.window) {
                    this.window.blurType = enabled ? type === 'fluent' ? 'acrylic' : 'blurbehind' : null;
                }
                try {
                    (_b = (_a = this.window) === null || _a === void 0 ? void 0 : _a.setBlur) === null || _b === void 0 ? void 0 : _b.call(_a, enabled);
                    this.isFluentVibrancy = enabled && type === 'fluent';
                }
                catch (error) {
                    console.error('Failed to set window blur', error);
                }
            }
            else {
                DwmEnableBlurBehindWindow(this.window.getNativeWindowHandle(), enabled);
            }
        }
        else if (process.platform === 'linux') {
            if ((_c = this.window) === null || _c === void 0 ? void 0 : _c.setBlur) {
                this.window.setBackgroundColor(enabled ? '#00000000' : '#131d27');
                this.window.setBlur(enabled);
            }
            else {
                // Native BrowserWindow keeps Linux dev mode opaque to avoid DevTools issues with transparent windows.
                (_d = this.window) === null || _d === void 0 ? void 0 : _d.setBackgroundColor('#131d27');
            }
        }
        // macOS: vibrancy is now handled via CSS backdrop-filter, no Electron API needed
    }
    shouldUseNativeBrowserWindow() {
        return process.platform === 'darwin';
    }
    setDarkMode(mode) {
        if (process.platform === 'darwin') {
            if ('light' === mode) {
                electron_1.nativeTheme.themeSource = 'light';
            }
            else if ('auto' === mode) {
                electron_1.nativeTheme.themeSource = 'system';
            }
            else {
                electron_1.nativeTheme.themeSource = 'dark';
            }
        }
    }
    focus() {
        this.window.focus();
    }
    send(event, ...args) {
        if (!this.window) {
            return;
        }
        this.window.webContents.send(event, ...args);
        if (event === 'host:config-change') {
            this.configStore = args[0];
            this.enableDockedWindowStyles(this.isDockedOnTop());
        }
    }
    isDestroyed() {
        return !this.window || this.window.isDestroyed();
    }
    isFocused() {
        return this.window.isFocused();
    }
    isVisible() {
        return this.window.isVisible();
    }
    isDockedOnTop() {
        var _a, _b, _c, _d;
        return this.isMainWindow && ((_a = this.configStore.appearance) === null || _a === void 0 ? void 0 : _a.dock) && ((_b = this.configStore.appearance) === null || _b === void 0 ? void 0 : _b.dock) !== 'off' && ((_d = (_c = this.configStore.appearance) === null || _c === void 0 ? void 0 : _c.dockAlwaysOnTop) !== null && _d !== void 0 ? _d : true);
    }
    async hide() {
        if (process.platform === 'darwin') {
            // Lose focus
            electron_1.Menu.sendActionToFirstResponder('hide:');
            // Don't disable docked window styles when hiding - keep dock hidden if feature is enabled
            if (this.isDockedOnTop()) {
                // Temporarily disable always-on-top and other properties while hidden
                if (this.window.isAlwaysOnTop()) {
                    this.window.setAlwaysOnTop(false);
                }
            }
        }
        this.window.blur();
        this.window.hide();
    }
    async show() {
        await this.enableDockedWindowStyles(this.isDockedOnTop());
        this.window.show();
        this.window.focus();
    }
    async present() {
        await this.show();
        this.window.moveTop();
    }
    passCliArguments(argv, cwd, secondInstance) {
        const urlArg = argv.find(arg => (0, urlHandler_1.isTabbyURL)(arg));
        if (urlArg) {
            this.send('cli', (0, urlHandler_1.parseTabbyURL)(urlArg, cwd), cwd, secondInstance);
        }
        else {
            this.send('cli', (0, cli_1.parseArgs)(argv, cwd), cwd, secondInstance);
        }
    }
    async enableDockedWindowStyles(enabled) {
        if (process.platform === 'darwin') {
            if (enabled) {
                if (!this.dockHidden) {
                    electron_1.app.dock.hide();
                    this.dockHidden = true;
                }
                this.window.setAlwaysOnTop(true, 'screen-saver', 1);
                if (!this.window.isVisibleOnAllWorkspaces()) {
                    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                }
                if (this.window.fullScreenable) {
                    this.window.setFullScreenable(false);
                }
            }
            else {
                if (this.dockHidden) {
                    await electron_1.app.dock.show();
                    this.dockHidden = false;
                }
                if (this.window.isAlwaysOnTop()) {
                    this.window.setAlwaysOnTop(false);
                }
                if (this.window.isVisibleOnAllWorkspaces()) {
                    this.window.setVisibleOnAllWorkspaces(false);
                }
                if (!this.window.fullScreenable) {
                    this.window.setFullScreenable(true);
                }
            }
        }
    }
    setupWindowManagement() {
        this.window.on('show', () => {
            this.visible.next(true);
            this.send('host:window-shown');
        });
        this.window.on('hide', () => {
            this.visible.next(false);
        });
        const moveSubscription = new rxjs_1.Observable(observer => {
            this.window.on('move', () => observer.next());
        }).pipe((0, rxjs_1.debounceTime)(250)).subscribe(() => {
            this.send('host:window-moved');
        });
        this.window.on('closed', () => {
            moveSubscription.unsubscribe();
        });
        this.window.on('enter-full-screen', () => this.send('host:window-enter-full-screen'));
        this.window.on('leave-full-screen', () => this.send('host:window-leave-full-screen'));
        this.window.on('maximize', () => this.send('host:window-maximized'));
        this.window.on('unmaximize', () => this.send('host:window-unmaximized'));
        this.window.on('close', event => {
            if (!this.closing) {
                event.preventDefault();
                this.send('host:window-close-request');
                return;
            }
            this.windowConfig.set('windowBoundaries', this.windowBounds);
            this.windowConfig.set('maximized', this.window.isMaximized());
        });
        this.window.on('closed', () => {
            this.destroy();
        });
        this.window.on('resize', () => {
            if (!this.window.isMaximized()) {
                this.windowBounds = this.window.getBounds();
            }
        });
        this.window.on('move', () => {
            if (!this.window.isMaximized()) {
                this.windowBounds = this.window.getBounds();
            }
        });
        this.window.on('focus', () => {
            this.send('host:window-focused');
        });
        this.on('ready', () => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.webContents.send('start', {
                config: this.configStore,
                executable: electron_1.app.getPath('exe'),
                windowID: this.window.id,
                isMainWindow: this.isMainWindow,
                userPluginsPath: this.application.userPluginsPath,
            });
        });
        this.on('window-minimize', () => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.minimize();
        });
        this.on('window-set-bounds', (_, bounds) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.setBounds(bounds);
        });
        this.on('window-set-always-on-top', (_, flag) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.setAlwaysOnTop(flag);
        });
        this.on('window-set-vibrancy', (_, enabled, type) => {
            this.setVibrancy(enabled, type);
        });
        this.on('window-set-dark-mode', (_, mode) => {
            this.setDarkMode(mode);
        });
        this.on('window-set-window-controls-color', (_, theme) => {
            var _a;
            if (process.platform === 'win32') {
                const symbolColor = theme.foreground;
                (_a = this.window) === null || _a === void 0 ? void 0 : _a.setTitleBarOverlay({
                    symbolColor: symbolColor,
                    height: 32,
                });
            }
        });
        this.on('window-set-title', (_, title) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.setTitle(title);
        });
        this.on('window-open-dev-tools', () => {
            this.openDevTools();
        });
        this.on('window-reload', () => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.reload();
        });
        this.on('window-toggle-fullscreen', () => {
            if (!this.window) {
                return;
            }
            this.window.setFullScreen(!this.window.isFullScreen());
        });
        this.on('window-toggle-maximize', () => {
            if (!this.window) {
                return;
            }
            if (this.window.isMaximized()) {
                this.window.unmaximize();
            }
            else {
                this.window.maximize();
            }
        });
        this.on('window-set-position', (_, x, y) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.setPosition(x, y);
        });
        this.on('window-bring-to-front', () => {
            var _a;
            if ((_a = this.window) === null || _a === void 0 ? void 0 : _a.isMinimized()) {
                this.window.restore();
            }
            this.present();
        });
        this.on('window-close', () => {
            this.closing = true;
            this.window.close();
        });
        this.on('window-set-touch-bar', (_event, segments, selectedIndex) => {
            this.touchBarControl.segments = segments.map((segment) => ({
                label: segment.label,
                icon: segment.hasActivity ? activityIcon : undefined,
            }));
            this.touchBarControl.selectedIndex = selectedIndex;
        });
        this.window.webContents.setWindowOpenHandler(() => {
            return { action: 'deny' };
        });
        electron_1.ipcMain.on('window-set-disable-vibrancy-while-dragging', (_event, value) => {
            var _a;
            this.disableVibrancyWhileDragging = value && ((_a = this.configStore.hacks) === null || _a === void 0 ? void 0 : _a.disableVibrancyWhileDragging);
        });
        let moveEndedTimeout = null;
        const onBoundsChange = () => {
            var _a;
            if (!((_a = this.lastVibrancy) === null || _a === void 0 ? void 0 : _a.enabled) || !this.disableVibrancyWhileDragging || !this.isFluentVibrancy) {
                return;
            }
            this.setVibrancy(false, undefined, false);
            if (moveEndedTimeout !== null) {
                this.clearScheduledTimeout(moveEndedTimeout);
            }
            moveEndedTimeout = this.scheduleTimeout(() => {
                this.setVibrancy(this.lastVibrancy.enabled, this.lastVibrancy.type);
            }, 50);
        };
        this.window.on('move', onBoundsChange);
        this.window.on('resize', onBoundsChange);
        electron_1.ipcMain.on('window-set-traffic-light-position', (_event, x, y) => {
            this.window.setWindowButtonPosition({ x, y });
        });
        electron_1.ipcMain.on('window-set-opacity', (_event, opacity) => {
            this.window.setOpacity(opacity);
        });
        this.on('window-set-progress-bar', (_, value) => {
            var _a;
            (_a = this.window) === null || _a === void 0 ? void 0 : _a.setProgressBar(value, { mode: value < 0 ? 'none' : 'normal' });
        });
        electron_1.ipcMain.on('bridge:window:get-minimum-size', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return;
            }
            event.returnValue = this.window.getMinimumSize();
        });
        electron_1.ipcMain.on('bridge:window:get-position', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return;
            }
            event.returnValue = this.window.getPosition();
        });
        electron_1.ipcMain.on('bridge:window:is-maximized', event => {
            if (!this.window || event.sender !== this.window.webContents) {
                return;
            }
            event.returnValue = this.window.isMaximized();
        });
    }
    on(event, listener) {
        electron_1.ipcMain.on(event, (e, ...args) => {
            if (!this.window || e.sender !== this.window.webContents) {
                return;
            }
            listener(e, ...args);
        });
    }
    setupUpdater() {
        electron_updater_1.autoUpdater.autoDownload = true;
        electron_updater_1.autoUpdater.autoInstallOnAppQuit = true;
        electron_updater_1.autoUpdater.on('update-available', () => {
            this.send('updater:update-available');
        });
        electron_updater_1.autoUpdater.on('update-not-available', () => {
            this.send('updater:update-not-available');
        });
        electron_updater_1.autoUpdater.on('error', err => {
            this.send('updater:error', err);
        });
        electron_updater_1.autoUpdater.on('update-downloaded', () => {
            this.send('updater:update-downloaded');
        });
        this.on('updater:check-for-updates', () => {
            electron_updater_1.autoUpdater.checkForUpdates();
        });
        this.on('updater:quit-and-install', () => {
            electron_updater_1.autoUpdater.quitAndInstall();
        });
    }
    destroy() {
        this.clearPendingTimeouts();
        this.window = null;
        this.closed.next();
        this.visible.complete();
        this.closed.complete();
    }
    scheduleTimeout(fn, delay) {
        const handle = setTimeout(() => {
            this.pendingTimeouts.delete(handle);
            fn();
        }, delay);
        if (typeof handle === 'object' && typeof handle.unref === 'function') {
            handle.unref();
        }
        this.pendingTimeouts.add(handle);
        return handle;
    }
    clearScheduledTimeout(handle) {
        if (handle === null) {
            return;
        }
        clearTimeout(handle);
        this.pendingTimeouts.delete(handle);
    }
    clearPendingTimeouts() {
        for (const handle of this.pendingTimeouts) {
            clearTimeout(handle);
        }
        this.pendingTimeouts.clear();
    }
}
exports.Window = Window;
//# sourceMappingURL=window.js.map