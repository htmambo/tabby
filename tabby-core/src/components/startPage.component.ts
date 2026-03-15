import { afterNextRender, Component, OnDestroy } from '@angular/core'
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

    constructor (
        private domSanitizer: DomSanitizer,
        public homeBase: HomeBaseService,
        commands: CommandService,
    ) {
        afterNextRender(() => {
            this.loadCommandsTimeout = setTimeout(async () => {
                const loadedCommands = await commands.getCommands({})
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
