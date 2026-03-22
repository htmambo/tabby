import { Observable, Subject, Subscription } from 'rxjs'
import stripAnsi from 'strip-ansi'
import { Injector } from '@angular/core'
import { LogService, TranslateService } from 'tabby-core'
import { BaseSession, UTF8SplitterMiddleware, InputProcessor } from 'tabby-terminal'
import { SSHSession } from './ssh'
import { SSHProfile } from '../api'
import * as russh from 'russh'


export class SSHShellSession extends BaseSession {
    shell?: russh.Channel
    get serviceMessage$ (): Observable<string> { return this.serviceMessage }
    private serviceMessage = new Subject<string>()
    private ssh: SSHSession|null
    private shellEnded = false
    private translate: TranslateService
    private subscriptions = new Subscription()
    private destroyPromise: Promise<void> | null = null

    constructor (
        injector: Injector,
        ssh: SSHSession,
        private profile: SSHProfile,
    ) {
        super(injector.get(LogService).create(`ssh-shell-${profile.options.host}-${profile.options.port}`))
        this.translate = injector.get(TranslateService)
        this.ssh = ssh
        this.setLoginScriptsOptions(this.profile.options)
        this.subscriptions.add(this.ssh.serviceMessage$.subscribe(m => this.serviceMessage.next(m)))
        this.middleware.push(new UTF8SplitterMiddleware())
        this.middleware.push(new InputProcessor(profile.options.input))
    }

    async start (): Promise<void> {
        if (!this.ssh) {
            throw new Error('SSH session not set')
        }

        this.shellEnded = false
        this.ssh.ref()

        this.logger.debug('Opening shell')

        try {
            this.shell = await this.ssh.openShellChannel({ x11: this.profile.options.x11 })
        } catch (err) {
            this.ssh.unref()
            if (err.toString().includes('Unable to request X11')) {
                this.emitServiceMessage('    ' + this.translate.instant('Make sure `xauth` is installed on the remote side'))
            }
            throw new Error(this.translate.instant('Remote rejected opening a shell channel: {error}', { error: `${err}` }))
        }

        this.subscriptions.add(this.ssh.willDestroy$.subscribe(() => {
            void this.destroy()
        }))

        this.open = true
        this.logger.debug('Shell open')

        this.loginScriptProcessor?.executeUnconditionalScripts()

        this.subscriptions.add(this.shell.data$.subscribe({
            next: (data: Uint8Array) => {
                this.emitOutput(Buffer.from(data))
            },
            error: (err: unknown) => {
                this.logger.warn('Shell stream error:', err)
                this.handleShellEnd('stream error')
            },
        }))

        this.subscriptions.add(this.shell.eof$.subscribe(() => {
            this.handleShellEnd('EOF')
        }))

        this.subscriptions.add(this.shell.closed$.subscribe(() => {
            this.handleShellEnd('close')
        }))
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.debug(stripAnsi(msg))
    }

    resize (columns: number, rows: number): void {
        this.shell?.resizePTY({
            columns,
            rows,
            pixHeight: 0,
            pixWidth: 0,
        }).catch((err: unknown) => {
            this.logger.warn('Shell resize failed:', err)
            this.handleShellEnd('resize failure')
        })
    }

    write (data: Buffer): void {
        if (this.shell) {
            this.shell.write(new Uint8Array(data)).catch((err: unknown) => {
                this.logger.warn('Shell write failed:', err)
                this.handleShellEnd('write failure')
            })
        }
    }

    kill (_signal?: string): void {
        void this.closeShellChannel()
    }

    async destroy (): Promise<void> {
        if (this.destroyPromise) {
            return this.destroyPromise
        }

        this.destroyPromise = this.performDestroy()
        return this.destroyPromise
    }

    async getChildProcesses (): Promise<any[]> {
        return []
    }

    async gracefullyKillProcess (): Promise<void> {
        this.kill('TERM')
    }

    supportsWorkingDirectory (): boolean {
        return !!this.reportedCWD
    }

    async getWorkingDirectory (): Promise<string|null> {
        return this.reportedCWD ?? null
    }

    private handleShellEnd (reason: string): void {
        if (!this.open || this.shellEnded) {
            return
        }
        this.shellEnded = true
        this.logger.debug(`Shell session ended (${reason})`)
        void this.destroy()
    }

    private async performDestroy (): Promise<void> {
        this.logger.debug('Closing shell')
        this.shellEnded = true

        const ssh = this.ssh
        this.ssh = null

        this.subscriptions.unsubscribe()
        this.serviceMessage.complete()
        await this.closeShellChannel()

        ssh?.unref()
        await super.destroy()
    }

    private async closeShellChannel (): Promise<void> {
        const shell = this.shell
        this.shell = undefined
        if (!shell) {
            return
        }

        try {
            await shell.eof()
        } catch (error) {
            this.logger.debug('Shell EOF failed during destroy:', error)
        }

        try {
            await shell.close()
        } catch (error) {
            this.logger.debug('Shell close failed during destroy:', error)
        }
    }
}
