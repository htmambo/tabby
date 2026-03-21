import { afterNextRender, Component, Injector, OnDestroy } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
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
    version: string
    commands: StartPageCommand[] = []
    private destroyed = false
    private loadCommandsTimeout: ReturnType<typeof setTimeout> | null = null
    private commandServiceInstance: CommandService | null = null

    constructor (
        private injector: Injector,
        private domSanitizer: DomSanitizer,
        public homeBase: HomeBaseService,
    ) {
        afterNextRender(() => {
            this.loadCommandsTimeout = setTimeout(async () => {
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
            }, 0)
        })
    }

    private get commandService (): CommandService {
        this.commandServiceInstance ??= this.injector.get(CommandService)
        return this.commandServiceInstance
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
    }
}
