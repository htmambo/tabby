import * as russh from 'russh'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import colors from 'ansi-colors'
import { Component, Injector, HostListener, HostBinding } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { GetRecoveryTokenOptions, Platform, ProfilesService, RecoveryToken } from 'tabby-core'
import { BaseTerminalTabComponent, ConnectableTerminalTabComponent } from 'tabby-terminal'
import { SSHService } from '../services/ssh.service'
import { KeyboardInteractivePrompt, SSHSession } from '../session/ssh'
import { SSHPortForwardingModalComponent } from './sshPortForwardingModal.component'
import { SSHProfile } from '../api'
import { SSHShellSession } from '../session/shell'
import { SSHMultiplexerService } from '../services/sshMultiplexer.service'
import { SFTPTabComponent } from './sftpTab.component'
import { resolveSFTPLocalStartPath, resolveSFTPRemoteStartPath } from '../sftpPathSettings'

/** @hidden */
@Component({
    standalone: false,
    selector: 'ssh-tab',
    template: `${BaseTerminalTabComponent.template} ${require('./sshTab.component.pug')}`,
    styles: [
        ...BaseTerminalTabComponent.styles,
        require('./sshTab.component.scss'),
    ],
    animations: BaseTerminalTabComponent.animations,
})
export class SSHTabComponent extends ConnectableTerminalTabComponent<SSHProfile> {
    Platform = Platform
    sshSession: SSHSession|null = null
    session: SSHShellSession|null = null
    sftpPanelVisible = false
    sftpPath = '/'
    sftpInitialLocalPath: string|null = null
    sftpPanelHeight = 320
    sftpPanelResizing = false
    enableToolbar = true
    activeKIPrompt: KeyboardInteractivePrompt|null = null
    readonly minSFTPPanelHeight = 160
    private readonly minSSHPanelHeight = 120
    private currentTerminalDirectoryProbe: Promise<string|null>|null = null
    private lastTerminalOutputAt = 0
    private sftpResizeStartY = 0
    private sftpResizeInitialHeight = this.sftpPanelHeight
    private destroyedFlag = false
    private pendingProbeSleeps = new Map<number, () => void>()
    private sshPendingTimeouts = new Set<number>()

    @HostBinding('style.--sftp-panel-height.px')
    get sftpPanelHeightCSSVar (): number {
        return this.sftpPanelVisible && this.effectiveSFTPSession ? this.sftpPanelHeight : 0
    }

    @HostBinding('style.--sftp-panel-offset.px')
    get sftpPanelOffsetCSSVar (): number {
        return this.sftpPanelVisible && this.effectiveSFTPSession ? this.sftpPanelHeight + 10 : 0
    }

    get effectiveSFTPSession (): SSHSession|null {
        return this.sshSession ?? (this.session as any)?.ssh ?? null
    }

    constructor (
        injector: Injector,
        public ssh: SSHService,
        private ngbModal: NgbModal,
        private profilesService: ProfilesService,
        private sshMultiplexer: SSHMultiplexerService,
    ) {
        super(injector)
        this.sessionChanged$.subscribe(() => {
            this.activeKIPrompt = null
            this.lastTerminalOutputAt = Date.now()
            this.syncSFTPPanelAfterSessionChange()
        })
        this.subscribeUntilDestroyed(this.binaryOutput$, () => {
            this.lastTerminalOutputAt = Date.now()
        })
    }

    ngOnInit (): void {
        this.sftpPanelHeight = this.normalizeSFTPPanelHeight(this.sftpPanelHeight)
        this.sftpPath = this.sftpPath || '/'

        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, hotkey => {
            if (!this.hasFocus) {
                return
            }
            switch (hotkey) {
                case 'home':
                    this.sendInput('\x1bOH' )
                    break
                case 'end':
                    this.sendInput('\x1bOF' )
                    break
                case 'restart-ssh-session':
                    this.reconnect()
                    break
                case 'launch-winscp':
                    if (this.sshSession) {
                        this.ssh.launchWinSCP(this.sshSession)
                    }
                    break
            }
        })

