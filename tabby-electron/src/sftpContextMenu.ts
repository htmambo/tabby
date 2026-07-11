import { Injectable } from '@angular/core'
import { Subscription } from 'rxjs'
import { MenuItemOptions, TranslateService, chmodPath, readPathStat } from 'tabby-core'
import { SFTPFile, SFTPPanelComponent, SFTPContextMenuItemProvider, SFTPSession } from 'tabby-ssh'
import { ElectronPlatformService, resolveInsideBase } from './services/platform.service'
import { createTemporaryDirectory } from './utils/tempFiles'


/** @hidden */
@Injectable()
export class EditSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 0

    constructor (
        private translate: TranslateService,
        private platform: ElectronPlatformService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: () => this.platform.setClipboard({
                    text: item.fullPath,
                }),
                label: this.translate.instant('Copy full path'),
            },
        ]
        if (!item.isDirectory) {
            items.push({
                click: () => this.edit(item, panel.sftp),
                label: this.translate.instant('Edit locally'),
            })
        }
        return items
    }

    private async edit (item: SFTPFile, sftp: SFTPSession) {
const tempDir = await createTemporaryDirectory('tabby-sftp-')
        const tempPath = resolveInsideBase(tempDir.path, item.name)
        const transfer = await this.platform.startDownload(item.name, item.mode, item.size, tempPath)
        if (!transfer) {
            await tempDir.cleanup().catch(() => null)
            return
        }
        await sftp.download(item.fullPath, transfer)
        this.platform.openPath(tempPath)
        await chmodPath(tempPath, 0o700)

        let lastFingerprint = await this.getFileFingerprint(tempPath)
        let stopped = false
        let pollTimer: number | null = null
        let pollStartTimeout: number | null = null
        let pollInFlight = false
        let syncInFlight = false
        let syncPending = false
        let sftpCloseSubscription: Subscription | null = null

        const stopWatching = () => {
            if (stopped) {
                return
            }
            stopped = true
            if (pollStartTimeout !== null) {
                window.clearTimeout(pollStartTimeout)
                pollStartTimeout = null
            }
            if (pollTimer !== null) {
                window.clearInterval(pollTimer)
                pollTimer = null
            }
            if (sftpCloseSubscription) {
                sftpCloseSubscription.unsubscribe()
                sftpCloseSubscription = null
            }
            void tempDir.cleanup().catch(() => null)
        }

        const syncRemoteCopy = async () => {
            if (syncInFlight) {
                syncPending = true
                return
            }

            syncInFlight = true
            try {
                do {
                    syncPending = false

                    const upload = await this.platform.startUpload({ multiple: false }, [tempPath])
                    if (!upload.length) {
                        stopWatching()
                        return
                    }

                    await sftp.upload(item.fullPath, upload[0])
                    await sftp.chmod(item.fullPath, item.mode)
                    lastFingerprint = await this.getFileFingerprint(tempPath)
                } while (syncPending && !stopped)
            } finally {
                syncInFlight = false
            }
        }

        const pollForChanges = async () => {
            if (stopped || pollInFlight) {
                return
            }

            pollInFlight = true
            try {
                const fingerprint = await this.getFileFingerprint(tempPath)
                if (!fingerprint) {
                    stopWatching()
                    return
                }

                if (fingerprint === lastFingerprint) {
                    return
                }

                lastFingerprint = fingerprint
                await syncRemoteCopy()
            } finally {
                pollInFlight = false
            }
        }

        sftpCloseSubscription = sftp.closed$.subscribe(() => {
            stopWatching()
        })

        pollStartTimeout = window.setTimeout(() => {
            if (stopped) {
                return
            }
            pollStartTimeout = null
            pollTimer = window.setInterval(() => {
                void pollForChanges()
            }, 1000)
            if (typeof pollTimer === 'object' && typeof (pollTimer as any).unref === 'function') {
                (pollTimer as any).unref()
            }
        }, 1000)
        if (typeof pollStartTimeout === 'object' && typeof (pollStartTimeout as any).unref === 'function') {
            (pollStartTimeout as any).unref()
        }
    }

    private async getFileFingerprint (filePath: string): Promise<string | null> {
        const stat = await readPathStat(filePath)
        if (!stat || !stat.isFile) {
            return null
        }
        return `${stat.size}:${stat.mtimeMs}`
    }
}
