import * as C from 'constants'
import * as localPath from 'path'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional, HostListener, ElementRef, ViewChild } from '@angular/core'
import { FileTransfer, FileUpload, DirectoryUpload, DirectoryDownload, MenuItemOptions, NotificationsService, PlatformService, LocalFileEntry, TranslateService } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'

interface PathSegment {
    name: string
    path: string
}

interface DirectoryUploadStats {
    totalSize: number
}

class DirectoryUploadTransfer extends FileTransfer {
    private name: string

    constructor (name: string) {
        super()
        this.name = name
    }

    getName (): string {
        return this.name
    }

    setName (name: string): void {
        this.name = name
    }

    getSize (): number {
        return this.getTotalSize()
    }

    advance (bytes: number): void {
        this.increaseProgress(bytes)
    }

    close (): void { }
}

class ProgressTrackingFileUpload extends FileUpload {
    constructor (
        private inner: FileUpload,
        private progress: DirectoryUploadTransfer,
    ) {
        super()
    }

    getName (): string {
        return this.inner.getName()
    }

    getMode (): number {
        return this.inner.getMode()
    }

    getSize (): number {
        return this.inner.getSize()
    }

    async read (): Promise<Uint8Array> {
        if (this.progress.isCancelled()) {
            throw new Error('Upload cancelled')
        }
        const chunk = await this.inner.read()
        if (chunk.length) {
            this.progress.advance(chunk.length)
        }
        return chunk
    }

    close (): void {
        this.inner.close()
    }

    cancel (): void {
        this.inner.cancel()
        super.cancel()
    }
}

