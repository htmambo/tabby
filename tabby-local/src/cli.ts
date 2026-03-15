import * as path from 'path'
import { access, lstat, stat } from 'node:fs/promises'
import { Injectable } from '@angular/core'
import { CLIHandler, CLIEvent, AppService, ConfigService, HostWindowService, ProfilesService, NotificationsService } from 'tabby-core'
import { TerminalService } from './services/terminal.service'

async function pathExists (targetPath: string): Promise<boolean> {
    try {
        await access(targetPath)
        return true
    } catch {
        return false
    }
}

async function tryLstat (targetPath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
    try {
        return await lstat(targetPath)
    } catch {
        return null
    }
}

@Injectable()
export class TerminalCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = 0

    constructor (
        private hostWindow: HostWindowService,
        private terminal: TerminalService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        const op = event.argv._[0]

        if (op === 'open') {
            this.handleOpenDirectory(path.resolve(event.cwd, event.argv.directory!))
        } else if (op === 'run') {
            this.handleRunCommand(event.argv.command!)
        } else {
            return false
        }

        return true
    }

    private async handleOpenDirectory (directory: string) {
        if (directory.length > 1 && (directory.endsWith('/') || directory.endsWith('\\'))) {
            directory = directory.substring(0, directory.length - 1)
        }
        if ((await pathExists(directory)) && (await stat(directory)).isDirectory()) {
            this.terminal.openTab(undefined, directory)
            this.hostWindow.bringToFront()
        }
    }

    private handleRunCommand (command: string[]) {
        this.terminal.openTab({
            type: 'local',
            name: '',
            options: {
                command: command[0],
                args: command.slice(1),
            },
        }, null, true)
        this.hostWindow.bringToFront()
    }
}


@Injectable()
export class OpenPathCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = -100

    constructor (
        private terminal: TerminalService,
        private profiles: ProfilesService,
        private hostWindow: HostWindowService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        const op = event.argv._[0]
        const opAsPath = op ? path.resolve(event.cwd, op) : null

        const profile = await this.terminal.getDefaultProfile()

        const opStats = opAsPath ? await tryLstat(opAsPath) : null
        if (opStats?.isDirectory()) {
            this.terminal.openTab(profile, opAsPath)
            this.hostWindow.bringToFront()
            return true
        }

        if (opAsPath && await pathExists(opAsPath)) {
            if (opAsPath.endsWith('.sh') || opAsPath.endsWith('.command')) {
                profile.options!.pauseAfterExit = true
                profile.options?.args?.push(opAsPath)
                this.terminal.openTab(profile)
                this.hostWindow.bringToFront()
                return true
            } else if (opAsPath.endsWith('.bat')) {
                const psProfile = (await this.profiles.getProfiles()).find(x => x.id === 'cmd')
                if (psProfile) {
                    psProfile.options!.pauseAfterExit = true
                    psProfile.options?.args?.push(opAsPath)
                    this.terminal.openTab(psProfile)
                    this.hostWindow.bringToFront()
                    return true
                }
            } else if (opAsPath.endsWith('.ps1')) {
                const cmdProfile = (await this.profiles.getProfiles()).find(x => x.id === 'powershell')
                if (cmdProfile) {
                    cmdProfile.options!.pauseAfterExit = true
                    cmdProfile.options?.args?.push(opAsPath)
                    this.terminal.openTab(cmdProfile)
                    this.hostWindow.bringToFront()
                    return true
                }
            } else {
                this.notifications.error('Cannot handle scripts of this type')
            }
        }

        return false
    }
}

@Injectable()
export class AutoOpenTabCLIHandler extends CLIHandler {
    firstMatchOnly = true
    priority = -1000

    constructor (
        private app: AppService,
        private config: ConfigService,
        private terminal: TerminalService,
    ) {
        super()
    }

    async handle (event: CLIEvent): Promise<boolean> {
        if (!event.secondInstance && this.config.store.terminal.autoOpen && !this.config.store.enableWelcomeTab) {
            this.app.ready$.subscribe(() => {
                if (this.app.tabs.length === 0) {
                    this.terminal.openTab()
                }
            })
            return true
        }
        return false
    }
}
