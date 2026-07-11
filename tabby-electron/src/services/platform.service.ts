import * as path from 'path'
import { Injectable, NgZone } from '@angular/core'
import { PlatformService, ClipboardContent, Platform, MenuItemOptions, MessageBoxOptions, MessageBoxResult, DirectoryUpload, FileUpload, FileDownload, DirectoryDownload, FileUploadOptions, wrapPromise, TranslateService, FileTransfer, PlatformTheme, LocalFileEntry, normalizeExternalURL, pathExists, readTextFile, readDirectory, readPathStat, base64ToBytes, bytesToBase64 } from 'tabby-core'
import { ElectronService } from '../services/electron.service'
import { ShellIntegrationService } from './shellIntegration.service'
import { ElectronHostAppService } from './hostApp.service'
import { configPath } from '../../../app/lib/config'

const DIRECTORY_SCAN_CONCURRENCY = 16

interface BridgeUploadDescriptor {
    id: string
    size: number
    mode: number
}

/**
 * Resolve `relativePath` against `basePath` and ensure the result stays inside `basePath`.
 */
export function resolveInsideBase (basePath: string, relativePath: string): string {
    const base = path.resolve(basePath)
    const target = path.resolve(base, relativePath)
    const rel = path.relative(base, target)
    if (rel !== '' && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel))) {
        throw new Error(`Refusing access outside the target directory: ${relativePath}`)
    }
    return target
}

@Injectable({ providedIn: 'root' })
export class ElectronPlatformService extends PlatformService {
    supportsWindowControls = true
    private safeExternalSchemes = new Set(['http', 'https', 'ftp', 'mailto'])
    private configPath: string

    constructor (
        private hostApp: ElectronHostAppService,
        private electron: ElectronService,
        private zone: NgZone,
        private shellIntegration: ShellIntegrationService,
        private translate: TranslateService,
    ) {
        super()
        this.configPath = configPath

        electron.ipcRenderer.on('host:display-metrics-changed', () => {
            this.zone.run(() => this.displayMetricsChanged.next())
        })

        electron.nativeTheme.on('updated', () => {
            this.zone.run(() => this.themeChanged.next(this.getTheme()))
        })
    }

    async getAllFiles (dir: string, root: DirectoryUpload, registerTransfers = true): Promise<DirectoryUpload> {
        const items = await readDirectory(dir)
        for (let index = 0; index < items.length; index += DIRECTORY_SCAN_CONCURRENCY) {
            const batch = items.slice(index, index + DIRECTORY_SCAN_CONCURRENCY)
            const children = await Promise.all(batch.map(async item => {
                if (item.isDirectory) {
                    return this.getAllFiles(path.join(dir, item.name), new DirectoryUpload(item.name), registerTransfers)
                }

                const file = new ElectronFileUpload(path.join(dir, item.name), this.electron)
                await wrapPromise(this.zone, file.open())
                if (registerTransfers) {
                    this.fileTransferStarted.next(file)
                }
                return file
            }))

            children.forEach(child => root.pushChildren(child))
        }
        return root
    }

    readClipboard (): string {
        return this.electron.ipcRenderer.sendSync('clipboard:read-text')
    }

    setClipboard (content: ClipboardContent): void {
        this.electron.ipcRenderer.send('clipboard:write', content)
    }

    async installPlugin (name: string, version: string): Promise<void> {
        await this.electron.ipcRenderer.invoke('bridge:plugin-manager:install', name, version)
    }

    async uninstallPlugin (name: string): Promise<void> {
        await this.electron.ipcRenderer.invoke('bridge:plugin-manager:uninstall', name)
    }

    async isProcessRunning (name: string): Promise<boolean> {
        if (this.hostApp.platform === Platform.Windows) {
            return this.electron.ipcRenderer.invoke('bridge:platform:is-process-running', name)
        } else {
            throw new Error('Not supported')
        }
    }

    getWinSCPPath (): string|null {
        return this.electron.ipcRenderer.sendSync('bridge:platform:get-winscp-path')
    }

    async exec (app: string, argv: string[]): Promise<void> {
        await this.electron.ipcRenderer.invoke('bridge:platform:exec-file', app, argv)
    }

    isShellIntegrationSupported (): boolean {
        return this.hostApp.platform !== Platform.Linux
    }

    async isShellIntegrationInstalled (): Promise<boolean> {
        return this.shellIntegration.isInstalled()
    }

