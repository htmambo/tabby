import { app, ipcMain, Menu, Tray, shell, screen, globalShortcut, MenuItemConstructorOptions, WebContents, clipboard, dialog, BrowserWindow, nativeTheme, powerSaveBlocker } from 'electron'
import { spawn, ChildProcess, exec as nodeExec, execFile as nodeExecFile, spawnSync } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { createRequire } from 'module'
import { promisify } from 'node:util'

import { saveConfig } from './config'
import { Window, WindowOptions } from './window'
import { PTYManager } from './pty'

const runtimeRequire = createRequire(__filename)
const exec = promisify(nodeExec)
const execFile = promisify(nodeExecFile)

type WindowsRegistryModule = any
type WindowsProcessTreeModule = {
    getProcessList: (callback: (list: Array<{ name?: string }>) => void, pid: number) => void
}

let windowsRegistryModule: WindowsRegistryModule | null | undefined
let windowsProcessTreeModule: WindowsProcessTreeModule | null | undefined
let keytarModule: typeof import('keytar') | null | undefined
let pluginManagerModulePromise: Promise<typeof import('./pluginManager')> | null = null

function getWindowsRegistry (): WindowsRegistryModule | null {
    if (process.platform !== 'win32') {
        return null
    }
    if (windowsRegistryModule === undefined) {
        try {
            windowsRegistryModule = runtimeRequire('windows-native-registry')
        } catch {
            windowsRegistryModule = null
        }
    }
    return windowsRegistryModule
}

function getWindowsProcessTreeNative (): WindowsProcessTreeModule | null {
    if (process.platform !== 'win32') {
        return null
    }
    if (windowsProcessTreeModule === undefined) {
        try {
            windowsProcessTreeModule = runtimeRequire('@tabby-gang/windows-process-tree/build/Release/windows_process_tree.node') as WindowsProcessTreeModule
        } catch {
            windowsProcessTreeModule = null
        }
    }
    return windowsProcessTreeModule
}

function getKeytar (): typeof import('keytar') | null {
    if (keytarModule === undefined) {
        try {
            keytarModule = runtimeRequire('keytar') as typeof import('keytar')
        } catch {
            keytarModule = null
        }
    }
    return keytarModule
}

async function getPluginManager (): Promise<(typeof import('./pluginManager'))['pluginManager']> {
    pluginManagerModulePromise ??= import('./pluginManager')
    return (await pluginManagerModulePromise).pluginManager
}

interface BridgeMenuItemOptions {
    accelerator?: string
    checked?: boolean
    commandID?: string
    enabled?: boolean
    label?: string
    role?: string
    submenu?: BridgeMenuItemOptions[]
    type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio'
}

interface BridgeSubprocessSpawnOptions {
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    shell?: boolean
}

interface BridgeSubprocessState {
    child: ChildProcess
    sender: WebContents
}

interface BridgeFileTransferState {
    file: fs.promises.FileHandle
    position: number
    mode: 'read' | 'write'
    sender: WebContents
}

interface BridgeSerializedError {
    name: string
    message: string
    stack?: string
}

interface BridgeLogEntry {
    level: 'debug' | 'info' | 'warn' | 'error'
    message: string
    name: string
}

interface BridgeFSStat {
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
    size: number
    mode: number
    mtimeMs: number
}

interface BridgeFSDirEntry {
    name: string
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
}

interface BridgeLocalFileEntry {
    name: string
    fullPath: string
    isDirectory: boolean
    isSymlink: boolean
    size: number
    modified: number
    mode: number
}

export class Application {
    private tray?: Tray
    private ptyManager = new PTYManager()
    private windows: Window[] = []
    private lastGlobalHotkeyTime = 0
    private cachedPlasmaVersion?: [number, number] | null
    private bridgeSubprocesses = new Map<string, BridgeSubprocessState>()
    private bridgeSubprocessOwners = new Map<number, Set<string>>()
    private bridgeFileTransfers = new Map<string, BridgeFileTransferState>()
    private bridgeFileTransferOwners = new Map<number, Set<string>>()
    private quitRequested = false
    private readonly shouldQuitWhenLastWindowCloses = process.platform !== 'darwin' || process.env.TABBY_DEV === '1'
    private readonly shellIntegrationWorkflows = ['Open Tabby here.workflow', 'Paste path into Tabby.workflow']
    private readonly shellIntegrationRegistryKeys = [
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
    ]