@Component({
    standalone: false,
    selector: 'sftp-panel',
    templateUrl: './sftpPanel.component.pug',
    styleUrls: ['./sftpPanel.component.scss'],
})
export class SFTPPanelComponent {
    @Input() session: SSHSession
    @Output() closed = new EventEmitter<void>()
    sftp: SFTPSession
    fileList: SFTPFile[]|null = null
    filteredFileList: SFTPFile[] = []
    localFileList: LocalFileEntry[]|null = null
    filteredLocalFileList: LocalFileEntry[] = []
    @Input() path = '/'
    @Input() initialLocalPath: string|null = null
    @Output() pathChange = new EventEmitter<string>()
    pathSegments: PathSegment[] = []
    localPath = ''
    localPathSegments: PathSegment[] = []
    @Input() cwdDetectionAvailable = false
    editingPath: string|null = null
    showFilter = false
    filterText = ''
    initError: string|null = null
    selectedLocalItemPaths = new Set<string>()
    private localSelectionAnchorPath: string|null = null
    selectedRemoteItemPaths = new Set<string>()
    private remoteSelectionAnchorPath: string|null = null
    private activePane: 'local'|'remote' = 'remote'
    protected contextMenuProviders: SFTPContextMenuItemProvider[] = []
    @ViewChild('panes') panes?: ElementRef<HTMLElement>
    localPaneWidthPercent = 50
    private paneResizeActive = false

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private host: ElementRef<HTMLElement>,
        public platform: PlatformService,
        @Optional() @Inject(SFTPContextMenuItemProvider) contextMenuProviders: SFTPContextMenuItemProvider[]|null,
    ) {
        this.contextMenuProviders = contextMenuProviders ? [...contextMenuProviders] : []
        this.contextMenuProviders.sort((a, b) => a.weight - b.weight)
    }

    get showLocalPanel (): boolean {
        return this.platform.supportsLocalDirectoryListing()
    }

    get canLocalGoUp (): boolean {
        if (!this.localPath) {
            return false
        }
        return localPath.dirname(this.localPath) !== this.localPath
    }

    async ngOnInit (): Promise<void> {
        try {
            this.sftp = await this.session.openSFTP()
        } catch (error) {
            const errorMessage = error?.message ?? `${error}`
            this.initError = errorMessage
            this.notifications.error(errorMessage)
            return
        }

        try {
            await this.navigate(this.path)
        } catch (error) {
            console.warn('Could not navigate to', this.path, ':', error)
            this.notifications.error(error.message)
            await this.navigate('/')
        }

        if (this.showLocalPanel) {
            try {
                const defaultLocalDirectory = this.initialLocalPath ?? await this.platform.getDefaultLocalDirectory()
                if (defaultLocalDirectory) {
                    await this.navigateLocal(defaultLocalDirectory)
                }
            } catch (error) {
                console.warn('Could not initialize local directory:', error)
                this.notifications.error(error.message)
            }
        }
    }

    async navigate (newPath: string, fallbackOnError = true): Promise<void> {
        const previousPath = this.path
        this.path = newPath
        this.pathChange.next(this.path)
        this.clearRemoteSelection()

        this.clearFilter()

        let p = newPath
        this.pathSegments = []
        while (p !== '/' && p !== '.') {
            this.pathSegments.unshift({
                name: path.basename(p),
                path: p,
            })
            const parent = path.dirname(p)
            if (parent === p) {
                break
            }
            p = parent
        }

        this.fileList = null
        this.filteredFileList = []
        try {
            this.fileList = await this.sftp.readdir(this.path)
        } catch (error) {
            this.notifications.error(error.message)
            if (previousPath && fallbackOnError) {
                await this.navigate(previousPath, false)
            }
            return
        }

        this.sortEntries(this.fileList)

        this.updateFilteredList()
    }

    async navigateLocal (newPath: string, fallbackOnError = true): Promise<void> {
        const previousPath = this.localPath
        this.localPath = localPath.resolve(newPath)
        this.clearLocalSelection()
        this.updateLocalPathSegments()

        this.localFileList = null
        this.filteredLocalFileList = []
        try {
            this.localFileList = await this.platform.readLocalDirectory(this.localPath)
        } catch (error) {
            this.notifications.error(error.message)
            if (previousPath && fallbackOnError) {
                await this.navigateLocal(previousPath, false)
            }
            return
        }

        this.sortEntries(this.localFileList)
        this.updateFilteredList()
    }

    getFileType (fileExtension: string): string {
        const codeExtensions = ['js', 'ts', 'py', 'java', 'cpp', 'h', 'cs', 'html', 'css', 'rb', 'php', 'swift', 'go', 'kt', 'sh', 'json', 'cc', 'c', 'xml']
        const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp']
        const pdfExtensions = ['pdf']
        const archiveExtensions = ['zip', 'rar', 'tar', 'gz']
        const wordExtensions = ['doc', 'docx']
        const videoExtensions = ['mp4', 'avi', 'mkv', 'mov']
        const powerpointExtensions = ['ppt', 'pptx']
        const textExtensions = ['txt', 'log']
        const audioExtensions = ['mp3', 'wav', 'flac']
        const excelExtensions = ['xls', 'xlsx']

        const lowerCaseExtension = fileExtension.toLowerCase()

        if (codeExtensions.includes(lowerCaseExtension)) {
            return 'code'
        } else if (imageExtensions.includes(lowerCaseExtension)) {
            return 'image'
        } else if (pdfExtensions.includes(lowerCaseExtension)) {
            return 'pdf'
        } else if (archiveExtensions.includes(lowerCaseExtension)) {
            return 'archive'
        } else if (wordExtensions.includes(lowerCaseExtension)) {
            return 'word'
        } else if (videoExtensions.includes(lowerCaseExtension)) {
            return 'video'
        } else if (powerpointExtensions.includes(lowerCaseExtension)) {
            return 'powerpoint'
        } else if (textExtensions.includes(lowerCaseExtension)) {
            return 'text'
        } else if (audioExtensions.includes(lowerCaseExtension)) {
            return 'audio'
        } else if (excelExtensions.includes(lowerCaseExtension)) {
            return 'excel'
        } else {
            return 'unknown'
        }
    }

    getIcon (item: SFTPFile|LocalFileEntry): string {
        if (item.isDirectory) {
            return 'fas fa-folder text-info'
        }
        if (item.isSymlink) {
            return 'fas fa-link text-warning'
        }
        const fileMatch = /\.([^.]+)$/.exec(item.name)
        const extension = fileMatch ? fileMatch[1] : null
        if (extension !== null) {
            const fileType = this.getFileType(extension)

            switch (fileType) {
                case 'unknown':
                    return 'fas fa-file'
                default:
                    return `fa-solid fa-file-${fileType} `
            }
        }
        return 'fas fa-file'
    }

    goUp (): void {
        this.navigate(path.dirname(this.path))
    }

    localGoUp (): void {
        if (!this.canLocalGoUp) {
            return
        }
        this.navigateLocal(localPath.dirname(this.localPath))
    }

    async open (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.navigate(item.fullPath)
        } else if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.navigate(item.fullPath)
            } else {
                await this.download(item.fullPath, stat.mode, stat.size)
            }
        } else {
            await this.download(item.fullPath, item.mode, item.size)
        }
    }

    async openLocal (item: LocalFileEntry): Promise<void> {
        if (item.isDirectory) {
            await this.navigateLocal(item.fullPath)
        }
    }

    get selectedRemoteItemsCount (): number {
        return this.getSelectedRemoteItems().length
    }

    get selectedLocalItemsCount (): number {
        return this.getSelectedLocalItems().length
    }

    get areAllRemoteItemsSelected (): boolean {
        return this.filteredFileList.length > 0 && this.filteredFileList.every(x => this.selectedRemoteItemPaths.has(x.fullPath))
    }

    get areAllLocalItemsSelected (): boolean {
        return this.filteredLocalFileList.length > 0 && this.filteredLocalFileList.every(x => this.selectedLocalItemPaths.has(x.fullPath))
    }

    isRemoteItemSelected (item: SFTPFile): boolean {
        return this.selectedRemoteItemPaths.has(item.fullPath)
    }

    isLocalItemSelected (item: LocalFileEntry): boolean {
        return this.selectedLocalItemPaths.has(item.fullPath)
    }

    onRemoteItemClick (item: SFTPFile, event: MouseEvent): void {
        this.setActivePane(true)
        const itemPath = item.fullPath
        const isRangeSelection = event.shiftKey
        const isToggleSelection = event.ctrlKey || event.metaKey

        if (isRangeSelection) {
            this.selectRemoteRange(itemPath, isToggleSelection)
            return
        }

        if (isToggleSelection) {
            this.toggleRemoteSelection(itemPath)
            this.remoteSelectionAnchorPath = itemPath
            return
        }

        this.selectSingleRemoteItem(itemPath)
    }

    async onRemoteItemDoubleClick (item: SFTPFile): Promise<void> {
        this.setActivePane(true)
        this.selectSingleRemoteItem(item.fullPath)
        await this.open(item)
    }

    onLocalItemClick (item: LocalFileEntry, event: MouseEvent): void {
        this.setActivePane(false)
        const itemPath = item.fullPath
        const isRangeSelection = event.shiftKey
        const isToggleSelection = event.ctrlKey || event.metaKey

        if (isRangeSelection) {
            this.selectLocalRange(itemPath, isToggleSelection)
            return
        }

        if (isToggleSelection) {
            this.toggleLocalSelection(itemPath)
            this.localSelectionAnchorPath = itemPath
            return
        }

        this.selectSingleLocalItem(itemPath)
    }

    async onLocalItemDoubleClick (item: LocalFileEntry): Promise<void> {
        this.setActivePane(false)
        this.selectSingleLocalItem(item.fullPath)
        if (item.isDirectory) {
            await this.openLocal(item)
            return
        }
        this.platform.openPath(item.fullPath)
    }

    async uploadLocalItem (item: LocalFileEntry): Promise<void> {
        try {
            await this.uploadLocalItemInternal(item)
            this.notifications.notice(`Uploaded ${item.name}`)
        } catch (error) {
            this.notifications.error(`Failed to upload ${item.name}: ${error.message}`)
        }
    }

    async uploadSelectedLocalItems (): Promise<void> {
        const selectedItems = this.getSelectedLocalItems()
        if (!selectedItems.length) {
            return
        }

        let uploadedCount = 0
        for (const item of selectedItems) {
            try {
                await this.uploadLocalItemInternal(item)
                uploadedCount++
            } catch (error) {
                const message = error?.message ?? `${error}`
                this.notifications.error(`Failed to upload ${item.name}: ${message}`)
            }
        }

        if (uploadedCount > 0) {
            this.notifications.notice(this.translate.instant('Uploaded {count} item(s)', {
                count: uploadedCount,
            }))
        }
    }

    async selectLocalDirectory (): Promise<void> {
        const selectedDirectory = await this.platform.pickDirectory()
        if (selectedDirectory) {
            await this.navigateLocal(selectedDirectory)
        }
    }

    async downloadItem (item: SFTPFile): Promise<void> {
        if (item.isDirectory) {
            await this.downloadFolder(item)
            return
        }

        if (item.isSymlink) {
            const target = path.resolve(this.path, await this.sftp.readlink(item.fullPath))
            const stat = await this.sftp.stat(target)
            if (stat.isDirectory) {
                await this.downloadFolder(item)
                return
            }
            await this.download(item.fullPath, stat.mode, stat.size)
            return
        }

        await this.download(item.fullPath, item.mode, item.size)
    }

    async downloadSelected (): Promise<void> {
        for (const item of this.getSelectedRemoteItems()) {
            await this.downloadItem(item)
        }
    }

    selectAllRemoteItems (): void {
        if (!this.filteredFileList.length) {
            this.clearRemoteSelection()
            return
        }
        this.selectedRemoteItemPaths = new Set(this.filteredFileList.map(x => x.fullPath))
        this.remoteSelectionAnchorPath = this.filteredFileList[0].fullPath
    }

    toggleSelectAllRemoteItems (): void {
        if (this.areAllRemoteItemsSelected) {
            this.clearRemoteSelection()
            return
        }
        this.selectAllRemoteItems()
    }

    selectAllLocalItems (): void {
        if (!this.filteredLocalFileList.length) {
            this.clearLocalSelection()
            return
        }
        this.selectedLocalItemPaths = new Set(this.filteredLocalFileList.map(x => x.fullPath))
        this.localSelectionAnchorPath = this.filteredLocalFileList[0].fullPath
    }

    toggleSelectAllLocalItems (): void {
        if (this.areAllLocalItemsSelected) {
            this.clearLocalSelection()
            return
        }
        this.selectAllLocalItems()
    }

    clearRemoteSelectionAction (): void {
        this.clearRemoteSelection()
    }

    clearLocalSelectionAction (): void {
        this.clearLocalSelection()
    }

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice(this.translate.instant('The directory was created successfully'))
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error(this.translate.instant('The directory could not be created'))
            })
        }
    }

    async upload (): Promise<void> {
        const transfers = await this.platform.startUpload({ multiple: true })
        await Promise.all(transfers.map(t => this.uploadOne(t)))
    }

    async uploadFolder (): Promise<void> {
        const transfer = await this.platform.startUploadDirectory()
        await this.uploadOneFolder(transfer)
    }

    async uploadOneFolder (transfer: DirectoryUpload): Promise<void> {
        if (!transfer.getChildrens().length) {
            return
        }

        const savedPath = this.path
        const progress = this.createDirectoryUploadTransfer(transfer)
        this.platform.registerFileTransfer(progress)

        try {
            progress.setStatus(this.translate.instant(_('Reading folder structure')))
            progress.setTotalSize(this.getDirectoryUploadStats(transfer).totalSize)
            await this.uploadOneFolderInternal(transfer, '', progress)
            if (!progress.isCancelled()) {
                progress.setStatus('')
                progress.setCompleted(true)
            }
        } catch (error) {
            if (progress.isCancelled() || error?.message === 'Upload cancelled') {
                return
            }
            progress.cancel()
            this.notifications.error(this.translate.instant(_('Failed to upload folder: {message}'), {
                message: error?.message ?? `${error}`,
            }))
        } finally {
            progress.close()
            if (this.path === savedPath) {
                await this.navigate(this.path)
            }
        }
    }

    private async uploadOneFolderInternal (transfer: DirectoryUpload, accumPath = '', progress?: DirectoryUploadTransfer): Promise<void> {
        for (const t of transfer.getChildrens()) {
            if (progress?.isCancelled()) {
                throw new Error('Upload cancelled')
            }

            if (t instanceof DirectoryUpload) {
                const relativePath = path.posix.join(accumPath, t.getName())
                progress?.setStatus(this.translate.instant(_('Creating directory {path}'), { path: relativePath || t.getName() }))
                try {
                    await this.sftp.mkdir(path.posix.join(this.path, relativePath))
                } catch {
                    // Intentionally ignoring errors from making duplicate dirs.
                }
                await this.uploadOneFolderInternal(t, relativePath, progress)
            } else {
                const relativePath = path.posix.join(accumPath, t.getName())
                progress?.setStatus(this.translate.instant(_('Uploading {path}'), { path: relativePath }))
                await this.sftp.upload(
                    path.posix.join(this.path, relativePath),
                    progress ? new ProgressTrackingFileUpload(t, progress) : t,
                )
            }
        }
    }

    async uploadOne (transfer: FileUpload): Promise<void> {
        const savedPath = this.path
        await this.sftp.upload(path.join(this.path, transfer.getName()), transfer)
        if (this.path === savedPath) {
            await this.navigate(this.path)
        }
    }

    async download (itemPath: string, mode: number, size: number): Promise<void> {
        try {
            const transfer = await this.platform.startDownload(
                path.basename(itemPath),
                mode,
                size,
                undefined,
                this.getPreferredLocalDownloadDirectory(),
            )
            if (!transfer) {
                return
            }
            this.sftp.download(itemPath, transfer)
        } catch (error) {
            this.notifications.error(this.translate.instant('Failed to download {name}: {message}', {
                name: path.basename(itemPath),
                message: error.message,
            }))
        }
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(
                folder.name,
                0,
                this.getPreferredLocalDownloadDirectory(),
            )
            if (!transfer) {
                return
            }

            // Start background size calculation and download simultaneously
            const sizeCalculationPromise = this.calculateFolderSizeAndUpdate(folder, transfer)
            const downloadPromise = this.downloadFolderRecursive(folder, transfer, '')

            try {
                await Promise.all([sizeCalculationPromise, downloadPromise])
                transfer.setStatus('')
                transfer.setCompleted(true)
            } catch (error) {
                transfer.cancel()
                throw error
            } finally {
                transfer.close()
            }
        } catch (error) {
            this.notifications.error(this.translate.instant('Failed to download folder: {message}', {
                message: error.message,
            }))
            throw error
        }
    }

    private async calculateFolderSizeAndUpdate (folder: SFTPFile, transfer: DirectoryDownload) {
        let totalSize = 0
        const items = await this.sftp.readdir(folder.fullPath)
        for (const item of items) {
            if (item.isDirectory) {
                totalSize += await this.calculateFolderSizeAndUpdate(item, transfer)
            } else {
                totalSize += item.size
            }
            transfer.setTotalSize(totalSize)
        }
        return totalSize
    }

    private async downloadFolderRecursive (folder: SFTPFile, transfer: DirectoryDownload, relativePath: string): Promise<void> {
        const items = await this.sftp.readdir(folder.fullPath)

        for (const item of items) {
            if (transfer.isCancelled()) {
                throw new Error('Download cancelled')
            }

            const itemRelativePath = relativePath ? `${relativePath}/${item.name}` : item.name

            transfer.setStatus(itemRelativePath)
            if (item.isDirectory) {
                await transfer.createDirectory(itemRelativePath)
                await this.downloadFolderRecursive(item, transfer, itemRelativePath)
            } else {
                const fileDownload = await transfer.createFile(itemRelativePath, item.mode, item.size)
                await this.sftp.download(item.fullPath, fileDownload)
            }
        }
    }

    private getSelectedRemoteItems (): SFTPFile[] {
        if (!this.fileList) {
            return []
        }
        return this.fileList.filter(x => this.selectedRemoteItemPaths.has(x.fullPath))
    }

    private getSelectedLocalItems (): LocalFileEntry[] {
        if (!this.localFileList) {
            return []
        }
        return this.localFileList.filter(x => this.selectedLocalItemPaths.has(x.fullPath))
    }

    private async uploadLocalItemInternal (item: LocalFileEntry): Promise<void> {
        if (item.isDirectory) {
            const transfer = await this.platform.startUploadDirectory([item.fullPath])
            await this.uploadOneFolder(transfer)
            return
        }

        const transfers = await this.platform.startUpload({ multiple: false }, [item.fullPath])
        if (!transfers.length) {
            return
        }
        await this.uploadOne(transfers[0])
    }

    private clearRemoteSelection (): void {
        this.selectedRemoteItemPaths = new Set()
        this.remoteSelectionAnchorPath = null
    }

    private clearLocalSelection (): void {
        this.selectedLocalItemPaths = new Set()
        this.localSelectionAnchorPath = null
    }

    private selectSingleRemoteItem (itemPath: string): void {
        this.selectedRemoteItemPaths = new Set([itemPath])
        this.remoteSelectionAnchorPath = itemPath
    }

    private selectSingleLocalItem (itemPath: string): void {
        this.selectedLocalItemPaths = new Set([itemPath])
        this.localSelectionAnchorPath = itemPath
    }

    private toggleRemoteSelection (itemPath: string): void {
        const selection = new Set(this.selectedRemoteItemPaths)
        if (selection.has(itemPath)) {
            selection.delete(itemPath)
        } else {
            selection.add(itemPath)
        }
        this.selectedRemoteItemPaths = selection
        if (!selection.size) {
            this.remoteSelectionAnchorPath = null
        }
    }

    private toggleLocalSelection (itemPath: string): void {
        const selection = new Set(this.selectedLocalItemPaths)
        if (selection.has(itemPath)) {
            selection.delete(itemPath)
        } else {
            selection.add(itemPath)
        }
        this.selectedLocalItemPaths = selection
        if (!selection.size) {
            this.localSelectionAnchorPath = null
        }
    }

    private selectRemoteRange (itemPath: string, append = false): void {
        const anchorPath = this.remoteSelectionAnchorPath ?? itemPath
        const range = this.getRemoteRange(anchorPath, itemPath)
        if (!range.length) {
            this.selectSingleRemoteItem(itemPath)
            return
        }

        if (append) {
            const selection = new Set(this.selectedRemoteItemPaths)
            for (const filePath of range) {
                selection.add(filePath)
            }
            this.selectedRemoteItemPaths = selection
            return
        }

        this.selectedRemoteItemPaths = new Set(range)
    }

    private selectLocalRange (itemPath: string, append = false): void {
        const anchorPath = this.localSelectionAnchorPath ?? itemPath
        const range = this.getLocalRange(anchorPath, itemPath)
        if (!range.length) {
            this.selectSingleLocalItem(itemPath)
            return
        }

        if (append) {
            const selection = new Set(this.selectedLocalItemPaths)
            for (const filePath of range) {
                selection.add(filePath)
            }
            this.selectedLocalItemPaths = selection
            return
        }

        this.selectedLocalItemPaths = new Set(range)
    }

    private getRemoteRange (anchorPath: string, itemPath: string): string[] {
        const start = this.filteredFileList.findIndex(x => x.fullPath === anchorPath)
        const end = this.filteredFileList.findIndex(x => x.fullPath === itemPath)
        if (start === -1 || end === -1) {
            return []
        }

        const from = Math.min(start, end)
        const to = Math.max(start, end)
        return this.filteredFileList.slice(from, to + 1).map(x => x.fullPath)
    }

    private getLocalRange (anchorPath: string, itemPath: string): string[] {
        const start = this.filteredLocalFileList.findIndex(x => x.fullPath === anchorPath)
        const end = this.filteredLocalFileList.findIndex(x => x.fullPath === itemPath)
        if (start === -1 || end === -1) {
            return []
        }

        const from = Math.min(start, end)
        const to = Math.max(start, end)
        return this.filteredLocalFileList.slice(from, to + 1).map(x => x.fullPath)
    }

    private getPreferredLocalDownloadDirectory (): string {
        if (!this.showLocalPanel || !this.localPath) {
            throw new Error(this.translate.instant('No local destination directory is available'))
        }
        return this.localPath
    }

    getModeString (item: SFTPFile|LocalFileEntry): string {
        const s = 'SGdrwxrwxrwx'
        const e = '   ---------'
        const c = [
            0o4000, 0o2000, C.S_IFDIR,
            C.S_IRUSR, C.S_IWUSR, C.S_IXUSR,
            C.S_IRGRP, C.S_IWGRP, C.S_IXGRP,
            C.S_IROTH, C.S_IWOTH, C.S_IXOTH,
        ]
        let result = ''
        for (let i = 0; i < c.length; i++) {
            result += item.mode & c[i] ? s[i] : e[i]
        }
        return result
    }

    async buildContextMenu (item: SFTPFile): Promise<MenuItemOptions[]> {
        const sections: MenuItemOptions[][] = []
        if (this.selectedRemoteItemsCount > 1 && this.isRemoteItemSelected(item)) {
            sections.push([{
                click: () => this.downloadSelected(),
                label: this.translate.instant('Download selected ({count})', {
                    count: this.selectedRemoteItemsCount,
                }),
            }])
        }

        sections.push(...await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this))))
        sections.push([{
            click: () => this.navigate(this.path),
            label: this.translate.instant('Refresh current directory'),
        }])

        return sections.flatMap((section, index) =>
            index === 0 ? section : [{ type: 'separator' }, ...section],
        )
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        this.setActivePane(true)
        if (!this.isRemoteItemSelected(item)) {
            this.selectSingleRemoteItem(item.fullPath)
        }
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    async buildLocalContextMenu (item: LocalFileEntry): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: () => this.uploadLocalItem(item),
                label: this.translate.instant('Upload'),
            },
            {
                click: () => this.navigateLocal(this.localPath),
                label: this.translate.instant('Refresh current directory'),
            },
            {
                type: 'separator',
            },
            {
                click: () => this.platform.setClipboard({
                    text: item.fullPath,
                }),
                label: this.translate.instant('Copy full path'),
            },
        ]

        if (this.selectedLocalItemsCount > 1 && this.isLocalItemSelected(item)) {
            items.unshift({
                click: () => this.uploadSelectedLocalItems(),
                label: this.translate.instant('Upload selected ({count})', {
                    count: this.selectedLocalItemsCount,
                }),
            })
        }

        if (item.isDirectory) {
            items.unshift({
                click: () => this.openLocal(item),
                label: this.translate.instant('Open directory'),
            })
        }

        return items
    }

    async showLocalContextMenu (item: LocalFileEntry, event: MouseEvent): Promise<void> {
        event.preventDefault()
        event.stopPropagation()
        this.setActivePane(false)
        if (!this.isLocalItemSelected(item)) {
            this.selectSingleLocalItem(item.fullPath)
        }
        this.platform.popupContextMenu(await this.buildLocalContextMenu(item), event)
    }

    showPaneContextMenu (isRemotePane: boolean, event: MouseEvent): void {
        if (event.target !== event.currentTarget) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        this.setActivePane(isRemotePane)

        const menu = this.buildPaneContextMenu(isRemotePane)
        if (!menu.length) {
            return
        }
        this.platform.popupContextMenu(menu, event)
    }

    get shouldShowCWDTip (): boolean {
        return !window.localStorage.sshCWDTipDismissed
    }

    dismissCWDTip (): void {
        window.localStorage.sshCWDTipDismissed = 'true'
    }

    editPath (): void {
        this.editingPath = this.path
    }

    confirmPath (): void {
        if (this.editingPath === null) {
            return
        }
        this.navigate(this.editingPath)
        this.editingPath = null
    }

    close (): void {
        this.closed.emit()
    }

    clearFilter (): void {
        this.showFilter = false
        this.filterText = ''
        this.updateFilteredList()
    }

    onFilterChange (): void {
        this.updateFilteredList()
    }

    getNoFilesMatchMessage (): string {
        return this.translate.instant('No files match the filter "{filter}"', {
            filter: this.filterText,
        })
    }

    private buildPaneContextMenu (isRemotePane: boolean): MenuItemOptions[] {
        if (isRemotePane) {
            const items: MenuItemOptions[] = []
            if (this.filteredFileList.length) {
                items.push({
                    click: () => this.selectAllRemoteItems(),
                    label: this.translate.instant('Select all'),
                })
            }
            if (this.selectedRemoteItemsCount > 0) {
                items.push({
                    click: () => this.clearRemoteSelectionAction(),
                    label: this.translate.instant('Clear selection'),
                })
            }
            items.push({
                click: () => this.navigate(this.path),
                label: this.translate.instant('Refresh current directory'),
            })
            return items
        }

        if (!this.localPath) {
            return []
        }

        const items: MenuItemOptions[] = []
        if (this.filteredLocalFileList.length) {
            items.push({
                click: () => this.selectAllLocalItems(),
                label: this.translate.instant('Select all'),
            })
        }
        if (this.selectedLocalItemsCount > 0) {
            items.push({
                click: () => this.clearLocalSelectionAction(),
                label: this.translate.instant('Clear selection'),
            })
            items.push({
                click: () => this.uploadSelectedLocalItems(),
                label: this.translate.instant('Upload selected ({count})', {
                    count: this.selectedLocalItemsCount,
                }),
            })
        }
        items.push({
            click: () => this.navigateLocal(this.localPath),
            label: this.translate.instant('Refresh current directory'),
        })
        return items
    }

    setActivePane (isRemotePane: boolean): void {
        this.activePane = isRemotePane ? 'remote' : 'local'
    }

    startPaneResize (event: MouseEvent): void {
        if (!this.showLocalPanel || window.innerWidth <= 960) {
            return
        }
        this.paneResizeActive = true
        this.host.nativeElement.classList.add('pane-resizing')
        this.updatePaneSplit(event.clientX)
        event.preventDefault()
        event.stopPropagation()
    }

    @HostListener('document:mousemove', ['$event'])
    onDocumentMouseMove (event: MouseEvent): void {
        if (!this.paneResizeActive) {
            return
        }
        this.updatePaneSplit(event.clientX)
        event.preventDefault()
    }

    @HostListener('document:mouseup')
    @HostListener('window:blur')
    onDocumentMouseUp (): void {
        if (!this.paneResizeActive) {
            return
        }
        this.paneResizeActive = false
        this.host.nativeElement.classList.remove('pane-resizing')
    }

    @HostListener('document:keydown', ['$event'])
    onGlobalKeyDown (event: KeyboardEvent): void {
        if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') {
            return
        }

        const target = event.target as HTMLElement | null
        if (!target || !this.host.nativeElement.contains(target)) {
            return
        }
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
            return
        }

        if (this.activePane === 'local' && this.showLocalPanel) {
            this.selectAllLocalItems()
        } else {
            this.selectAllRemoteItems()
        }
        event.preventDefault()
    }

    private updatePaneSplit (clientX: number): void {
        const panesElement = this.panes?.nativeElement
        if (!panesElement) {
            return
        }

        const rect = panesElement.getBoundingClientRect()
        if (!rect.width) {
            return
        }

        const nextWidth = (clientX - rect.left) / rect.width * 100
        this.localPaneWidthPercent = Math.max(24, Math.min(76, nextWidth))
    }

    private createDirectoryUploadTransfer (transfer: DirectoryUpload): DirectoryUploadTransfer {
        const progress = new DirectoryUploadTransfer(this.getDirectoryUploadTransferName(transfer))
        progress.setStatus(this.translate.instant(_('Reading folder structure')))
        return progress
    }

    private getDirectoryUploadTransferName (transfer: DirectoryUpload): string {
        if (transfer.getName()) {
            return transfer.getName()
        }

        const children = transfer.getChildrens()
        if (children.length === 1) {
            return children[0].getName()
        }

        return this.translate.instant(_('Folder upload'))
    }

    private getDirectoryUploadStats (transfer: DirectoryUpload): DirectoryUploadStats {
        const stats: DirectoryUploadStats = {
            totalSize: 0,
        }

        const visit = (entry: DirectoryUpload | FileUpload): void => {
            if (entry instanceof DirectoryUpload) {
                entry.getChildrens().forEach(child => visit(child))
                return
            }
            stats.totalSize += entry.getSize()
        }

        transfer.getChildrens().forEach(child => visit(child))
        return stats
    }

    private updateFilteredList (): void {
        const filterText = this.filterText.toLowerCase()
        const applyFilter = <T extends { name: string }>(items: T[]): T[] =>
            items.filter(item => item.name.toLowerCase().includes(filterText))

        if (!this.fileList) {
            this.filteredFileList = []
        } else if (!this.showFilter || this.filterText.trim() === '') {
            this.filteredFileList = this.fileList
        } else {
            this.filteredFileList = applyFilter(this.fileList)
        }

        if (!this.localFileList) {
            this.filteredLocalFileList = []
        } else if (!this.showFilter || this.filterText.trim() === '') {
            this.filteredLocalFileList = this.localFileList
        } else {
            this.filteredLocalFileList = applyFilter(this.localFileList)
        }
    }

    private sortEntries<T extends { isDirectory: boolean, name: string }> (items: T[]): void {
        const dirKey = (a: T) => a.isDirectory ? 1 : 0
        items.sort((a, b) =>
            dirKey(b) - dirKey(a) ||
            a.name.localeCompare(b.name),
        )
    }

    private updateLocalPathSegments (): void {
        if (!this.localPath) {
            this.localPathSegments = []
            return
        }

        const parsed = localPath.parse(this.localPath)
        const segments: PathSegment[] = []
        let currentPath = this.localPath

        while (currentPath !== parsed.root) {
            segments.unshift({
                name: localPath.basename(currentPath),
                path: currentPath,
            })
            const parentPath = localPath.dirname(currentPath)
            if (parentPath === currentPath) {
                break
            }
            currentPath = parentPath
        }

        if (parsed.root) {
            segments.unshift({
                name: parsed.root,
                path: parsed.root,
            })
        }

        this.localPathSegments = segments
    }

}