    async installShellIntegration (): Promise<void> {
        await this.shellIntegration.install()
    }

    async uninstallShellIntegration (): Promise<void> {
        await this.shellIntegration.remove()
    }

    async loadConfig (): Promise<string> {
        if (!await pathExists(this.configPath)) {
            return ''
        }
        return readTextFile(this.configPath)
    }

    async saveConfig (content: string): Promise<void> {
        await this.hostApp.saveConfig(content)
    }

    getConfigPath (): string|null {
        return this.configPath
    }

    showItemInFolder (p: string): void {
        this.electron.shell.showItemInFolder(p)
    }

    async openExternal (url: string): Promise<void> {
        const safeURL = normalizeExternalURL(url)
        if (!safeURL) {
            console.warn('Blocked unsafe external URL:', url)
            return
        }
        const scheme = this.getExternalScheme(safeURL)
        if (scheme && this.safeExternalSchemes.has(scheme)) {
            await this.electron.shell.openExternal(safeURL)
        } else {
            await this.confirmAndOpenExternal(safeURL)
        }
    }

    private getExternalScheme (url: string): string | null {
        try {
            const protocol = new URL(url.trim()).protocol
            return protocol ? protocol.replace(':', '').toLowerCase() : null
        } catch {
            return null
        }
    }

