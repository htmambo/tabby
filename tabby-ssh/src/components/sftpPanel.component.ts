import * as C from 'constants'
import * as localPath from 'path'
import { posix as path } from 'path'
import { Component, Input, Output, EventEmitter, Inject, Optional } from '@angular/core'
import { FileUpload, DirectoryUpload, DirectoryDownload, MenuItemOptions, NotificationsService, PlatformService, LocalFileEntry } from 'tabby-core'
import { SFTPSession, SFTPFile } from '../session/sftp'
import { SSHSession } from '../session/ssh'
import { SFTPContextMenuItemProvider } from '../api'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { SFTPCreateDirectoryModalComponent } from './sftpCreateDirectoryModal.component'

interface PathSegment {
    name: string
    path: string
}

@Component({
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
    @Output() pathChange = new EventEmitter<string>()
    pathSegments: PathSegment[] = []
    localPath = ''
    localPathSegments: PathSegment[] = []
    @Input() cwdDetectionAvailable = false
    editingPath: string|null = null
    showFilter = false
    filterText = ''
    selectedLocalItemPath: string|null = null
    private localClickTimer: ReturnType<typeof setTimeout>|null = null
    private readonly localSingleClickDelayMs = 300

    constructor (
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        public platform: PlatformService,
        @Optional() @Inject(SFTPContextMenuItemProvider) protected contextMenuProviders: SFTPContextMenuItemProvider[],
    ) {
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
        this.sftp = await this.session.openSFTP()
        try {
            await this.navigate(this.path)
        } catch (error) {
            console.warn('Could not navigate to', this.path, ':', error)
            this.notifications.error(error.message)
            await this.navigate('/')
        }

        if (this.showLocalPanel) {
            try {
                const defaultLocalDirectory = await this.platform.getDefaultLocalDirectory()
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

        this.clearFilter()

        let p = newPath
        this.pathSegments = []
        while (p !== '/') {
            this.pathSegments.unshift({
                name: path.basename(p),
                path: p,
            })
            p = path.dirname(p)
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
        this.selectedLocalItemPath = null
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

    onLocalItemClick (item: LocalFileEntry): void {
        this.selectedLocalItemPath = item.fullPath
        this.scheduleLocalSingleClick(item)
    }

    async onLocalItemDoubleClick (item: LocalFileEntry): Promise<void> {
        this.clearLocalClickTimer()
        await this.uploadLocalItem(item)
    }

    async uploadLocalItem (item: LocalFileEntry): Promise<void> {
        try {
            if (item.isDirectory) {
                const transfer = await this.platform.startUploadDirectory([item.fullPath])
                await this.uploadOneFolder(transfer)
            } else {
                const transfers = await this.platform.startUpload({ multiple: false }, [item.fullPath])
                if (!transfers.length) {
                    return
                }
                await this.uploadOne(transfers[0])
            }
            this.notifications.notice(`Uploaded ${item.name}`)
        } catch (error) {
            this.notifications.error(`Failed to upload ${item.name}: ${error.message}`)
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

    async openCreateDirectoryModal (): Promise<void> {
        const modal = this.ngbModal.open(SFTPCreateDirectoryModalComponent)
        const directoryName = await modal.result.catch(() => null)
        if (directoryName?.trim()) {
            this.sftp.mkdir(path.join(this.path, directoryName)).then(() => {
                this.notifications.notice('The directory was created successfully')
                this.navigate(path.join(this.path, directoryName))
            }).catch(() => {
                this.notifications.error('The directory could not be created')
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

    async uploadOneFolder (transfer: DirectoryUpload, accumPath = ''): Promise<void> {
        const savedPath = this.path
        for(const t of transfer.getChildrens()) {
            if (t instanceof DirectoryUpload) {
                try {
                    await this.sftp.mkdir(path.posix.join(this.path, accumPath, t.getName()))
                } catch {
                    // Intentionally ignoring errors from making duplicate dirs.
                }
                await this.uploadOneFolder(t, path.posix.join(accumPath, t.getName()))
            } else {
                await this.sftp.upload(path.posix.join(this.path, accumPath, t.getName()), t)
            }
        }
        if (this.path === savedPath) {
            await this.navigate(this.path)
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
        const transfer = await this.platform.startDownload(path.basename(itemPath), mode, size)
        if (!transfer) {
            return
        }
        this.sftp.download(itemPath, transfer)
    }

    async downloadFolder (folder: SFTPFile): Promise<void> {
        try {
            const transfer = await this.platform.startDownloadDirectory(folder.name, 0)
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
            this.notifications.error(`Failed to download folder: ${error.message}`)
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
        let items: MenuItemOptions[] = []
        for (const section of await Promise.all(this.contextMenuProviders.map(x => x.getItems(item, this)))) {
            items.push({ type: 'separator' })
            items = items.concat(section)
        }
        return items.slice(1)
    }

    async showContextMenu (item: SFTPFile, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.platform.popupContextMenu(await this.buildContextMenu(item), event)
    }

    async buildLocalContextMenu (item: LocalFileEntry): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: () => this.uploadLocalItem(item),
                label: 'Upload',
            },
            {
                click: () => this.platform.setClipboard({
                    text: item.fullPath,
                }),
                label: 'Copy full path',
            },
        ]

        if (item.isDirectory) {
            items.unshift({
                click: () => this.openLocal(item),
                label: 'Open directory',
            })
        }

        return items
    }

    async showLocalContextMenu (item: LocalFileEntry, event: MouseEvent): Promise<void> {
        event.preventDefault()
        this.clearLocalClickTimer()
        this.selectedLocalItemPath = item.fullPath
        this.platform.popupContextMenu(await this.buildLocalContextMenu(item), event)
    }

    private scheduleLocalSingleClick (item: LocalFileEntry): void {
        this.clearLocalClickTimer()
        this.localClickTimer = setTimeout(() => {
            this.localClickTimer = null
            if (!item.isDirectory) {
                return
            }
            void this.openLocal(item)
        }, this.localSingleClickDelayMs)
    }

    private clearLocalClickTimer (): void {
        if (this.localClickTimer === null) {
            return
        }
        clearTimeout(this.localClickTimer)
        this.localClickTimer = null
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
