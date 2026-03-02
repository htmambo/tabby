import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Component, Input, Injector } from '@angular/core'
import { BaseTabComponent, TranslateService } from 'tabby-core'
import { SSHProfile } from '../api'
import { SSHSession } from '../session/ssh'

/** @hidden */
@Component({
    selector: 'sftp-tab',
    templateUrl: './sftpTab.component.pug',
    styleUrls: ['./sftpTab.component.scss'],
})
export class SFTPTabComponent extends BaseTabComponent {
    @Input() profile: SSHProfile|null = null
    @Input() sshSession: SSHSession|null = null
    @Input() path = '/'
    @Input() cwdDetectionAvailable = false
    errorMessage: string|null = null

    constructor (
        injector: Injector,
        private translate: TranslateService,
    ) {
        super(injector)
    }

    ngOnInit (): void {
        const profileName = this.profile?.name.trim() ?? ''
        const host = this.profile?.options.host.trim() ?? ''
        const target = profileName !== '' ? profileName : host
        const title = target !== '' ? `SFTP: ${target}` : 'SFTP'
        this.setTitle(title)
        this.icon = 'far fa-folder-open'

        if (!this.sshSession) {
            this.errorMessage = this.translate.instant(_('Cannot open SFTP panel: SSH session is unavailable'))
        }
    }

    close (): void {
        this.destroy()
    }
}