    private async confirmAndOpenExternal (url: string): Promise<void> {
        const scheme = this.getExternalScheme(url)
        const result = await this.electron.dialog.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant(`Open this app-specific "${scheme}" URI?`),
                detail: url,
                buttons: [
                    this.translate.instant('Open'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )

        if (result.response === 0) {
            await this.electron.shell.openExternal(url)
        }
    }

    openPath (p: string): void {
        this.electron.shell.openPath(p)
    }

    getOSRelease (): string {
        return this.electron.ipcRenderer.sendSync('bridge:platform:get-os-release')
    }

    getAppVersion (): string {
        return this.electron.app.getVersion()
    }

    async listFonts (): Promise<string[]> {
        return this.electron.ipcRenderer.invoke('bridge:platform:list-fonts')
    }

    supportsLocalDirectoryListing (): boolean {
        return true
    }

    async getDefaultLocalDirectory (): Promise<string|null> {
        return this.electron.ipcRenderer.sendSync('bridge:platform:get-home-dir')
    }

    async readLocalDirectory (directory: string): Promise<LocalFileEntry[]> {
        return this.electron.ipcRenderer.invoke<LocalFileEntry[]>('bridge:fs:list-local-directory', directory)
    }

    popupContextMenu (menu: MenuItemOptions[], _event?: MouseEvent): void {
        this.electron.popupContextMenu(menu.map(item => this.rewrapMenuItemOptions(item)))
    }

    rewrapMenuItemOptions (menu: MenuItemOptions): MenuItemOptions {
        return {
            ...menu,
            click: () => {
                this.zone.run(() => {
                    menu.click?.()
                })
            },
            submenu: menu.submenu ? menu.submenu.map(x => this.rewrapMenuItemOptions(x)) : undefined,
        }
    }

    async showMessageBox (options: MessageBoxOptions): Promise<MessageBoxResult> {
        return this.electron.dialog.showMessageBox(options)
    }

    quit (): void {
        this.electron.app.exit(0)
    }

    async startUpload (options?: FileUploadOptions, paths?: string[]): Promise<FileUpload[]> {
        options ??= { multiple: false }

        const properties: any[] = ['openFile', 'treatPackageAsDirectory']
        if (options.multiple) {
            properties.push('multiSelections')
        }

        let resolvedPaths = paths
        if (!paths) {
            const result = await this.electron.dialog.showOpenDialog({
                buttonLabel: this.translate.instant('Select'),
                properties,
            })
            if (result.canceled) {
                return []
            }
            resolvedPaths = result.filePaths
        }

        return Promise.all((resolvedPaths ?? []).map(async p => {
            const transfer = new ElectronFileUpload(p, this.electron)
            await wrapPromise(this.zone, transfer.open())
            this.fileTransferStarted.next(transfer)
            return transfer
        }))
    }

    async startUploadDirectory (paths?: string[]): Promise<DirectoryUpload> {
        const properties: any[] = ['openFile', 'treatPackageAsDirectory', 'openDirectory']

        let resolvedPaths = paths
        if (!paths) {
            const result = await this.electron.dialog.showOpenDialog({
                buttonLabel: this.translate.instant('Select'),
                properties,
            })
            if (result.canceled) {
                return new DirectoryUpload()
            }
            resolvedPaths = result.filePaths
        }

        const selectedPath = resolvedPaths?.[0]
        if (!selectedPath) {
            return new DirectoryUpload()
        }

        const root = new DirectoryUpload()
        root.pushChildren(await this.getAllFiles(
            selectedPath.split(path.sep).join(path.posix.sep),
            new DirectoryUpload(path.basename(selectedPath)),
            false,
        ))
        return root
    }

    async startDownload (name: string, mode: number, size: number, filePath?: string, defaultDirectory?: string): Promise<FileDownload|null> {
        if (!filePath) {
            if (defaultDirectory === undefined) {
                const result = await this.electron.dialog.showSaveDialog({
                    defaultPath: name,
                })
                if (!result.filePath) {
                    return null
                }
                filePath = result.filePath
            } else {
                if (!await this.isExistingDirectory(defaultDirectory)) {
                    throw new Error(this.translate.instant('Local destination directory is unavailable: {path}', {
                        path: defaultDirectory,
                    }))
                }
                filePath = await this.getAvailableDownloadFilePath(defaultDirectory, name)
            }
        }
        if (!filePath) {
            return null
        }

        const transfer = new ElectronFileDownload(filePath, mode, size, this.electron)
        await wrapPromise(this.zone, transfer.open())
        this.fileTransferStarted.next(transfer)
        return transfer
    }

    async startDownloadDirectory (name: string, estimatedSize?: number, defaultDirectory?: string): Promise<DirectoryDownload|null> {
        let selectedFolder = ''
        if (defaultDirectory === undefined) {
            const pickedFolder = await this.pickDirectory(
                this.translate.instant('Select destination folder for {name}', { name }),
                this.translate.instant('Download here'),
            )
            if (!pickedFolder) {
                return null
            }
            selectedFolder = pickedFolder
        } else {
            if (!await this.isExistingDirectory(defaultDirectory)) {
                throw new Error(this.translate.instant('Local destination directory is unavailable: {path}', {
                    path: defaultDirectory,
                }))
            }
            selectedFolder = defaultDirectory
        }

        const downloadPath = await this.getAvailableDownloadDirectoryPath(selectedFolder, name)

        const transfer = new ElectronDirectoryDownload(downloadPath, name, estimatedSize ?? 0, this.electron, this.zone)
        await wrapPromise(this.zone, transfer.open())
        this.fileTransferStarted.next(transfer)
        return transfer
    }

    private async getAvailableDownloadFilePath (directory: string, fileName: string): Promise<string> {
        const parsed = path.parse(fileName)
        let result = path.join(directory, fileName)
        let counter = 1
        while (await pathExists(result)) {
            result = path.join(directory, `${parsed.name} (${counter})${parsed.ext}`)
            counter++
        }
        return result
    }

    private async getAvailableDownloadDirectoryPath (directory: string, dirName: string): Promise<string> {
        let result = path.join(directory, dirName)
        let counter = 1
        while (await pathExists(result)) {
            result = path.join(directory, `${dirName} (${counter})`)
            counter++
        }
        return result
    }

    private async isExistingDirectory (directory: string): Promise<boolean> {
        return (await readPathStat(directory))?.isDirectory ?? false
    }

    _registerFileTransfer (transfer: FileTransfer): void {
        this.fileTransferStarted.next(transfer)
    }

    setErrorHandler (handler: (_: any) => void): void {
        this.electron.ipcRenderer.on('uncaughtException', (_$event, err) => {
            handler(err)
        })
    }

    async pickDirectory (title?: string, buttonLabel?: string, defaultPath?: string): Promise<string | null> {
        const result = await this.electron.dialog.showOpenDialog({
            title,
            buttonLabel,
            defaultPath,
            properties: ['openDirectory', 'showHiddenFiles'],
        })
        if (result.canceled || !result.filePaths.length) {
            return null
        }
        return result.filePaths[0]
    }

    getTheme (): PlatformTheme {
        if (this.electron.nativeTheme.shouldUseDarkColors) {
            return 'dark'
        } else {
            return 'light'
        }
    }
}

class ElectronFileUpload extends FileUpload {
    private size = 0
    private mode = 0
    private transferID?: string
    private powerSaveBlocker = 0
    private readonly chunkSize = 256 * 1024

