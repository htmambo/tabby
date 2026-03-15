/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Component, Input } from '@angular/core'
import { InputProcessingOptions } from '../middleware/inputProcessing'

/** @hidden */
@Component({
    standalone: false,
    selector: 'input-processing-settings',
    templateUrl: './inputProcessingSettings.component.pug',
})
export class InputProcessingSettingsComponent {
    @Input() options: InputProcessingOptions
    private readonly backspaceModes = [
        {
            key: 'backspace',
            name: _('Pass-through'),
        },
        {
            key: 'ctrl-h',
            name: 'Ctrl-H',
        },
        {
            key: 'ctrl-?',
            name: 'Ctrl-?',
        },
        {
            key: 'delete',
            name: 'Delete (CSI 3~)',
        },
    ] satisfies { key: InputProcessingOptions['backspace'], name: string }[]

    getBackspaceModeName (key: InputProcessingOptions['backspace']): string | undefined {
        return this.backspaceModes.find(x => x.key === key)?.name
    }

    setBackspaceMode (mode: InputProcessingOptions['backspace']) {
        this.options.backspace = mode
    }
}
