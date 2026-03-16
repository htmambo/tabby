import { Injector } from '@angular/core'
import { HostAppService, ConfigService, WIN_BUILD_CONPTY_SUPPORTED, isWindowsBuild, Platform, BootstrapData, BOOTSTRAP_DATA, LogService, pathExists, resolveRealPath, getRuntimeEnv } from 'tabby-core'
import { BaseSession } from 'tabby-terminal'
import { SessionOptions, ChildProcess, PTYInterface, PTYProxy } from './api'

const windowsDirectoryRegex = /([a-zA-Z]:[^\:\[\]\?\"\<\>\|]+)/mi

/** @hidden */
export class Session extends BaseSession {
    private pty: PTYProxy|null = null
    private ptyClosed = false
    private pauseAfterExit = false
    private guessedCWD: string|null = null
    private initialCWD: string|null = null
    private config: ConfigService
    private hostApp: HostAppService
    private bootstrapData: BootstrapData
    private ptyInterface: PTYInterface

    constructor (
        injector: Injector,
    ) {
        super(injector.get(LogService).create('local'))
        this.config = injector.get(ConfigService)
        this.hostApp = injector.get(HostAppService)
        this.ptyInterface = injector.get(PTYInterface)
        this.bootstrapData = injector.get(BOOTSTRAP_DATA)
    }

    async start (options: SessionOptions): Promise<void> {
        let pty: PTYProxy|null = null

        if (options.restoreFromPTYID) {
            pty = await this.ptyInterface.restore(options.restoreFromPTYID)
            options.restoreFromPTYID = null
        }

        if (!pty) {
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            let cwd = options.cwd || getRuntimeEnv('HOME')

            if (cwd && !await pathExists(cwd)) {
                this.logger.debug('Ignoring non-existent CWD:', cwd)
                cwd = undefined
            }

            pty = await this.ptyInterface.spawn(options.command, options.args, {
                name: 'xterm-256color',
                cols: options.width ?? 80,
                rows: options.height ?? 30,
                encoding: null,
                cwd,
                env: {
                    COLORTERM: 'truecolor',
                    TERM: 'xterm-256color',
                    TERM_PROGRAM: 'Tabby',
                },
                tabbyProfileEnv: options.env,
                tabbyTerminalEnv: this.config.store.terminal.environment || {},
                tabbySetComSpec: this.hostApp.platform === Platform.Windows && this.config.store.terminal.setComSpec,
                tabbyExecutable: this.bootstrapData.executable,
                // `1` instead of `true` forces ConPTY even if unstable
                useConpty: isWindowsBuild(WIN_BUILD_CONPTY_SUPPORTED) && this.config.store.terminal.useConPTY ? 1 : false,
            })

            this.guessedCWD = cwd ?? null
        }

        this.pty = pty

        pty.getTruePID().then(async () => {
            this.initialCWD = await this.getWorkingDirectory()
        })

        this.open = true

        this.pty.subscribe('data', (array: Uint8Array) => {
            this.pty!.ackData(array.length)
            const data = Buffer.from(array)
            this.emitOutput(data)
            if (this.hostApp.platform === Platform.Windows) {
                this.guessWindowsCWD(data.toString())
            }
        })

        this.pty.subscribe('exit', () => {
            if (this.pauseAfterExit) {
                return
            } else if (this.open) {
                this.destroy()
            }
        })

        this.pty.subscribe('close', () => {
            this.ptyClosed = true
            if (this.pauseAfterExit) {
                this.emitOutput(Buffer.from('\r\nPress any key to close\r\n'))
            } else if (this.open) {
                this.destroy()
            }
        })

        this.pauseAfterExit = options.pauseAfterExit

        this.destroyed$.subscribe(() => this.pty!.unsubscribeAll())
    }

    getID (): string|null {
        return this.pty?.getID() ?? null
    }

    resize (columns: number, rows: number): void {
        this.pty?.resize(columns, rows)
    }

    write (data: Buffer): void {
        if (this.ptyClosed) {
            this.destroy()
        }
        if (this.open) {
            this.pty?.write(data)
        }
    }

    kill (signal?: string): void {
        this.pty?.kill(signal)
    }

    async getChildProcesses (): Promise<ChildProcess[]> {
        return this.pty?.getChildProcesses() ?? []
    }

    async gracefullyKillProcess (): Promise<void> {
        if (this.hostApp.platform === Platform.Windows) {
            this.kill()
        } else {
            await new Promise<void>((resolve) => {
                this.kill('SIGTERM')
                const timer = setTimeout(async () => {
                    try {
                        if (await this.pty!.exists()) {
                            // PTY process is still alive after SIGTERM, force it down.
                            this.kill('SIGKILL')
                        }
                        resolve()
                    } catch {
                        resolve()
                    }
                }, 500)
                if (typeof (timer as any)?.unref === 'function') {
                    (timer as any).unref()
                }
            })
        }
    }

    supportsWorkingDirectory (): boolean {
        return !!(this.initialCWD ?? this.reportedCWD ?? this.guessedCWD)
    }

    async getWorkingDirectory (): Promise<string|null> {
        if (this.reportedCWD) {
            return this.reportedCWD
        }
        let cwd: string|null = null
        try {
            cwd = await this.pty?.getWorkingDirectory() ?? null
        } catch (exc) {
            console.debug('Could not read working directory:', exc)
        }

        if (cwd) {
            cwd = await resolveRealPath(cwd) ?? cwd
        }

        if (this.hostApp.platform === Platform.Windows && (cwd === this.initialCWD || cwd === getRuntimeEnv('windir') || cwd === getRuntimeEnv('SystemRoot'))) {
            // shell doesn't truly change its process' CWD
            cwd = null
        }

        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        cwd = cwd || this.guessedCWD

        if (!cwd || !await pathExists(cwd)) {
            return null
        }
        return cwd
    }

    private guessWindowsCWD (data: string) {
        const match = windowsDirectoryRegex.exec(data)
        if (match) {
            this.guessedCWD = match[0]
        }
    }
}
