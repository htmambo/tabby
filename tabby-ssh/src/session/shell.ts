import { Observable, Subject } from 'rxjs'
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

    constructor (
        injector: Injector,
        ssh: SSHSession,
        private profile: SSHProfile,
    ) {
        super(injector.get(LogService).create(`ssh-shell-${profile.options.host}-${profile.options.port}`))
        this.translate = injector.get(TranslateService)
        this.ssh = ssh
        this.setLoginScriptsOptions(this.profile.options)
        this.ssh.serviceMessage$.subscribe(m => this.serviceMessage.next(m))
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

        this.ssh.willDestroy$.subscribe(() => {
            this.destroy()
        })

        this.open = true
        this.logger.debug('Shell open')

        this.loginScriptProcessor?.executeUnconditionalScripts()

        this.shell.data$.subscribe({
            next: data => {
                this.emitOutput(Buffer.from(data))
            },
            error: err => {
                this.logger.warn('Shell stream error:', err)
                this.handleShellEnd('stream error')
            },
        })

        this.shell.eof$.subscribe(() => {
            this.handleShellEnd('EOF')
        })

        this.shell.closed$.subscribe(() => {
            this.handleShellEnd('close')
        })
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }

    resize (columns: number, rows: number): void {
        this.shell?.resizePTY({
            columns,
            rows,
            pixHeight: 0,
            pixWidth: 0,
        }).catch(err => {
            this.logger.warn('Shell resize failed:', err)
            this.handleShellEnd('resize failure')
        })
    }

    write (data: Buffer): void {
        if (this.shell) {
            this.shell.write(new Uint8Array(data)).catch(err => {
                this.logger.warn('Shell write failed:', err)
                this.handleShellEnd('write failure')
            })
        }
    }

    kill (_signal?: string): void {
        // this.shell?.signal(signal ?? 'TERM')
    }

    async destroy (): Promise<void> {
        this.logger.debug('Closing shell')
        this.shellEnded = true
        this.serviceMessage.complete()
        this.kill()
        this.ssh?.unref()
        this.ssh = null
        await super.destroy()
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
        this.logger.info(`Shell session ended (${reason})`)
        void this.destroy()
    }
}
