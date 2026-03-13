/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, HostListener, Input } from '@angular/core'
import { BaseTerminalTabComponent } from '../api/baseTerminalTab.component'

/** @hidden */
@Component({
    standalone: false,
    selector: 'terminal-toolbar',
    templateUrl: './terminalToolbar.component.pug',
    styleUrls: ['./terminalToolbar.component.scss'],
})
export class TerminalToolbarComponent {
    @Input() tab: BaseTerminalTabComponent<any>

    @HostListener('mouseenter') onMouseEnter () {
        this.tab.showToolbar()
    }

    @HostListener('mouseleave') onMouseLeave () {
        this.tab.hideToolbar()
    }
}