    private bridgeLogWriteQueue = Promise.resolve()
    userPluginsPath: string

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    constructor (private configStore: any) {
        this.useBuiltinGraphics()
        this.ptyManager.init(this)
        this.setupRendererBridge()

        ipcMain.handle('app:save-config', async (event, config) => {
            await saveConfig(config)
            this.broadcastExcept('host:config-change', event.sender, config)
        })

        ipcMain.on('clipboard:read-text', event => {
            event.returnValue = clipboard.readText()
        })

        ipcMain.on('clipboard:write', (_event, content: { text?: string, html?: string }) => {
            clipboard.write({
                text: content?.text ?? '',
                html: content?.html,
            })
        })

        ipcMain.on('app:register-global-hotkey', (_event, specs) => {
            globalShortcut.unregisterAll()
            if (!this.shouldRegisterGlobalHotkeys()) {
                return
            }
            for (const spec of specs) {
                globalShortcut.register(spec, () => this.onGlobalHotkeyTriggered())
            }
        })

        if (process.platform === 'linux') {
            app.commandLine.appendSwitch('no-sandbox')
            app.commandLine.appendSwitch('disable-dev-shm-usage')
            if ((this.configStore.appearance?.opacity || 1) !== 1) {
                app.commandLine.appendSwitch('enable-transparent-visuals')
                // 不再自动禁用硬件加速，让透明背景也能使用 GPU 加速
                // 如果遇到透明背景渲染问题，可通过 hacks.disableGPU 手动禁用
                // app.disableHardwareAcceleration()
            }
        }
        if (this.configStore.hacks?.disableGPU) {
            app.commandLine.appendSwitch('disable-gpu')
            app.disableHardwareAcceleration()
        }

        this.userPluginsPath = path.join(
            app.getPath('userData'),
            'plugins',
        )

        if (!fs.existsSync(this.userPluginsPath)) {
            fs.mkdirSync(this.userPluginsPath)
        }

        app.commandLine.appendSwitch('disable-http-cache')
        app.commandLine.appendSwitch('max-active-webgl-contexts', '9000')
        app.commandLine.appendSwitch('lang', 'EN')

        for (const flag of this.configStore.flags || [['force_discrete_gpu', '0']]) {
            app.commandLine.appendSwitch(flag[0], flag[1])
        }

        app.on('before-quit', () => {
            this.quitRequested = true
        })

        app.on('window-all-closed', () => {
            if (this.quitRequested || this.shouldQuitWhenLastWindowCloses) {
                app.quit()
            }
        })
    }

    init (): void {
        screen.on('display-metrics-changed', () => this.broadcast('host:display-metrics-changed'))
        screen.on('display-added', () => this.broadcast('host:displays-changed'))
        screen.on('display-removed', () => this.broadcast('host:displays-changed'))
        nativeTheme.on('updated', () => this.broadcast('bridge:native-theme-updated', this.getNativeThemeState()))
    }

    async newWindow (options?: WindowOptions): Promise<Window> {
        const window = new Window(this, this.configStore, options)
        this.windows.push(window)
        if (this.windows.length === 1) {
            window.makeMain()
        }
        window.onVisibleChanged(visible => {
            if (visible) {
                this.disableTray()
            } else {
                this.enableTray()
            }
        })
        window.onClosed(() => {
            this.windows = this.windows.filter(x => x !== window)
            if (!this.windows.some(x => x.isMainWindow)) {
                this.windows[0]?.makeMain()
                this.windows[0]?.present()
            }
        })
        if (process.platform === 'darwin') {
            this.setupMenu()
        }
        await window.ready
        return window
    }

    private onGlobalHotkeyTriggered (): void {
        const now = Date.now()
        if (now - this.lastGlobalHotkeyTime < 100) {
            return
        }
        this.lastGlobalHotkeyTime = now
        this.onGlobalHotkey()
    }

    onGlobalHotkey (): void {
        let isPresent = this.windows.some(x => x.isFocused() && x.isVisible())
        const isDockedOnTop = this.windows.some(x => x.isDockedOnTop())
        if (isDockedOnTop) {
            // if docked and on top, hide even if not focused right now
            isPresent = this.windows.some(x => x.isVisible())
        }

        if (isPresent) {
            for (const window of this.windows) {
                window.hide()
            }
        } else {
            for (const window of this.windows) {
                window.present()
            }
        }
    }

    presentAllWindows (): void {
        for (const window of this.windows) {
            window.present()
        }
    }

    broadcast (event: string, ...args: any[]): void {
        for (const window of this.windows) {
            window.send(event, ...args)
        }
    }

    broadcastExcept (event: string, except: WebContents, ...args: any[]): void {
        for (const window of this.windows) {
            if (window.webContents.id !== except.id) {
                window.send(event, ...args)
            }
        }
    }

    async send (event: string, ...args: any[]): Promise<void> {
        if (!this.hasWindows()) {
            await this.newWindow()
        }
        this.windows.filter(w => !w.isDestroyed())[0].send(event, ...args)
    }

    enableTray (): void {
        if (!!this.tray || process.platform === 'linux' || (this.configStore.hideTray ?? false) === true) {
            return
        }

        if (process.platform === 'darwin') {
            this.tray = new Tray(`${app.getAppPath()}/assets/tray-darwinTemplate.png`)
            this.tray.setPressedImage(`${app.getAppPath()}/assets/tray-darwinHighlightTemplate.png`)
        } else {
            this.tray = new Tray(`${app.getAppPath()}/assets/tray.png`)
        }

        this.tray.on('click', () => {
            const timer = setTimeout(() => this.focus())
            if (typeof timer === 'object' && typeof timer.unref === 'function') {
                timer.unref()
            }
        })

        const contextMenu = Menu.buildFromTemplate([{
            label: 'Show',
            click: () => this.focus(),
        }])

        if (process.platform !== 'darwin') {
            this.tray.setContextMenu(contextMenu)
        }

        this.tray.setToolTip(`Tabby ${app.getVersion()}`)
    }

    disableTray (): void {
        if (process.platform === 'linux') {
            return
        }
        this.tray?.destroy()
        this.tray = null
    }

    hasWindows (): boolean {
        return !!this.windows.length
    }

