import { Inject, Injectable } from '@angular/core'
import { Subject, Observable, lastValueFrom } from 'rxjs'
import * as Color from 'color'
import { ConfigService } from '../services/config.service'
import { Theme } from '../api/theme'
import { PlatformService, PlatformTheme } from '../api/platform'
import { getRuntimePlatform } from '../api/rendererRuntime'
import { NewTheme } from '../theme'

@Injectable({ providedIn: 'root' })
export class ThemesService {
    private readonly linuxMinWindowOpacity = 0.4
    private readonly defaultVibrancyOverlayAlpha = 0.65
    get themeChanged$ (): Observable<Theme> { return this.themeChanged }
    private themeChanged = new Subject<Theme>()

    private styleElement: HTMLElement|null = null
    private rootElementStyleBackup = ''

    /** @hidden */
    private constructor (
        private config: ConfigService,
        private standardTheme: NewTheme,
        private platform: PlatformService,
        @Inject(Theme) private themes: Theme[],
    ) {
        this.rootElementStyleBackup = document.documentElement.style.cssText
        this.applyTheme(standardTheme)
        this.applyThemeVariables()
        void lastValueFrom(config.ready$).then(() => {
            this.applyCurrentTheme()
            this.applyThemeVariables()
            platform.themeChanged$.subscribe(() => {
                this.applyCurrentTheme()
                this.applyThemeVariables()
            })
            config.changed$.subscribe(() => {
                this.applyCurrentTheme()
                this.applyThemeVariables()
            })
        })
    }

    private getConfigStoreOrDefaults (): any {
        /// Theme service is active before the vault is unlocked and config is available
        return this.config.store ?? this.config.getDefaults()
    }

