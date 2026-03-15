import { EventEmitter } from 'events'
import { Injectable } from '@angular/core'
import { getTabbyBridge, type BridgeIPC } from '../../../app/src/tabby-bridge'

export interface MessageBoxResponse {
    response: number
    checkboxChecked?: boolean
}

export interface RendererMenuItemOptions {
    accelerator?: string
    checked?: boolean
    click?: () => void
    enabled?: boolean
    label?: string
    role?: string
    submenu?: RendererMenuItemOptions[]
    type?: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio'
}

interface RendererIPCListener {
    (_event?: unknown, ...args: any[]): void
}

interface RendererIPC {
    send: (channel: string, ...args: any[]) => void
    sendSync: <T = any>(channel: string, ...args: any[]) => T
    invoke: <T = any>(channel: string, ...args: any[]) => Promise<T>
    on: (channel: string, listener: RendererIPCListener) => void
    once: (channel: string, listener: RendererIPCListener) => void
    off: (channel: string, listener: RendererIPCListener) => void
}

interface ClipboardProxy {
    readText: () => string
    write: (content: { text?: string, html?: string }) => void
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

class AppProxy {
    constructor (private ipcRenderer: RendererIPC) { }

    getPath (name: string): string {
        return this.ipcRenderer.sendSync('bridge:app:get-path', name)
    }

    getVersion (): string {
        return this.ipcRenderer.sendSync('bridge:app:get-version')
    }

    getAppPath (): string {
        return this.ipcRenderer.sendSync('bridge:app:get-app-path')
    }

    relaunch (options?: any): void {
        this.ipcRenderer.send('bridge:app:relaunch', options)
    }

    exit (code = 0): void {
        this.ipcRenderer.send('bridge:app:exit', code)
    }

    quit (): void {
        this.ipcRenderer.send('bridge:app:quit')
    }

    setJumpList (categories: any[]): any {
        return this.ipcRenderer.sendSync('bridge:app:set-jump-list', categories)
    }
}

class DialogProxy {
    constructor (private ipcRenderer: RendererIPC) { }

    async showOpenDialog (windowOrOptions: any, maybeOptions?: any): Promise<any> {
        return this.ipcRenderer.invoke('bridge:dialog:show-open', maybeOptions ?? windowOrOptions)
    }

    async showSaveDialog (windowOrOptions: any, maybeOptions?: any): Promise<any> {
        return this.ipcRenderer.invoke('bridge:dialog:show-save', maybeOptions ?? windowOrOptions)
    }

    async showMessageBox (windowOrOptions: any, maybeOptions?: any): Promise<any> {
        return this.ipcRenderer.invoke('bridge:dialog:show-message-box', maybeOptions ?? windowOrOptions)
    }
}

class ScreenProxy {
    constructor (private ipcRenderer: RendererIPC) { }

    getAllDisplays (): any[] {
        return this.ipcRenderer.sendSync('bridge:screen:get-all-displays')
    }

    getPrimaryDisplay (): any {
        return this.ipcRenderer.sendSync('bridge:screen:get-primary-display')
    }

    getCursorScreenPoint (): { x: number, y: number } {
        return this.ipcRenderer.sendSync('bridge:screen:get-cursor-screen-point')
    }

    getDisplayNearestPoint (point: { x: number, y: number }): any {
        return this.ipcRenderer.sendSync('bridge:screen:get-display-nearest-point', point)
    }
}

class NativeThemeProxy extends EventEmitter {
    constructor (private ipcRenderer: RendererIPC) {
        super()
    }

    get shouldUseDarkColors (): boolean {
        return !!this.ipcRenderer.sendSync('bridge:native-theme:get-state').shouldUseDarkColors
    }
}

class PowerSaveBlockerProxy {
    constructor (private ipcRenderer: RendererIPC) { }

    start (type: 'prevent-app-suspension' | 'prevent-display-sleep'): number {
        return this.ipcRenderer.sendSync('bridge:power-save-blocker:start', type)
    }

    stop (id: number): void {
        this.ipcRenderer.send('bridge:power-save-blocker:stop', id)
    }
}

class ClipboardProxyImpl implements ClipboardProxy {
    constructor (private ipcRenderer: RendererIPC) { }

    readText (): string {
        return this.ipcRenderer.sendSync('clipboard:read-text')
    }

    write (content: { text?: string, html?: string }): void {
        this.ipcRenderer.send('clipboard:write', content)
    }
}

class IpcRendererProxy implements RendererIPC {
    private listenerWrappers = new WeakMap<RendererIPCListener, (...args: any[]) => void>()