    private shouldRegisterGlobalHotkeys (): boolean {
        const hotkeyMode = this.configStore.hacks?.globalHotkey
        if (hotkeyMode != null) {
            return !hotkeyMode
        }

        if (process.platform !== 'linux' || !this.isWaylandSession() || !this.isPlasmaSession()) {
            return true
        }

        const plasmaVersion = this.getPlasmaVersion()
        return plasmaVersion ? this.compareVersions(plasmaVersion, [6, 6]) >= 0 : false
    }

    private isWaylandSession (): boolean {
        return (process.env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland' || !!process.env.WAYLAND_DISPLAY
    }

    private isPlasmaSession (): boolean {
        const sessionInfo = [
            process.env.XDG_CURRENT_DESKTOP,
            process.env.DESKTOP_SESSION,
            process.env.GDMSESSION,
        ].join(':').toLowerCase()

        return process.env.KDE_FULL_SESSION === 'true' || sessionInfo.includes('kde') || sessionInfo.includes('plasma')
    }

    private getPlasmaVersion (): [number, number] | null {
        if (this.cachedPlasmaVersion !== undefined) {
            return this.cachedPlasmaVersion
        }
        try {
            const result = spawnSync('plasmashell', ['--version'], { encoding: 'utf8' })
            const output = result.stdout + result.stderr
            const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(output)
            this.cachedPlasmaVersion = match ? [
                parseInt(match[1], 10),
                parseInt(match[2], 10),
            ] : null
        } catch {
            this.cachedPlasmaVersion = null
        }
        return this.cachedPlasmaVersion ?? null
    }

    private compareVersions (a: [number, number], b: [number, number]): number {
        for (let i = 0; i < 2; i++) {
            if (a[i] !== b[i]) {
                return a[i] - b[i]
            }
        }
        return 0
    }

    focus (): void {
        for (const window of this.windows) {
            window.present()
        }
    }

    async handleSecondInstance (argv: string[], cwd: string): Promise<void> {
        if (!this.windows.length) {
            await this.newWindow()
        }
        this.presentAllWindows()
        await this.windows[this.windows.length - 1].passCliArguments(argv, cwd, true)
    }

    private useBuiltinGraphics (): void {
        if (process.platform === 'win32') {
            const wnr = getWindowsRegistry()
            if (!wnr) {
                return
            }
            const keyPath = 'SOFTWARE\\Microsoft\\DirectX\\UserGpuPreferences'
            const valueName = app.getPath('exe')
            if (!wnr.getRegistryValue(wnr.HK.CU, keyPath, valueName)) {
                wnr.setRegistryValue(wnr.HK.CU, keyPath, valueName, wnr.REG.SZ, 'GpuPreference=1;')
            }
        }
    }

    private setupRendererBridge (): void {
        ipcMain.on('bridge:app:get-path', (event, name) => {
            event.returnValue = app.getPath(name)
        })

        ipcMain.on('bridge:app:get-version', event => {
            event.returnValue = app.getVersion()
        })

        ipcMain.on('bridge:app:get-app-path', event => {
            event.returnValue = app.getAppPath()
        })

        ipcMain.on('bridge:app:relaunch', (_event, options) => {
            app.relaunch(options)
        })

        ipcMain.on('bridge:app:exit', (_event, code = 0) => {
            app.exit(code)
        })

        ipcMain.on('bridge:app:quit', () => {
            app.quit()
        })

        ipcMain.on('bridge:app:set-jump-list', (event, categories) => {
            event.returnValue = process.platform === 'win32' ? app.setJumpList(categories) : undefined
        })

        ipcMain.on('bridge:app:set-dock-menu', (event, template: BridgeMenuItemOptions[]) => {
            if (process.platform !== 'darwin') {
                return
            }

            const menu = Menu.buildFromTemplate(this.buildBridgeMenuTemplate(template, event.sender))
            app.dock?.setMenu(menu)
        })

        ipcMain.handle('bridge:dialog:show-open', async (event, options) => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (window) {
                return dialog.showOpenDialog(window, options)
            }
            return dialog.showOpenDialog(options)
        })

        ipcMain.handle('bridge:dialog:show-save', async (event, options) => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (window) {
                return dialog.showSaveDialog(window, options)
            }
            return dialog.showSaveDialog(options)
        })

        ipcMain.handle('bridge:dialog:show-message-box', async (event, options) => {
            const window = BrowserWindow.fromWebContents(event.sender)
            if (window) {
                return dialog.showMessageBox(window, options)
            }
            return dialog.showMessageBox(options)
        })

        ipcMain.handle('bridge:file-provider:read-file', async (_event, filePath: string) => {
            const content = await fs.promises.readFile(filePath)
            return content.toString('base64')
        })

        ipcMain.on('bridge:log:write', (_event, entry: BridgeLogEntry) => {
            this.enqueueBridgeLogWrite(entry)
        })

        ipcMain.handle('bridge:plugin-manager:install', async (_event, name: string, version: string) => {
            return (await getPluginManager()).install(this.userPluginsPath, name, version)
        })

        ipcMain.handle('bridge:plugin-manager:uninstall', async (_event, name: string) => {
            return (await getPluginManager()).uninstall(this.userPluginsPath, name)
        })

