/* eslint-disable @typescript-eslint/no-extraneous-class */
import { NgModule } from '@angular/core'
import { ToastrModule } from 'ngx-toastr'
import { TabbyPluginManifest } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'

import { AutoSudoPasswordDecorator } from './decorator'

const PROVIDERS = [
    { provide: TerminalDecorator, useClass: AutoSudoPasswordDecorator, multi: true },
]

@NgModule({
    imports: [
        ToastrModule,
    ],
    providers: PROVIDERS,
})
export default class AutoSudoPasswordModule { }

export const manifest: TabbyPluginManifest = {
    name: 'auto-sudo-password',
    providers: PROVIDERS,
}
