import { Injectable } from '@angular/core'
import { TerminalColorSchemeProvider, TerminalColorScheme } from 'tabby-terminal'

@Injectable()
export class ColorSchemes extends TerminalColorSchemeProvider {
    async getSchemes (): Promise<TerminalColorScheme[]> {
        const { loadCommunityColorSchemes } = await import('./colorSchemes.loader')
        return loadCommunityColorSchemes()
    }
}