        ipcMain.handle('bridge:keytar:get-password', async (_event, service: string, account: string): Promise<string | null> => {
            const keytar = getKeytar()
            if (!keytar) {
                throw new Error('keytar is unavailable')
            }
            return keytar.getPassword(service, account)
        })

        ipcMain.handle('bridge:keytar:set-password', async (_event, service: string, account: string, password: string): Promise<void> => {
            const keytar = getKeytar()
            if (!keytar) {
                throw new Error('keytar is unavailable')
            }
            await keytar.setPassword(service, account, password)
        })

        ipcMain.handle('bridge:keytar:delete-password', async (_event, service: string, account: string): Promise<boolean> => {
            const keytar = getKeytar()
            if (!keytar) {
                throw new Error('keytar is unavailable')
            }
            return keytar.deletePassword(service, account)
        })

        ipcMain.handle('bridge:fs:exists', async (_event, filePath: string) => {
            try {
                await fs.promises.access(filePath)
                return true
            } catch {
                return false
            }
        })

        ipcMain.on('bridge:fs:exists-sync', (event, filePath: string) => {
            try {
                fs.accessSync(filePath)
                event.returnValue = true
            } catch {
                event.returnValue = false
            }
        })

        ipcMain.handle('bridge:fs:stat', async (_event, filePath: string): Promise<BridgeFSStat | null> => {
            try {
                const stats = await fs.promises.lstat(filePath)
                return {
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    size: stats.size,
                    mode: stats.mode,
                    mtimeMs: stats.mtimeMs,
                }
            } catch {
                return null
            }
        })

        ipcMain.on('bridge:fs:stat-sync', (event, filePath: string) => {
            try {
                const stats = fs.lstatSync(filePath)
                event.returnValue = {
                    isFile: stats.isFile(),
                    isDirectory: stats.isDirectory(),
                    isSymbolicLink: stats.isSymbolicLink(),
                    size: stats.size,
                    mode: stats.mode,
                    mtimeMs: stats.mtimeMs,
                } satisfies BridgeFSStat
            } catch {
                event.returnValue = null
            }
        })

        ipcMain.handle('bridge:fs:read-file-text', async (_event, filePath: string) => {
            return fs.promises.readFile(filePath, 'utf8')
        })

        ipcMain.on('bridge:fs:read-file-text-sync', (event, filePath: string) => {
            event.returnValue = fs.readFileSync(filePath, 'utf8')
        })

        ipcMain.handle('bridge:fs:write-file-text', async (_event, filePath: string, content: string) => {
            await fs.promises.writeFile(filePath, content, 'utf8')
        })

        ipcMain.on('bridge:fs:write-file-text-sync', (event, filePath: string, content: string) => {
            fs.writeFileSync(filePath, content, 'utf8')
            event.returnValue = true
        })

        ipcMain.handle('bridge:fs:read-file-base64', async (_event, filePath: string) => {
            const content = await fs.promises.readFile(filePath)
            return content.toString('base64')
        })

        ipcMain.handle('bridge:fs:write-file-base64', async (_event, filePath: string, content: string) => {
            const data = new Uint8Array(Buffer.from(content, 'base64'))
            await fs.promises.writeFile(filePath, data)
        })