    constructor (private filePath: string, private electron: ElectronService) {
        super()
        this.powerSaveBlocker = electron.powerSaveBlocker.start('prevent-app-suspension')
    }

    async open (): Promise<void> {
        const transfer = await this.electron.ipcRenderer.invoke<BridgeUploadDescriptor>('bridge:file-transfer:open-upload', this.filePath)
        this.transferID = transfer.id
        this.size = transfer.size
        this.mode = transfer.mode
        this.setTotalSize(this.size)
    }

    getName (): string {
        return path.basename(this.filePath)
    }

    getMode (): number {
        return this.mode
    }

    getSize (): number {
        return this.size
    }

    async read (): Promise<Uint8Array> {
        if (!this.transferID) {
            await this.open()
        }

        const content = await this.electron.ipcRenderer.invoke<string>('bridge:file-transfer:read-upload', this.transferID, this.chunkSize)
        const result = base64ToBytes(content)
        this.increaseProgress(result.length)
        if (this.getCompletedBytes() >= this.getSize()) {
            this.setCompleted(true)
        }
        return result
    }

    close (): void {
        this.electron.powerSaveBlocker.stop(this.powerSaveBlocker)
        const transferID = this.transferID
        this.transferID = undefined
        if (transferID) {
            void this.electron.ipcRenderer.invoke('bridge:file-transfer:close', transferID)
        }
    }
}

class ElectronFileDownload extends FileDownload {
    private transferID?: string
    private powerSaveBlocker = 0

    constructor (
        private filePath: string,
        private mode: number,
        private size: number,
        private electron: ElectronService,
    ) {
        super()
        this.powerSaveBlocker = electron.powerSaveBlocker.start('prevent-app-suspension')
        this.setTotalSize(size)
    }

    async open (): Promise<void> {
        this.transferID = await this.electron.ipcRenderer.invoke<string>('bridge:file-transfer:open-download', this.filePath, this.mode)
    }

    getName (): string {
        return path.basename(this.filePath)
    }

    getSize (): number {
        return this.size
    }

    async write (buffer: Uint8Array): Promise<void> {
        if (!this.transferID) {
            await this.open()
        }

        const bytesWritten = await this.electron.ipcRenderer.invoke<number>(
            'bridge:file-transfer:write-download',
            this.transferID,
            bytesToBase64(buffer),
        )
        this.increaseProgress(bytesWritten)
        if (this.getCompletedBytes() >= this.getSize()) {
            this.setCompleted(true)
        }
    }

    close (): void {
        this.electron.powerSaveBlocker.stop(this.powerSaveBlocker)
        const transferID = this.transferID
        this.transferID = undefined
        if (transferID) {
            void this.electron.ipcRenderer.invoke('bridge:file-transfer:close', transferID)
        }
    }
}

class ElectronDirectoryDownload extends DirectoryDownload {
    private powerSaveBlocker = 0

    constructor (
        private basePath: string,
        private name: string,
        estimatedSize: number,
        private electron: ElectronService,
        private zone: NgZone,
    ) {
        super()
        this.powerSaveBlocker = electron.powerSaveBlocker.start('prevent-app-suspension')
        this.setTotalSize(estimatedSize)
    }

    async open (): Promise<void> {
        await this.electron.ipcRenderer.invoke('bridge:file-transfer:create-directory', this.basePath)
    }

    getName (): string {
        return this.name
    }

    getSize (): number {
        return this.getTotalSize()
    }

    async createDirectory (relativePath: string): Promise<void> {
        const fullPath = resolveInsideBase(this.basePath, relativePath)
        await this.electron.ipcRenderer.invoke('bridge:file-transfer:create-directory', fullPath)
    }

    async createFile (relativePath: string, mode: number, size: number): Promise<FileDownload> {
        const fullPath = resolveInsideBase(this.basePath, relativePath)
        await this.electron.ipcRenderer.invoke('bridge:file-transfer:create-directory', path.dirname(fullPath))

        const fileDownload = new ElectronFileDownload(fullPath, mode, size, this.electron)
        await wrapPromise(this.zone, fileDownload.open())
        return fileDownload
    }

    close (): void {
        this.electron.powerSaveBlocker.stop(this.powerSaveBlocker)
    }
}
