import { afterNextRender, Component, Injector, OnDestroy } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
import { PlatformService } from '../api/platform'
import { Command, CommandLocation } from '../api/commands'

interface StartPageCommand extends Command {
    safeIcon: SafeHtml
}

/** @hidden */
@Component({
    standalone: false,
    selector: 'start-page',
    templateUrl: './startPage.component.pug',
    styleUrls: ['./startPage.component.scss'],
})
export class StartPageComponent implements OnDestroy {
    appVersion: string
    commands: StartPageCommand[] = []
    private readonly startupCommandLoadDelay = 150
    private readonly startupHomeBaseInitDelay = 250
    private destroyed = false
    private loadCommandsTimeout: ReturnType<typeof setTimeout> | null = null
    private initHomeBaseTimeout: ReturnType<typeof setTimeout> | null = null
    private commandServiceInstance: CommandService | null = null
    private homeBaseServiceInstance: HomeBaseService | null = null

    constructor (
        private injector: Injector,
        private domSanitizer: DomSanitizer,
    ) {
        this.appVersion = this.injector.get(PlatformService).getAppVersion()
        afterNextRender(() => {
            this.initHomeBaseTimeout = setTimeout(() => {
                if (this.destroyed) {
                    return
                }
                void this.homeBase
            }, this.startupHomeBaseInitDelay)
            this.loadCommandsTimeout = setTimeout(async () => {
                try {
                    const loadedCommands = await this.commandService.getCommands({})
                    if (this.destroyed) {
                        return
                    }
                    this.commands = loadedCommands
                        .filter(x => x.locations?.includes(CommandLocation.StartPage))
                        .map(command => ({
                            ...command,
                            safeIcon: this.domSanitizer.bypassSecurityTrustHtml(command.icon ?? ''),
                        }))
                } catch (error) {
                    console.warn('Failed to load start page commands', error)
                }
            }, this.startupCommandLoadDelay)
        })
    }

    private get commandService (): CommandService {
        this.commandServiceInstance ??= this.injector.get(CommandService)
        return this.commandServiceInstance
    }

    private get homeBase (): HomeBaseService {
        this.homeBaseServiceInstance ??= this.injector.get(HomeBaseService)
        return this.homeBaseServiceInstance
    }

    openGitHub (): void {
        this.homeBase.openGitHub()
    }

    reportBug (): void {
        this.homeBase.reportBug()
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    buttonsTrackBy (_index: number, btn: StartPageCommand): any {
        return btn.label + btn.icon
    }

    ngOnDestroy (): void {
        this.destroyed = true
        if (this.loadCommandsTimeout !== null) {
            clearTimeout(this.loadCommandsTimeout)
            this.loadCommandsTimeout = null
        }
        if (this.initHomeBaseTimeout !== null) {
            clearTimeout(this.initHomeBaseTimeout)
            this.initHomeBaseTimeout = null
        }
    }
}
