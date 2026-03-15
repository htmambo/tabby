/* eslint-disable @typescript-eslint/no-extraneous-class */
import { NgModule } from '@angular/core'
import { ToastrModule } from 'ngx-toastr'
import { ConfigProvider, TabbyPluginManifest } from 'tabby-core'
import { TerminalDecorator } from 'tabby-terminal'

import { LinkHandler } from './api'
import { UnixFileHandler, WindowsFileHandler, URLHandler, IPHandler } from './handlers'
import { LinkHighlighterDecorator } from './decorator'
import { ClickableLinksConfigProvider } from './config'

const PROVIDERS = [
    { provide: LinkHandler, useClass: URLHandler, multi: true },
    { provide: LinkHandler, useClass: IPHandler, multi: true },
    { provide: LinkHandler, useClass: UnixFileHandler, multi: true },
    { provide: LinkHandler, useClass: WindowsFileHandler, multi: true },
    { provide: TerminalDecorator, useClass: LinkHighlighterDecorator, multi: true },
    { provide: ConfigProvider, useClass: ClickableLinksConfigProvider, multi: true },
]

@NgModule({
    imports: [
        ToastrModule,
    ],
    providers: PROVIDERS,
})
export default class LinkifierModule { }

export const manifest: TabbyPluginManifest = {
    name: 'linkifier',
    providers: PROVIDERS,
}

export * from './api'
