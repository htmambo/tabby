import { Injectable } from '@angular/core'
import { TerminalColorSchemeProvider, TerminalColorScheme } from 'tabby-terminal'

interface WebpackRequireContextModule {
    default: string
}

interface WebpackRequireContext {
    (request: string): WebpackRequireContextModule
    keys: () => string[]
}

declare const require: {
    context: (path: string, deep?: boolean, filter?: RegExp) => WebpackRequireContext
}

const schemeContents = require.context('../schemes/', false, /.*/)

@Injectable()
export class ColorSchemes extends TerminalColorSchemeProvider {
    getSchemes (): Promise<TerminalColorScheme[]> {
        const schemes: TerminalColorScheme[] = []

        schemeContents.keys().filter((x: string) => !x.startsWith('./')).forEach((schemeFile: string) => {
            const lines = schemeContents(schemeFile).default.split('\n')

            // 导入进来的方案大多是 Xresources 风格。这里先解析 `#define`
            // 变量，再保留一份通用键值表，以同时支持传统 ANSI 字段和
            // Tabby/xterm 当前可识别的扩展字段。
            const variables: Record<string, string> = {}
            lines
                .filter((x: string) => x.startsWith('#define'))
                .map((x: string) => x.match(/^#define\s+(\S+)\s+(.+?)\s*$/))
                .filter((x): x is RegExpMatchArray => x !== null)
                .forEach(([_ignored, variableName, variableValue]: RegExpMatchArray) => {
                    variables[variableName] = variableValue
                })

            const values: Record<string, string> = {}
            lines
                .filter((x: string) => x.startsWith('*.'))
                .map((x: string) => x.substring(2))
                .map((x: string) => x.split(':').map(v => v.trim()))
                .forEach(([key, value]: string[]) => {
                    const hasVariable = Object.prototype.hasOwnProperty.call(variables, value) === true
                    values[key] = hasVariable ? variables[value] : value
                })

            const colors: string[] = []
            let colorIndex = 0
            // 一些导入方案会定义 color16+ 或其他遗留 Xresources 键。
            // 这里为了兼容性保留完整解析结果，但 xterm 实际渲染时
            // 只会消费前 16 个 ANSI 槽位。
            while (values[`color${colorIndex}`] !== undefined) {
                colors.push(values[`color${colorIndex}`])
                colorIndex++
            }

            schemes.push({
                name: schemeFile.split('/')[1].trim(),
                foreground: values.foreground,
                background: values.background,
                cursor: values.cursorColor,
                colors,
                selection: values.selection ?? values.selectionBackground,
                selectionForeground: values.selectionForeground,
                cursorAccent: values.cursorAccent,
            })
        })

        return Promise.resolve(schemes)
    }
}