        ipcMain.handle('bridge:fs:read-dir', async (_event, filePath: string): Promise<BridgeFSDirEntry[]> => {
            const entries = await fs.promises.readdir(filePath, { withFileTypes: true })
            return entries.map(entry => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink(),
            }))
        })

        ipcMain.on('bridge:fs:read-dir-sync', (event, filePath: string) => {
            const entries = fs.readdirSync(filePath, { withFileTypes: true })
            event.returnValue = entries.map(entry => ({
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymbolicLink: entry.isSymbolicLink(),
            } satisfies BridgeFSDirEntry))
        })

        ipcMain.on('bridge:fs:mkdir-sync', (event, filePath: string, recursive = false) => {
            fs.mkdirSync(filePath, { recursive })
            event.returnValue = true
        })

        ipcMain.on('bridge:fs:unlink-sync', (event, filePath: string) => {
            fs.unlinkSync(filePath)
            event.returnValue = true
        })

        ipcMain.handle('bridge:fs:realpath', async (_event, filePath: string): Promise<string | null> => {
            try {
                return await fs.promises.realpath(filePath)
            } catch {
                return null
            }
        })

        ipcMain.handle('bridge:fs:chmod', async (_event, filePath: string, mode: number) => {
            await fs.promises.chmod(filePath, mode)
        })

        ipcMain.handle('bridge:fs:list-local-directory', async (_event, directory: string): Promise<BridgeLocalFileEntry[]> => {
            const items = await fs.promises.readdir(directory, { withFileTypes: true })
            return Promise.all(items.map(async item => {
                const fullPath = path.join(directory, item.name)
                const linkStats = await fs.promises.lstat(fullPath)
                let fileStats = linkStats
                let isDirectory = item.isDirectory()

                if (item.isSymbolicLink()) {
                    try {
                        fileStats = await fs.promises.stat(fullPath)
                        isDirectory = fileStats.isDirectory()
                    } catch {
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
                }
            }))
        })

        ipcMain.handle('bridge:file-transfer:open-upload', async (event, filePath: string) => {
            const stat = await fs.promises.stat(filePath)
            const file = await fs.promises.open(filePath, 'r')
            const id = this.createBridgeFileTransferID()
            this.registerBridgeFileTransfer(event.sender, id, {
                file,
                position: 0,
                mode: 'read',
                sender: event.sender,
            })
            return {
                id,
                size: stat.size,
                mode: stat.mode,
            }
        })

        ipcMain.handle('bridge:file-transfer:read-upload', async (event, id: string, bytes: number) => {
            const transfer = this.getOwnedBridgeFileTransfer(event.sender, id)
            if (!transfer || transfer.mode !== 'read') {
                throw new Error(`Unknown upload transfer: ${id}`)
            }

            const buffer = new Uint8Array(bytes)
            const result = await transfer.file.read(buffer, 0, bytes, transfer.position)
            transfer.position += result.bytesRead
            return Buffer.from(buffer.subarray(0, result.bytesRead)).toString('base64')
        })

        ipcMain.handle('bridge:file-transfer:open-download', async (event, filePath: string, mode: number) => {
            const file = await fs.promises.open(filePath, 'w', mode)
            const id = this.createBridgeFileTransferID()
            this.registerBridgeFileTransfer(event.sender, id, {
                file,
                position: 0,
                mode: 'write',
                sender: event.sender,
            })
            return id
        })

        ipcMain.handle('bridge:file-transfer:write-download', async (event, id: string, base64: string) => {
            const transfer = this.getOwnedBridgeFileTransfer(event.sender, id)
            if (!transfer || transfer.mode !== 'write') {
                throw new Error(`Unknown download transfer: ${id}`)
            }

            const buffer = Uint8Array.from(Buffer.from(base64, 'base64'))
            let bytesWritten = 0
            while (bytesWritten < buffer.length) {
                const result = await transfer.file.write(buffer, bytesWritten, buffer.length - bytesWritten, transfer.position + bytesWritten)
                bytesWritten += result.bytesWritten
            }
            transfer.position += bytesWritten
            return bytesWritten
        })

        ipcMain.handle('bridge:file-transfer:create-directory', async (_event, directoryPath: string) => {
            await fs.promises.mkdir(directoryPath, { recursive: true })
        })

        ipcMain.handle('bridge:file-transfer:close', async (event, id: string) => {
            await this.closeOwnedBridgeFileTransfer(event.sender, id)
        })

        ipcMain.on('bridge:screen:get-all-displays', event => {
            event.returnValue = screen.getAllDisplays()
        })

        ipcMain.on('bridge:screen:get-primary-display', event => {
            event.returnValue = screen.getPrimaryDisplay()
        })

        ipcMain.on('bridge:screen:get-cursor-screen-point', event => {
            event.returnValue = screen.getCursorScreenPoint()
        })

        ipcMain.on('bridge:screen:get-display-nearest-point', (event, point) => {
            event.returnValue = screen.getDisplayNearestPoint(point)
        })

        ipcMain.on('bridge:native-theme:get-state', event => {
            event.returnValue = this.getNativeThemeState()
        })

        ipcMain.on('bridge:power-save-blocker:start', (event, type) => {
            event.returnValue = powerSaveBlocker.start(type)
        })

        ipcMain.on('bridge:power-save-blocker:stop', (_event, id) => {
            powerSaveBlocker.stop(id)
        })

        ipcMain.on('bridge:menu:popup', (event, menuID: string, template: BridgeMenuItemOptions[]) => {
            const menu = Menu.buildFromTemplate(this.buildBridgeMenuTemplate(template, event.sender))
            const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
            menu.popup({
                window,
                callback: () => {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('bridge:menu-dismissed', menuID)
                    }
                },
            })
        })

        ipcMain.handle('bridge:subprocess:spawn', async (event, options: BridgeSubprocessSpawnOptions) => {
            return this.createBridgeSubprocess(event.sender, options)
        })

        ipcMain.on('bridge:subprocess:write', (event, id: string, data: string) => {
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id)
            if (subprocess?.child.stdin?.writable) {
                subprocess.child.stdin.write(data)
            }
        })

        ipcMain.on('bridge:subprocess:stdin-end', (event, id: string) => {
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id)
            subprocess?.child.stdin?.end()
        })

        ipcMain.on('bridge:subprocess:kill', (event, id: string, signal?: NodeJS.Signals | number) => {
            const subprocess = this.getOwnedBridgeSubprocess(event.sender, id)
            subprocess?.child.kill(signal)
        })

        ipcMain.on('bridge:platform:get-os-release', event => {
            event.returnValue = os.release()
        })

        ipcMain.on('bridge:platform:get-home-dir', event => {
            event.returnValue = os.homedir()
        })

        ipcMain.handle('bridge:platform:get-default-mac-shell', async (): Promise<string> => {
            try {
                const { stdout } = await exec(`/usr/bin/dscl . -read /Users/${process.env.LOGNAME} UserShell`)
                return stdout.toString().split(' ')[1].trim()
            } catch {
                return '/bin/bash'
            }
        })

        ipcMain.on('bridge:platform:get-winscp-path', event => {
            const wnr = getWindowsRegistry()
            if (!wnr) {
                event.returnValue = null
                return
            }

            const key = wnr.getRegistryKey(wnr.HK.CR, 'WinSCP.Url\\DefaultIcon')
            if (!key?.['']) {
                event.returnValue = null
                return
            }

            let detectedPath = key[''].value?.split(',')[0]
            detectedPath = detectedPath?.substring(1, detectedPath.length - 1)
            event.returnValue = detectedPath ?? null
        })

        ipcMain.handle('bridge:platform:is-process-running', async (_event, name: string) => {
            const windowsProcessTreeNative = getWindowsProcessTreeNative()
            if (process.platform !== 'win32' || !windowsProcessTreeNative) {
                throw new Error('Not supported')
            }

            return new Promise<boolean>(resolve => {
                windowsProcessTreeNative.getProcessList((list: Array<{ name?: string }>) => {
                    resolve(list.some((x: { name?: string }) => x.name === name))
                }, 0)
            })
        })

        ipcMain.handle('bridge:platform:list-fonts', async () => {
            if (process.platform === 'win32' || process.platform === 'darwin') {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const fontManager = require('fontmanager-redux')
                let fonts = await new Promise<any[]>(resolve => fontManager.getAvailableFonts(resolve))
                fonts = fonts.map(x => x.family.trim())
                return fonts
            }

            if (process.platform === 'linux') {
                const { stdout } = await execFile('fc-list', [':spacing=mono'])
                const fonts = stdout.toString()
                    .split('\n')
                    .filter(x => !!x)
                    .map(x => x.split(':')[1].trim())
                    .map(x => x.split(',')[0].trim())
                fonts.sort()
                return fonts
            }

            return []
        })

        ipcMain.handle('bridge:platform:list-hyper-color-schemes', async () => {
            return this.listHyperColorSchemes()
        })

        ipcMain.handle('bridge:platform:exec-file', async (_event, executable: string, argv: string[]) => {
            await execFile(executable, argv)
        })

        ipcMain.handle('bridge:shell-integration:is-installed', async () => {
            return this.isShellIntegrationInstalled()
        })

        ipcMain.handle('bridge:shell-integration:install', async () => {
            await this.installShellIntegration()
        })

        ipcMain.handle('bridge:shell-integration:remove', async () => {
            await this.removeShellIntegration()
        })
    }

    private enqueueBridgeLogWrite (entry: BridgeLogEntry): void {
        this.bridgeLogWriteQueue = this.bridgeLogWriteQueue
            .then(() => this.writeBridgeLogEntry(entry))
            .catch(error => {
                console.warn('Failed to write bridge log entry', error)
            })
    }

    private async writeBridgeLogEntry (entry: BridgeLogEntry): Promise<void> {
        const logDirectory = app.getPath('userData')
        const logPath = path.join(logDirectory, 'log.txt')
        await fs.promises.mkdir(logDirectory, { recursive: true })

        const normalizedLevel = ['debug', 'info', 'warn', 'error'].includes(entry.level) ? entry.level : 'info'
        const normalizedName = (entry.name || 'renderer').replace(/\r?\n/g, ' ')
        const normalizedMessage = (entry.message || '').replace(/\r?\n/g, '\\n')
        const line = `${new Date().toISOString()} ${normalizedLevel}: [${normalizedName}] ${normalizedMessage}\n`
        await this.rotateBridgeLogsIfNeeded(logPath, Buffer.byteLength(line))
        await fs.promises.appendFile(logPath, line, 'utf8')
    }

    private async rotateBridgeLogsIfNeeded (logPath: string, incomingBytes: number): Promise<void> {
        const maxSize = 5 * 1024 * 1024
        const maxFiles = 5

        try {
            const stat = await fs.promises.stat(logPath)
            if (stat.size + incomingBytes <= maxSize) {
                return
            }
        } catch {
            return
        }

        const archiveCount = Math.max(maxFiles - 1, 0)
        if (archiveCount === 0) {
            await fs.promises.rm(logPath, { force: true })
            return
        }

        await fs.promises.rm(`${logPath}.${archiveCount}`, { force: true })
        for (let index = archiveCount; index >= 1; index -= 1) {
            const source = index === 1 ? logPath : `${logPath}.${index - 1}`
            const destination = `${logPath}.${index}`
            try {
                await fs.promises.rm(destination, { force: true })
                await fs.promises.rename(source, destination)
            } catch {
                // Ignore missing archives during rotation.
            }
        }
    }

    private async listHyperColorSchemes (): Promise<any[]> {
        const pluginsPath = path.join(os.homedir(), '.hyper_plugins', 'node_modules')
        if (!fs.existsSync(pluginsPath)) {
            return []
        }

        const plugins = await fs.promises.readdir(pluginsPath)
        const themes: any[] = []

        for (const plugin of plugins) {
            try {
                const hyperPlugin = runtimeRequire(path.join(pluginsPath, plugin))
                if (!hyperPlugin.decorateConfig) {
                    continue
                }

                let config: any = {}
                try {
                    config = hyperPlugin.decorateConfig({})
                } catch {
                    console.warn('Could not load Hyper theme:', plugin)
                    continue
                }

                if (!config.colors) {
                    continue
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
                })
            } catch (error) {
                console.debug('Skipping Hyper plugin', plugin, error)
            }
        }

        return themes
    }

    private getAutomatorWorkflowsLocation (): string {
        return path.join(
            path.dirname(path.dirname(app.getPath('exe'))),
            'Resources',
            'extras',
            'automator-workflows',
        )
    }

    private getAutomatorWorkflowsDestination (): string {
        return path.join(os.homedir(), 'Library', 'Services')
    }

    private getShellIntegrationExecutable (): string {
        return process.env.PORTABLE_EXECUTABLE_FILE ?? app.getPath('exe')
    }

    private async isShellIntegrationInstalled (): Promise<boolean> {
        if (process.platform === 'darwin') {
            const destination = this.getAutomatorWorkflowsDestination()
            return fs.existsSync(path.join(destination, this.shellIntegrationWorkflows[0]))
        }

        if (process.platform === 'win32') {
            const wnr = getWindowsRegistry()
            if (!wnr) {
                throw new Error('windows-native-registry is unavailable')
            }
            return !!wnr.getRegistryKey(wnr.HK.CU, this.shellIntegrationRegistryKeys[0].path)
        }

        return true
    }

    private async installShellIntegration (): Promise<void> {
        const exe = this.getShellIntegrationExecutable()

        if (process.platform === 'darwin') {
            const sourceRoot = this.getAutomatorWorkflowsLocation()
            const destinationRoot = this.getAutomatorWorkflowsDestination()
            await fs.promises.mkdir(destinationRoot, { recursive: true })

            for (const workflow of this.shellIntegrationWorkflows) {
                await fs.promises.cp(
                    path.join(sourceRoot, workflow),
                    path.join(destinationRoot, workflow),
                    {
                        recursive: true,
                        force: true,
                    },
                )
            }
            return
        }

        if (process.platform !== 'win32') {
            return
        }

        const wnr = getWindowsRegistry()
        if (!wnr) {
            throw new Error('windows-native-registry is unavailable')
        }

        for (const registryKey of this.shellIntegrationRegistryKeys) {
            wnr.createRegistryKey(wnr.HK.CU, registryKey.path)
            wnr.createRegistryKey(wnr.HK.CU, registryKey.path + '\\command')
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path, '', wnr.REG.SZ, registryKey.value)
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path, 'Icon', wnr.REG.SZ, exe)
            wnr.setRegistryValue(wnr.HK.CU, registryKey.path + '\\command', '', wnr.REG.SZ, exe + ' ' + registryKey.command)
        }

        if (wnr.getRegistryKey(wnr.HK.CU, 'Software\\Classes\\Directory\\Background\\shell\\Open Tabby here')) {
            wnr.deleteRegistryKey(wnr.HK.CU, 'Software\\Classes\\Directory\\Background\\shell\\Open Tabby here')
        }
        if (wnr.getRegistryKey(wnr.HK.CU, 'Software\\Classes\\*\\shell\\Paste path into Tabby')) {
            wnr.deleteRegistryKey(wnr.HK.CU, 'Software\\Classes\\*\\shell\\Paste path into Tabby')
        }
    }

    private async removeShellIntegration (): Promise<void> {
        if (process.platform === 'darwin') {
            const destinationRoot = this.getAutomatorWorkflowsDestination()
            for (const workflow of this.shellIntegrationWorkflows) {
                await fs.promises.rm(path.join(destinationRoot, workflow), {
                    recursive: true,
                    force: true,
                })
            }
            return
        }

        if (process.platform !== 'win32') {
            return
        }

        const wnr = getWindowsRegistry()
        if (!wnr) {
            throw new Error('windows-native-registry is unavailable')
        }

        for (const registryKey of this.shellIntegrationRegistryKeys) {
            wnr.deleteRegistryKey(wnr.HK.CU, registryKey.path)
        }
    }

    private createBridgeFileTransferID (): string {
        return `transfer:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`
    }

    private registerBridgeFileTransfer (sender: WebContents, id: string, state: BridgeFileTransferState): void {
        this.bridgeFileTransfers.set(id, state)
        this.ensureBridgeFileTransferOwner(sender)
        this.bridgeFileTransferOwners.get(sender.id)?.add(id)
    }

    private ensureBridgeFileTransferOwner (sender: WebContents): void {
        if (this.bridgeFileTransferOwners.has(sender.id)) {
            return
        }

        this.bridgeFileTransferOwners.set(sender.id, new Set())
        sender.once('destroyed', () => {
            this.cleanupBridgeFileTransferOwner(sender.id)
        })
    }

    private getOwnedBridgeFileTransfer (sender: WebContents, id: string): BridgeFileTransferState | undefined {
        if (!this.bridgeFileTransferOwners.get(sender.id)?.has(id)) {
            return undefined
        }
        return this.bridgeFileTransfers.get(id)
    }

    private async closeOwnedBridgeFileTransfer (sender: WebContents, id: string): Promise<void> {
        if (!this.bridgeFileTransferOwners.get(sender.id)?.has(id)) {
            return
        }

        await this.closeBridgeFileTransfer(id)
    }

    private async closeBridgeFileTransfer (id: string): Promise<void> {
        const transfer = this.bridgeFileTransfers.get(id)
        if (!transfer) {
            return
        }

        this.bridgeFileTransfers.delete(id)
        this.bridgeFileTransferOwners.get(transfer.sender.id)?.delete(id)
        try {
            await transfer.file.close()
        } catch {
            // Ignore already-closed descriptors.
        }
    }

    private cleanupBridgeFileTransferOwner (ownerID: number): void {
        const ids = Array.from(this.bridgeFileTransferOwners.get(ownerID) ?? [])
        this.bridgeFileTransferOwners.delete(ownerID)
        for (const id of ids) {
            void this.closeBridgeFileTransfer(id)
        }
    }

    private ensureBridgeSubprocessOwner (sender: WebContents): void {
        if (this.bridgeSubprocessOwners.has(sender.id)) {
            return
        }

        this.bridgeSubprocessOwners.set(sender.id, new Set())
        sender.once('destroyed', () => {
            this.cleanupBridgeSubprocessOwner(sender.id)
        })
    }

    private async createBridgeSubprocess (sender: WebContents, options: BridgeSubprocessSpawnOptions): Promise<string> {
        this.ensureBridgeSubprocessOwner(sender)

        return new Promise<string>((resolve, reject) => {
            const id = `bridge-subprocess:${Date.now()}:${Math.random().toString(36).slice(2)}`
            const child = spawn(options.command, options.args ?? [], {
                cwd: options.cwd,
                env: options.env,
                shell: options.shell,
                stdio: ['pipe', 'pipe', 'pipe'],
            })

            const onSpawn = () => {
                child.off('error', onStartupError)

                child.stdout?.setEncoding('utf8')
                child.stderr?.setEncoding('utf8')

                this.bridgeSubprocesses.set(id, { child, sender })
                this.bridgeSubprocessOwners.get(sender.id)?.add(id)

                child.stdout?.on('data', data => {
                    this.sendBridgeSubprocessEvent(sender, id, 'stdout', data)
                })

                child.stderr?.on('data', data => {
                    this.sendBridgeSubprocessEvent(sender, id, 'stderr', data)
                })

                child.on('error', error => {
                    this.sendBridgeSubprocessEvent(sender, id, 'error', this.serializeBridgeError(error))
                })

                child.on('close', (code, signal) => {
                    this.sendBridgeSubprocessEvent(sender, id, 'close', code, signal)
                    this.unregisterBridgeSubprocess(id)
                })

                resolve(id)
            }

            const onStartupError = (error: Error) => {
                child.off('spawn', onSpawn)
                reject(error)
            }

            child.once('spawn', onSpawn)
            child.once('error', onStartupError)
        })
    }

    private getOwnedBridgeSubprocess (sender: WebContents, id: string): BridgeSubprocessState | undefined {
        const subprocess = this.bridgeSubprocesses.get(id)
        if (!subprocess || subprocess.sender.id !== sender.id) {
            return undefined
        }
        return subprocess
    }

    private unregisterBridgeSubprocess (id: string): void {
        const subprocess = this.bridgeSubprocesses.get(id)
        if (!subprocess) {
            return
        }

        this.bridgeSubprocesses.delete(id)
        const ownerProcesses = this.bridgeSubprocessOwners.get(subprocess.sender.id)
        ownerProcesses?.delete(id)
        if (ownerProcesses?.size === 0) {
            this.bridgeSubprocessOwners.delete(subprocess.sender.id)
        }
    }

    private cleanupBridgeSubprocessOwner (senderID: number): void {
        const processIDs = this.bridgeSubprocessOwners.get(senderID)
        if (!processIDs) {
            return
        }

        for (const id of processIDs) {
            const subprocess = this.bridgeSubprocesses.get(id)
            if (!subprocess) {
                continue
            }
            subprocess.child.kill()
            this.bridgeSubprocesses.delete(id)
        }

        this.bridgeSubprocessOwners.delete(senderID)
    }

    private sendBridgeSubprocessEvent (sender: WebContents, id: string, event: string, ...args: any[]): void {
        if (sender.isDestroyed()) {
            return
        }
        sender.send(`bridge:subprocess:${id}:${event}`, ...args)
    }

    private serializeBridgeError (error: Error): BridgeSerializedError {
        return {
            name: error.name,
            message: error.message,
            stack: error.stack,
        }
    }

    private buildBridgeMenuTemplate (template: BridgeMenuItemOptions[], sender: WebContents): MenuItemConstructorOptions[] {
        return template.map(item => ({
            accelerator: item.accelerator,
            checked: item.checked,
            enabled: item.enabled,
            label: item.label,
            role: item.role as any,
            type: item.type,
            click: item.commandID ? () => {
                if (!sender.isDestroyed()) {
                    sender.send('bridge:menu-click', item.commandID)
                }
            } : undefined,
            submenu: item.submenu ? this.buildBridgeMenuTemplate(item.submenu, sender) : undefined,
        }))
    }

    private getNativeThemeState (): { shouldUseDarkColors: boolean } {
        return {
            shouldUseDarkColors: nativeTheme.shouldUseDarkColors,
        }
    }

    private setupMenu () {
        const template: MenuItemConstructorOptions[] = [
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
                                await this.newWindow()
                            }
                            this.windows[0].send('host:preferences-menu')
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
                            this.quitRequested = true
                            app.quit()
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
                        click () {
                            shell.openExternal('https://eugeny.github.io/tabby')
                        },
                    },
                ],
            },
        ]

        if (process.env.TABBY_DEV) {
            const viewMenu = template[2]
            if (Array.isArray(viewMenu.submenu)) {
                viewMenu.submenu.unshift({ role: 'reload' })
            }
        }

        Menu.setApplicationMenu(Menu.buildFromTemplate(template))
    }
}
