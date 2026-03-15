import { Injectable } from '@angular/core'
import { TerminalColorSchemeProvider, TerminalColorScheme } from 'tabby-terminal'

const schemeContents = (require as any).context('../schemes/', false, /.*/)

@Injectable()
export class ColorSchemes extends TerminalColorSchemeProvider {
    async getSchemes (): Promise<TerminalColorScheme[]> {
        const schemes: TerminalColorScheme[] = []

        schemeContents.keys().filter((x: string) => !x.startsWith('./')).forEach((schemeFile: string) => {
            const lines = (schemeContents(schemeFile).default as string).split('\n')

            // process #define variables
            const variables: Record<string, string> = {}
            lines
                .filter((x: string) => x.startsWith('#define'))
                .map((x: string) => x.split(' ').map(v => v.trim()))
                .forEach(([_ignored, variableName, variableValue]: string[]) => {
                    variables[variableName] = variableValue
                })

            const values: Record<string, string> = {}
            lines
                .filter((x: string) => x.startsWith('*.'))
                .map((x: string) => x.substring(2))
                .map((x: string) => x.split(':').map(v => v.trim()))
                .forEach(([key, value]: string[]) => {
                    values[key] = variables[value] ? variables[value] : value
                })

            const colors: string[] = []
            let colorIndex = 0
            while (values[`color${colorIndex}`]) {
                colors.push(values[`color${colorIndex}`])
                colorIndex++
            }

            schemes.push({
                name: schemeFile.split('/')[1].trim(),
                foreground: values.foreground,
                background: values.background,
                cursor: values.cursorColor,
                colors,
            })
        })

        return schemes
    }
}
