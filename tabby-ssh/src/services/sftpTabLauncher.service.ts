import * as russh from 'russh'
import colors from 'ansi-colors'
import { Injectable, Injector } from '@angular/core'
import { AppService, NotificationsService, PartialProfile, PlatformService, ProfilesService, TranslateService } from 'tabby-core'

import { SSHProfile } from '../api'
import { SFTPTabComponent } from '../components/sftpTab.component'
import { SSHSession } from '../session/ssh'
import { SSHMultiplexerService } from './sshMultiplexer.service'
import { resolveSFTPLocalStartPath, resolveSFTPRemoteStartPath } from '../sftpPathSettings'

@Injectable({ providedIn: 'root' })
export class SFTPTabLauncherService {
    constructor (
        private injector: Injector,
        private app: AppService,
        private notifications: NotificationsService,
        private profilesService: ProfilesService,
        private sshMultiplexer: SSHMultiplexerService,
        private platform: PlatformService,
        private translate: TranslateService,
    ) { }

    async openForProfile (profile: PartialProfile<SSHProfile>): Promise<void> {
        try {
            const fullProfile = this.profilesService.getConfigProxyForProfile(profile)
            const sshSession = await this.createSession(fullProfile)
            const initialLocalPath = await resolveSFTPLocalStartPath(this.platform, fullProfile)

            this.app.openNewTabRaw({
                type: SFTPTabComponent,
                inputs: {
                    profile: fullProfile,
                    sshSession,
                    path: resolveSFTPRemoteStartPath(fullProfile, '/'),
                    initialLocalPath,
                    cwdDetectionAvailable: false,
                },
            })
        } catch (error) {
            this.notifications.error(error instanceof Error ? error.message : this.translate.instant('Unable to connect SFTP'))
        }
    }

    private async createSession (profile: SSHProfile, multiplex = true): Promise<SSHSession> {
        let session = await this.sshMultiplexer.getSession(profile)
        if (!multiplex || !session || !profile.options.reuseSession) {
            session = new SSHSession(this.injector, profile)

            if (profile.options.jumpHost) {
                const jumpConnection = (await this.profilesService.getProfiles()).find(x => x.id === profile.options.jumpHost)

                if (!jumpConnection) {
                    throw new Error(`${profile.options.host}: jump host "${profile.options.jumpHost}" not found in your config`)
                }

                const jumpSession = await this.createSession(
                    this.profilesService.getConfigProxyForProfile<SSHProfile>(jumpConnection),
                )

                jumpSession.ref()
                session.willDestroy$.subscribe(() => jumpSession.unref())
                jumpSession.willDestroy$.subscribe(() => {
                    if (session?.open) {
                        session.destroy()
                    }
                })

                if (!(jumpSession.ssh instanceof russh.AuthenticatedSSHClient)) {
                    throw new Error('Jump session is not authenticated yet somehow')
                }
                const jumpSSH: russh.AuthenticatedSSHClient = jumpSession.ssh

                try {
                    session.jumpChannel = await jumpSSH.openTCPForwardChannel({
                        addressToConnectTo: profile.options.host,
                        portToConnectTo: profile.options.port ?? 22,
                        originatorAddress: '127.0.0.1',
                        originatorPort: 0,
                    })
                } catch (error) {
                    jumpSession.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Could not set up port forward on {name}', {
                        name: jumpConnection.name,
                    }))
                    throw error
                }
            }
        }

        if (!session.open) {
            try {
                await session.start()
                await this.sshMultiplexer.addSession(session)
            } catch (error) {
                await session.destroy().catch(() => null)
                throw error
            }
        }

        return session
    }
}