        super.ngOnInit()
    }

    async setupOneSession (injector: Injector, profile: SSHProfile, multiplex = true): Promise<SSHSession> {
        let session = await this.sshMultiplexer.getSession(profile)
        if (!multiplex || !session || !profile.options.reuseSession) {
            session = new SSHSession(injector, profile)

            if (profile.options.jumpHost) {
                const jumpConnection = (await this.profilesService.getProfiles()).find(x => x.id === profile.options.jumpHost)

                if (!jumpConnection) {
                    throw new Error(`${profile.options.host}: jump host "${profile.options.jumpHost}" not found in your config`)
                }

                const jumpSession = await this.setupOneSession(
                    this.injector,
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

                try {
                    session.jumpChannel = await jumpSession.ssh.openTCPForwardChannel({
                        addressToConnectTo: profile.options.host,
                        portToConnectTo: profile.options.port ?? 22,
                        originatorAddress: '127.0.0.1',
                        originatorPort: 0,
                    })
                } catch (err) {
                    jumpSession.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Could not set up port forward on {name}', {
                        name: jumpConnection.name,
                    }))
                    throw err
                }
            }
        }

        this.attachSessionHandler(session.serviceMessage$, msg => {
            msg = msg.replace(/\n/g, '\r\n      ')
            this.write(`\r${colors.black.bgWhite(' SSH ')} ${msg}\r\n`)
        })

        this.attachSessionHandler(session.willDestroy$, () => {
            this.activeKIPrompt = null
        })

        this.attachSessionHandler(session.keyboardInteractivePrompt$, prompt => {
            this.activeKIPrompt = prompt
            this.scheduleSshTimeout(() => {
                this.frontend?.scrollToBottom()
            })
        })

        if (!session.open) {
            this.write('\r\n' + colors.black.bgWhite(' SSH ') + ` ` + this.translate.instant(_('Connecting to')) + ` ${session.profile.name}\r\n`)

            this.startSpinner(this.translate.instant(_('Connecting')))

            try {
                await session.start()
                await this.sshMultiplexer.addSession(session)
            } catch (error) {
                await session.destroy().catch(() => null)
                throw error
            } finally {
                this.stopSpinner()
            }
        }

        return session
    }

    protected onSessionDestroyed (): void {
        if (this.frontend) {
            // Session was closed abruptly
            this.write('\r\n' + colors.black.bgWhite(' SSH ') + ` ${this.translate.instant('{host}: session closed', {
                host: this.sshSession?.profile.options.host ?? '',
            })}\r\n`)

            super.onSessionDestroyed()
        }
    }

    private async initializeSessionMaybeMultiplex (multiplex = true): Promise<void> {
        this.sshSession = await this.setupOneSession(this.injector, this.profile, multiplex)
        const session = new SSHShellSession(
            this.injector,
            this.sshSession,
            this.profile,
        )

        this.setSession(session)
        this.attachSessionHandler(session.serviceMessage$, msg => {
            msg = msg.replace(/\n/g, '\r\n      ')
            this.write(`\r${colors.black.bgWhite(' SSH ')} ${msg}\r\n`)
            session.resize(this.size.columns, this.size.rows)
        })

        await session.start()
        this.session?.resize(this.size.columns, this.size.rows)
    }

    async initializeSession (): Promise<void> {
        await super.initializeSession()
        try {
            await this.initializeSessionMaybeMultiplex(true)
        } catch {
            try {
                await this.initializeSessionMaybeMultiplex(false)
            } catch (e) {
                console.error('SSH session initialization failed', e)
                this.write(colors.black.bgRed(' X ') + ' ' + colors.red(e.message) + '\r\n')
                return
            }
        }
    }

    async getRecoveryToken (options?: GetRecoveryTokenOptions): Promise<RecoveryToken> {
        const token = await super.getRecoveryToken(options)
        if (options?.includeState) {
            token.sftpPanelVisible = this.sftpPanelVisible
            token.sftpPanelHeight = this.normalizeSFTPPanelHeight(this.sftpPanelHeight)
        }
        return token
    }

    showPortForwarding (): void {
        const modal = this.ngbModal.open(SSHPortForwardingModalComponent).componentInstance as SSHPortForwardingModalComponent
        modal.session = this.sshSession!
    }

    async canClose (): Promise<boolean> {
        if (!this.session?.open) {
            return true
        }
        if (!this.profile.options.warnOnClose) {
            return true
        }
        return (await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant(_('Disconnect from {host}?'), this.profile.options),
                buttons: [
                    this.translate.instant(_('Disconnect')),
                    this.translate.instant(_('Do not close')),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )).response === 0
    }

    async openSFTP (): Promise<void> {
        await this.prepareSFTPInitialPaths()
        const sftpSession = await this.resolveSFTPSession()
        if (!sftpSession) {
            return
        }

        this.scheduleSshTimeout(() => {
            if (!this.sshSession) {
                this.sshSession = sftpSession
            }
            this.sftpPanelVisible = true
            this.ensureSFTPPanelHeightInBounds()
            this.scheduleSshTimeout(() => this.ensureSFTPPanelHeightInBounds())
        }, 100)
    }

    async openSFTPTab (): Promise<void> {
        await this.prepareSFTPInitialPaths()
        const sftpSession = await this.resolveSFTPSession()
        if (!sftpSession) {
            return
        }

        this.app.openNewTabRaw({
            type: SFTPTabComponent,
            inputs: {
                profile: this.profile,
                sshSession: sftpSession,
                path: this.sftpPath,
                initialLocalPath: this.sftpInitialLocalPath,
                cwdDetectionAvailable: this.session?.supportsWorkingDirectory() ?? false,
            },
        })
    }

    closeSFTP (): void {
        this.sftpPanelVisible = false
        this.sftpPanelResizing = false
    }

    startSFTPResize (event: MouseEvent): void {
        if (!this.sftpPanelVisible) {
            return
        }

        this.sftpPanelResizing = true
        this.sftpResizeStartY = event.clientY
        this.sftpResizeInitialHeight = this.sftpPanelHeight
        event.preventDefault()
        event.stopPropagation()
    }

    @HostListener('document:mousemove', ['$event'])
    onDocumentMouseMove (event: MouseEvent): void {
        if (!this.sftpPanelResizing) {
            return
        }

        const hostHeight = this.element.nativeElement.clientHeight
        if (!hostHeight) {
            return
        }

        const delta = this.sftpResizeStartY - event.clientY
        const maxSFTPPanelHeight = Math.max(this.minSFTPPanelHeight, hostHeight - this.minSSHPanelHeight)
        const targetHeight = this.sftpResizeInitialHeight + delta
        this.sftpPanelHeight = Math.min(maxSFTPPanelHeight, Math.max(this.minSFTPPanelHeight, targetHeight))
        event.preventDefault()
    }

    @HostListener('document:mouseup')
    onDocumentMouseUp (): void {
        if (!this.sftpPanelResizing) {
            return
        }
        this.sftpPanelResizing = false
    }

    @HostListener('window:resize')
    onWindowResize (): void {
        this.ensureSFTPPanelHeightInBounds()
    }

    private ensureSFTPPanelHeightInBounds (): void {
        if (!this.sftpPanelVisible) {
            return
        }

        const hostHeight = this.element.nativeElement.clientHeight
        if (!hostHeight) {
            return
        }

        const maxSFTPPanelHeight = Math.max(this.minSFTPPanelHeight, hostHeight - this.minSSHPanelHeight)
        this.sftpPanelHeight = Math.min(maxSFTPPanelHeight, Math.max(this.minSFTPPanelHeight, this.sftpPanelHeight))
    }

    private normalizeSFTPPanelHeight (height: unknown): number {
        const normalizedHeight = Number(height)
        if (!Number.isFinite(normalizedHeight)) {
            return 320
        }
        return Math.max(this.minSFTPPanelHeight, Math.round(normalizedHeight))
    }

    private syncSFTPPanelAfterSessionChange (): void {

        if (!this.sftpPanelVisible || !this.effectiveSFTPSession) {
            return
        }

        this.scheduleSshTimeout(() => {
            if (!this.sftpPanelVisible || !this.effectiveSFTPSession) {
                return
            }
            this.ensureSFTPPanelHeightInBounds()
            this.scheduleSshTimeout(() => this.ensureSFTPPanelHeightInBounds())
        }, 100)
    }

    private async prepareSFTPInitialPaths (): Promise<void> {
        if (!this.sftpPath || this.sftpPath === '/') {
            const currentTerminalDirectory = await this.getCurrentTerminalDirectory()
            if (currentTerminalDirectory) {
                this.sftpPath = currentTerminalDirectory
            } else {
                this.sftpPath = resolveSFTPRemoteStartPath(
                    this.profile,
                    this.sftpPath,
                )
            }
        }

        this.sftpInitialLocalPath = await resolveSFTPLocalStartPath(this.platform, this.profile)
    }

    private async getCurrentTerminalDirectory (): Promise<string|null> {
        if (!this.session?.open) {
            return null
        }

        const workingDirectory = await this.session.getWorkingDirectory()
        const normalizedWorkingDirectory = workingDirectory?.trim()
        if (normalizedWorkingDirectory) {
            return normalizedWorkingDirectory
        }

        return this.probeCurrentTerminalDirectory()
    }

    private async probeCurrentTerminalDirectory (): Promise<string|null> {
        if (this.currentTerminalDirectoryProbe) {
            return this.currentTerminalDirectoryProbe
        }

        if (!this.canProbeCurrentTerminalDirectory()) {
            return null
        }

        this.currentTerminalDirectoryProbe = this.runCurrentTerminalDirectoryProbe()
        try {
            return await this.currentTerminalDirectoryProbe
        } finally {
            this.currentTerminalDirectoryProbe = null
        }
    }

    private canProbeCurrentTerminalDirectory (): boolean {
        if (!this.session?.open || this.frontend?.isAlternateScreenActive()) {
            return false
        }

        const lastRecentInput = this.recentInputs.slice(-1)
        if (!lastRecentInput) {
            return true
        }

        return lastRecentInput === '\r' || lastRecentInput === '\n'
    }

    private async runCurrentTerminalDirectoryProbe (): Promise<string|null> {
        if (!await this.waitForTerminalQuiet(150, 1000)) {
            return null
        }

        const knownWorkingDirectory = (await this.session?.getWorkingDirectory())?.trim() ?? null
        const hiddenProbeResult = await this.runShellCurrentDirectoryProbe(
            ' printf \'\\033[1A\\r\\033[2K\\r\\033]1337;CurrentDir=%s\\007\' "$PWD"\r',
            knownWorkingDirectory,
        )
        if (hiddenProbeResult) {
            return hiddenProbeResult
        }

        return this.runShellCurrentDirectoryProbe(
            ' printf \'\\033]1337;CurrentDir=%s\\007\' "$PWD"\r',
            knownWorkingDirectory,
        )
    }

    private async waitForTerminalQuiet (quietWindowMs: number, timeoutMs: number): Promise<boolean> {
        const deadline = Date.now() + timeoutMs

        while (Date.now() < deadline) {
            if (this.shouldAbortDirectoryProbe()) {
                return false
            }
            const quietForMs = Date.now() - this.lastTerminalOutputAt
            if (quietForMs >= quietWindowMs) {
                return true
            }
            await this.sleepForProbe(50)
        }

        return false
    }

    private async runShellCurrentDirectoryProbe (command: string, knownWorkingDirectory: string|null): Promise<string|null> {
        if (this.shouldAbortDirectoryProbe()) {
            return null
        }
        if (!this.session?.open) {
            return null
        }

        this.session.write(Buffer.from(command, 'utf-8'))
        return this.waitForWorkingDirectoryUpdate(knownWorkingDirectory, 1000)
    }

    private async waitForWorkingDirectoryUpdate (knownWorkingDirectory: string|null, timeoutMs: number): Promise<string|null> {
        const probeDeadline = Date.now() + timeoutMs

        while (Date.now() < probeDeadline) {
            if (this.shouldAbortDirectoryProbe()) {
                return null
            }
            await this.sleepForProbe(50)
            const workingDirectory = (await this.session?.getWorkingDirectory())?.trim() ?? null
            if (workingDirectory && workingDirectory !== knownWorkingDirectory) {
                return workingDirectory
            }
        }

        return (await this.session?.getWorkingDirectory())?.trim() ?? null
    }

    private shouldAbortDirectoryProbe (): boolean {
        return this.destroyedFlag || !this.session?.open
    }

    private async resolveSFTPSession (): Promise<SSHSession|null> {
        if (!this.effectiveSFTPSession) {
            this.sshSession = await this.sshMultiplexer.getSession(this.profile)
        }

        const sftpSession = this.effectiveSFTPSession
        if (!sftpSession) {
            this.notifications.error(this.translate.instant(_('Cannot open SFTP panel: SSH session is unavailable')))
            return null
        }
        return sftpSession
    }

    @HostListener('document:keydown.escape', ['$event'])
    onEscape (event: KeyboardEvent): void {
        if (!this.sftpPanelVisible) {
            return
        }
        this.closeSFTP()
        event.stopPropagation()
    }

    protected isSessionExplicitlyTerminated (): boolean {
        return super.isSessionExplicitlyTerminated() ||
        this.recentInputs.charCodeAt(this.recentInputs.length - 1) === 4 ||
        this.recentInputs.endsWith('exit\r')
    }

    ngOnDestroy (): void {
        this.destroyedFlag = true
        for (const [handle, resolve] of this.pendingProbeSleeps) {
            window.clearTimeout(handle)
            resolve()
        }
        this.pendingProbeSleeps.clear()
        this.clearSshPendingTimeouts()
        super.ngOnDestroy()
    }

    private sleepForProbe (delayMs: number): Promise<void> {
        if (this.destroyedFlag) {
            return Promise.resolve()
        }
        return new Promise(resolve => {
            const handle = window.setTimeout(() => {
                this.pendingProbeSleeps.delete(handle)
                resolve()
            }, delayMs)
            this.pendingProbeSleeps.set(handle, resolve)
        })
    }

    private scheduleSshTimeout (fn: () => void, delay = 0): void {
        if (this.destroyedFlag) {
            return
        }
        const handle = window.setTimeout(() => {
            this.sshPendingTimeouts.delete(handle)
            if (this.destroyedFlag) {
                return
            }
            fn()
        }, delay)
        this.sshPendingTimeouts.add(handle)
    }

    private clearSshPendingTimeouts (): void {
        for (const handle of this.sshPendingTimeouts) {
            window.clearTimeout(handle)
        }
        this.sshPendingTimeouts.clear()
    }
}