    private applyThemeVariables () {
        if (!this.findCurrentTheme().followsColorScheme) {
            document.documentElement.style.cssText = this.rootElementStyleBackup
        }

        const configStore = this.getConfigStoreOrDefaults()
        const theme = this._getActiveColorScheme()
        const isDark = Color(theme.background).luminosity() < Color(theme.foreground).luminosity()

        function more (some: string, factor: number) {
            if (isDark) {
                return Color(some).darken(factor)
            }
            return Color(some).lighten(factor)
        }

        function less (some: string, factor: number) {
            if (!isDark) {
                return Color(some).darken(factor)
            }
            return Color(some).lighten(factor)
        }

        const background = this.getVibrancyBackground(Color(theme.background), configStore.appearance)
        // const background = theme.background
        const backgroundMore = more(background.string(), 0.25).string()
        const themeBackgroundRgb = Color(theme.background).rgb().array().map((x: number) => Math.round(x)).join(', ')
        const themeForegroundRgb = Color(theme.foreground).rgb().array().map((x: number) => Math.round(x)).join(', ')
        const bodyBackgroundRgb = background.rgb().array().map((x: number) => Math.round(x)).join(', ')
        // const backgroundMore =more(theme.background, 0.25).string()
        const accentIndex = 4
        const vars: Record<string, string> = {}
        const contrastPairs: string[][] = []

        vars['--body-bg'] = background.string()
        vars['--body-bg-rgb'] = bodyBackgroundRgb
        vars['--theme-bg-rgb'] = themeBackgroundRgb
        vars['--theme-fg-rgb'] = themeForegroundRgb
        vars['--vibrancy-overlay-alpha'] = this.getVibrancyOverlayAlpha(configStore.appearance)
        if (this.findCurrentTheme().followsColorScheme) {
            vars['--bs-body-bg'] = theme.background
            vars['--bs-body-color'] = theme.foreground
            vars['--bs-body-bg-rgb'] = themeBackgroundRgb
            vars['--bs-body-color-rgb'] = themeForegroundRgb
            vars['--bs-black'] = theme.colors[0]
            vars['--bs-red'] = theme.colors[1]
            vars['--bs-green'] = theme.colors[2]
            vars['--bs-yellow'] = theme.colors[3]
            vars['--bs-blue'] = theme.colors[4]
            vars['--bs-purple'] = theme.colors[5]
            vars['--bs-cyan'] = theme.colors[6]
            vars['--bs-gray'] = theme.colors[7]
            vars['--bs-gray-dark'] = theme.colors[8]
            // vars['--bs-red'] = theme.colors[9]
            // vars['--bs-green'] = theme.colors[10]
            // vars['--bs-yellow'] = theme.colors[11]
            // vars['--bs-blue'] = theme.colors[12]
            // vars['--bs-purple'] = theme.colors[13]
            // vars['--bs-cyan'] = theme.colors[14]

            contrastPairs.push(['--bs-body-bg', '--bs-body-color'])

            vars['--theme-fg-more-2'] = more(theme.foreground, 0.5).string()
            vars['--theme-fg-more'] = more(theme.foreground, 0.25).string()
            vars['--theme-fg'] = theme.foreground
            vars['--theme-fg-less'] = less(theme.foreground, 0.25).string()
            vars['--theme-fg-less-2'] = less(theme.foreground, 0.5).string()

            vars['--theme-bg-less-2'] = less(theme.background, 0.5).string()
            vars['--theme-bg-less'] = less(theme.background, 0.25).string()
            vars['--theme-bg'] = theme.background
            vars['--theme-bg-more'] = backgroundMore
            vars['--theme-bg-more-2'] = more(backgroundMore, 0.25).string()

            vars['--theme-scrollbar-size'] = '8px'
            vars['--theme-scrollbar-size-thin'] = '4px'
            vars['--theme-scrollbar-radius'] = '999px'
            vars['--theme-scrollbar-border-width'] = '1px'
            vars['--theme-scrollbar-track'] = Color(backgroundMore).alpha(0).string()
            vars['--theme-scrollbar-thumb'] = Color(theme.foreground).alpha(0.18).string()
            vars['--theme-scrollbar-thumb-hover'] = Color(theme.foreground).alpha(0.28).string()
            vars['--theme-scrollbar-thumb-active'] = Color(theme.foreground).alpha(0.4).string()

            contrastPairs.push(['--theme-bg', '--theme-fg'])
            contrastPairs.push(['--theme-bg-less', '--theme-fg-less'])
            contrastPairs.push(['--theme-bg-less-2', '--theme-fg-less-2'])
            contrastPairs.push(['--theme-bg-more', '--theme-fg-more'])
            contrastPairs.push(['--theme-bg-more-2', '--theme-fg-more-2'])

            const themeColors = {
                primary: theme.colors[accentIndex],
                secondary: isDark
                    ? less(theme.background, 0.5).string()
                    : less(theme.background, 0.125).string(),
                tertiary: more(theme.background, 0.75).string(),
                warning: theme.colors[3],
                danger: theme.colors[1],
                success: theme.colors[2],
                info: theme.colors[4],
                dark: more(theme.background, 0.75).string(),
                light: more(theme.foreground, 0.5).string(),
                link: theme.colors[8], // for .btn-link
            }

            for (const [key, color] of Object.entries(themeColors)) {
                vars[`--bs-${key}-bg`] = more(color, 0.5).string()
                vars[`--bs-${key}-color`] = less(color, 0.5).string()
                vars[`--bs-${key}`] = color
                vars[`--bs-${key}-rgb`] = Color(color).rgb().array().join(', ')
                vars[`--theme-${key}-more-2`] = more(color, 1).string()
                vars[`--theme-${key}-more`] = more(color, 0.5).string()
                vars[`--theme-${key}`] = color
                vars[`--theme-${key}-less`] = less(color, 0.25).string()
                vars[`--theme-${key}-less-2`] = less(color, 0.75).string()
                vars[`--theme-${key}-fg`] = more(color, 3).string()

                vars[`--theme-${key}-active-bg`] = less(color, 1).string()
                vars[`--theme-${key}-active-fg`] = more(color, 1).string()

                contrastPairs.push([`--theme-${key}`, `--theme-${key}-fg`])
                contrastPairs.push([`--theme-${key}-active-bg`, `--theme-${key}-active-fg`])
            }

            const switchBackground = less(theme.colors[accentIndex], 0.25).string()
            vars['--bs-form-switch-bg'] = `url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%27-4 -4 8 8%27%3e%3ccircle r=%273%27 fill=%27${switchBackground}%27/%3e%3c/svg%3e")`
        }

        vars['--spaciness'] = configStore.appearance.spaciness

        for (const [bg, fg] of contrastPairs) {
            const colorBg = Color(vars[bg]).hsl()
            const colorFg = Color(vars[fg]).hsl()
            const bgContrast = colorBg.contrast(colorFg)
            if (bgContrast < configStore.terminal.minimumContrastRatio) {
                vars[fg] = this.ensureContrast(colorFg, colorBg).string()
            }
        }

        for (const [key, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(key, value)
        }

        document.body.classList.toggle('no-animations', !configStore.accessibility.animations)
    }

    private getLinuxVibrancyOpacityFactor (appearance: Record<string, unknown>): number {
        if (getRuntimePlatform() !== 'linux' || !appearance.vibrancy) {
            return 1
        }
        const numericOpacity = Number(appearance.opacity)
        if (!Number.isFinite(numericOpacity)) {
            return 1
        }
        return Math.max(this.linuxMinWindowOpacity, Math.min(1, numericOpacity))
    }

    private getVibrancyOpacityFactor (appearance: Record<string, unknown>): number {
        if (!appearance.vibrancy) {
            return 1
        }
        const numericOpacity = Number(appearance.opacity)
        if (!Number.isFinite(numericOpacity)) {
            return 1
        }
        // Scale overlay for macOS and Linux based on window opacity setting
        return Math.min(1, numericOpacity)
    }

    private getVibrancyBackground (background: any, appearance: Record<string, unknown>): any {
        if (!appearance.vibrancy) {
            return background
        }
        const fadedBackground = background.fade(0.6)
        if (getRuntimePlatform() !== 'linux') {
            return fadedBackground
        }
        return fadedBackground.alpha(fadedBackground.alpha() * this.getLinuxVibrancyOpacityFactor(appearance))
    }

    private getVibrancyOverlayAlpha (appearance: Record<string, unknown>): string {
        return `${(this.defaultVibrancyOverlayAlpha * this.getVibrancyOpacityFactor(appearance)).toFixed(3)}`
    }

    private ensureContrast (color: any, against: any): any {
        const a = this.increaseContrast(color, against, 1.1)
        const b = this.increaseContrast(color, against, 0.9)
        return a.contrast(against) > b.contrast(against) ? a : b
    }

    private increaseContrast (color: any, against: any, step=1.1): any {
        color = color.hsl()
        color.color[2] = Math.max(color.color[2], 0.01)
        while (
            (step < 1 && color.color[2] > 1 ||
             step > 1 && color.color[2] < 99) &&
             color.contrast(against) < this.getConfigStoreOrDefaults().terminal.minimumContrastRatio) {
            color.color[2] *= step
        }
        return color
    }

    findTheme (name: string): Theme|null {
        return this.config.enabledServices(this.themes).find(x => x.name === name) ?? null
    }

    findCurrentTheme (): Theme {
        return this.findTheme(this.getConfigStoreOrDefaults().appearance.theme) ?? this.standardTheme
    }

    /// @hidden
    _getActiveColorScheme (): any {
        let theme: PlatformTheme = 'dark'
        if (this.getConfigStoreOrDefaults().appearance.colorSchemeMode === 'light') {
            theme = 'light'
        } else if (this.getConfigStoreOrDefaults().appearance.colorSchemeMode === 'auto') {
            theme = this.platform.getTheme()
        }

        if (theme === 'light') {
            return this.getConfigStoreOrDefaults().terminal.lightColorScheme
        } else {
            return this.getConfigStoreOrDefaults().terminal.colorScheme
        }
    }

    applyTheme (theme: Theme): void {
        if (!this.styleElement) {
            this.styleElement = document.createElement('style')
            this.styleElement.setAttribute('id', 'theme')
            document.querySelector('head')!.appendChild(this.styleElement)
        }
        this.styleElement.textContent = theme.css
        const customStyleElement = document.querySelector('style#custom-css') as HTMLStyleElement | null
        if (customStyleElement) {
            customStyleElement.textContent = this.getConfigStoreOrDefaults().appearance.css
        }
        this.themeChanged.next(theme)
    }

    private applyCurrentTheme (): void {
        this.applyTheme(this.findCurrentTheme())
    }
}
