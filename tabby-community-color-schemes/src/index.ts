import { NgModule } from '@angular/core'
import { TabbyPluginManifest } from 'tabby-core'
import { TerminalColorSchemeProvider } from 'tabby-terminal'

import { ColorSchemes } from './colorSchemes'

const PROVIDERS = [
    { provide: TerminalColorSchemeProvider, useClass: ColorSchemes, multi: true },
]

@NgModule({
    providers: PROVIDERS,
})
export default class PopularThemesModule { } // eslint-disable-line @typescript-eslint/no-extraneous-class

export const manifest: TabbyPluginManifest = {
    name: 'community-color-schemes',
    providers: PROVIDERS,
}
