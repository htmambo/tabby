import { Component, ViewChild, ElementRef } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, focusElementLater } from 'tabby-core'
import { SFTPFile, SFTPSession } from '../session/sftp'
import { SSHSession } from '../session/ssh'

function escapePOSIXShellArgument (value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`
}

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './sftpDeleteModal.component.pug',
})
export class SFTPDeleteModalComponent extends BaseComponent {
    sftp: SFTPSession
    item: SFTPFile
    sshSession?: SSHSession
    progressMessage = ''
    cancelled = false
    @ViewChild('cancelButton', { static: true }) cancelButton: ElementRef<HTMLButtonElement>

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

    async ngOnInit (): Promise<void> {
        this.destroyed$.subscribe(() => this.cancel())
        focusElementLater(this.cancelButton)
        await this.run(this.item)
        this.modalInstance.close()
    }

    cancel (): void {
        this.cancelled = true
        this.modalInstance.close()
    }

    async run (file: SFTPFile): Promise<void> {
        if (this.cancelled) {
            return
        }

        this.progressMessage = file.fullPath

        if (file.isDirectory && this.sshSession) {
            const deleted = await this.tryDeleteDirectoryFast(file)
            if (deleted || this.cancelled) {
                return
            }
        }

        await this.deleteRecursively(file)
    }

    private async tryDeleteDirectoryFast (file: SFTPFile): Promise<boolean> {
        try {
            await this.sshSession?.executePOSIXCommand(`rm -rf -- ${escapePOSIXShellArgument(file.fullPath)}`)
            return true
        } catch (error) {
            console.warn('Fast remote directory delete failed, falling back to SFTP traversal:', error)
            return false
        }
    }

    private async deleteRecursively (file: SFTPFile): Promise<void> {
        if (this.cancelled) {
            return
        }

        if (file.isDirectory) {
            for (const child of await this.sftp.readdir(file.fullPath)) {
                await this.deleteRecursively(child)
                if (this.cancelled) {
                    return
                }
            }
            await this.sftp.rmdir(file.fullPath)
            return
        }

        await this.sftp.unlink(file.fullPath)
    }
}