    constructor (private bridgeIPC: BridgeIPC) { }

    send (channel: string, ...args: any[]): void {
        this.bridgeIPC.send(channel, ...args)
    }

    sendSync<T = any> (channel: string, ...args: any[]): T {
        return this.bridgeIPC.sendSync<T>(channel, ...args)
    }

    invoke<T = any> (channel: string, ...args: any[]): Promise<T> {
        return this.bridgeIPC.invoke<T>(channel, ...args)
    }

    on (channel: string, listener: RendererIPCListener): void {
        const wrapped = (...args: any[]) => listener(undefined, ...args)
        this.listenerWrappers.set(listener, wrapped)
        this.bridgeIPC.on(channel, wrapped)
    }

    once (channel: string, listener: RendererIPCListener): void {
        this.bridgeIPC.once(channel, (...args) => listener(undefined, ...args))
    }

    off (channel: string, listener: RendererIPCListener): void {
        const wrapped = this.listenerWrappers.get(listener)
        if (!wrapped) {
            return
        }
        this.bridgeIPC.off(channel, wrapped)
        this.listenerWrappers.delete(listener)
    }
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class ElectronService {
    app: AppProxy
    ipcRenderer: RendererIPC
    shell: ReturnType<typeof getTabbyBridge>['shell']
    dialog: DialogProxy
    clipboard: ClipboardProxy
    screen: ScreenProxy
    powerSaveBlocker: PowerSaveBlockerProxy
    nativeTheme: NativeThemeProxy

    private menuCallbackID = 0
    private popupMenuCallbacks = new Map<string, string[]>()
    private callbacks = new Map<string, () => void>()
    private persistentMenuCallbackIDs = new Set<string>()

    /** @hidden */
    private constructor () {
        const bridge = getTabbyBridge()
        this.ipcRenderer = new IpcRendererProxy(bridge.ipc)
        this.shell = bridge.shell
        this.clipboard = new ClipboardProxyImpl(this.ipcRenderer)
        this.app = new AppProxy(this.ipcRenderer)
        this.dialog = new DialogProxy(this.ipcRenderer)
        this.screen = new ScreenProxy(this.ipcRenderer)
        this.powerSaveBlocker = new PowerSaveBlockerProxy(this.ipcRenderer)
        this.nativeTheme = new NativeThemeProxy(this.ipcRenderer)

        this.ipcRenderer.on('bridge:native-theme-updated', (_event, state) => {
            this.nativeTheme.emit('updated', state)
        })

        this.ipcRenderer.on('bridge:menu-click', (_event, callbackID: string) => {
            this.callbacks.get(callbackID)?.()
        })

        this.ipcRenderer.on('bridge:menu-dismissed', (_event, menuID: string) => {
            const callbackIDs = this.popupMenuCallbacks.get(menuID)
            if (!callbackIDs) {
                return
            }
            callbackIDs.forEach(id => this.callbacks.delete(id))
            this.popupMenuCallbacks.delete(menuID)
        })
    }

    popupContextMenu (menu: RendererMenuItemOptions[]): void {
        const menuID = `popup:${Date.now()}:${Math.random().toString(36).slice(2)}`
        const callbackIDs: string[] = []
        const template = this.serializeMenu(menu, callbackIDs)
        this.popupMenuCallbacks.set(menuID, callbackIDs)
        this.ipcRenderer.send('bridge:menu:popup', menuID, template)
    }

    setDockMenu (menu: RendererMenuItemOptions[]): void {
        this.persistentMenuCallbackIDs.forEach(id => this.callbacks.delete(id))
        this.persistentMenuCallbackIDs.clear()

        const callbackIDs: string[] = []
        const template = this.serializeMenu(menu, callbackIDs)
        callbackIDs.forEach(id => this.persistentMenuCallbackIDs.add(id))
        this.ipcRenderer.send('bridge:app:set-dock-menu', template)
    }

    private serializeMenu (items: RendererMenuItemOptions[], callbackIDs: string[]): BridgeMenuItemOptions[] {
        return items.map(item => {
            const result: BridgeMenuItemOptions = {
                accelerator: item.accelerator,
                checked: item.checked,
                enabled: item.enabled,
                label: item.label,
                role: item.role,
                type: item.type,
            }

            if (item.click) {
                const callbackID = `menu:${++this.menuCallbackID}`
                this.callbacks.set(callbackID, item.click)
                callbackIDs.push(callbackID)
                result.commandID = callbackID
            }

            if (item.submenu) {
                result.submenu = this.serializeMenu(item.submenu, callbackIDs)
            }

            return result
        })
    }
}
