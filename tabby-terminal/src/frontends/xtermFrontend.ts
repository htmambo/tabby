import deepEqual from 'deep-equal'
import { BehaviorSubject, filter, firstValueFrom, takeUntil } from 'rxjs'
import { Injector } from '@angular/core'
import { ConfigService, getCSSFontFamily, getRuntimePlatform, getWindows10Build, HostAppService, HotkeysService, NotificationsService, Platform, PlatformService, ThemesService, TranslateService, isIMEKeyboardEvent } from 'tabby-core'
import { Frontend, SearchOptions, SearchState } from './frontend'
import { Terminal, ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import { LigaturesAddon } from '@xterm/addon-ligatures'
import { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SerializeAddon } from '@xterm/addon-serialize'
import { ImageAddon } from '@xterm/addon-image'
import { CanvasAddon } from '@xterm/addon-canvas'
import { BaseTerminalProfile, TerminalColorScheme } from '../api/interfaces'
import { getTerminalBackgroundColor } from '../helpers'
import './xterm.css'

const COLOR_NAMES = [
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
]
const DEFAULT_RECOVERY_SCROLLBACK_LINES = 2000
const MAX_RECOVERY_SCROLLBACK_LINES = 5000
// Some desktop IME/layout combinations report standalone punctuation through the textarea
// input event only after xterm has already derived an ASCII fallback from the physical key.
// Defer these printable keys so the terminal can prefer the finalized input payload.
const DEFERRED_PRINTABLE_KEY_MAP: Record<string, readonly [string, string]> = {
    Backquote: ['`', '~'],
    Digit1: ['1', '!'],
    Digit2: ['2', '@'],
    Digit3: ['3', '#'],
    Digit4: ['4', '$'],
    Digit5: ['5', '%'],
    Digit6: ['6', '^'],
    Digit7: ['7', '&'],
    Digit8: ['8', '*'],
    Digit9: ['9', '('],
    Digit0: ['0', ')'],
    Minus: ['-', '_'],
    Equal: ['=', '+'],
    BracketLeft: ['[', '{'],
    BracketRight: [']', '}'],
    Backslash: ['\\', '|'],
    IntlBackslash: ['\\', '|'],
    Semicolon: [';', ':'],
    Quote: ['\'', '"'],
    Comma: [',', '<'],
    Period: ['.', '>'],
    Slash: ['/', '?'],
}

function getRootCSSVariable (name: string): string | undefined {
    if (typeof window === 'undefined') {
        return undefined
    }

    const value = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    return value || undefined
}

class FlowControl {
    private blocked = false
    private blocked$ = new BehaviorSubject<boolean>(false)
    private pendingCallbacks = 0
    private lowWatermark = 5
    private highWatermark = 10
    private bytesWritten = 0
    private bytesThreshold = 1024 * 128

    constructor (private xterm: Terminal) { }

    async write (data: string) {
        if (this.blocked) {
            await firstValueFrom(this.blocked$.pipe(filter(x => !x)))
        }
        this.bytesWritten += data.length
        if (this.bytesWritten > this.bytesThreshold) {
            this.pendingCallbacks++
            this.bytesWritten = 0
            if (!this.blocked && this.pendingCallbacks > this.highWatermark) {
                this.blocked = true
                this.blocked$.next(true)
            }
            this.xterm.write(data, () => {
                this.pendingCallbacks--
                if (this.blocked && this.pendingCallbacks < this.lowWatermark) {
                    this.blocked = false
                    this.blocked$.next(false)
                }
            })
        } else {
            this.xterm.write(data)
        }
    }
}

/** @hidden */
export class XTermFrontend extends Frontend {
    enableResizing = true
    xterm: Terminal
    protected xtermCore: any
    protected enableWebGL = false
    private element?: HTMLElement
    private configuredFontSize = 0
    private configuredLinePadding = 0
    private zoom = 0
    private resizeHandler: () => void
    private configuredTheme: ITheme = {}
    private copyOnSelect = false
    private preventNextOnSelectionChangeEvent = false
    private search = new SearchAddon()
    private searchState: SearchState = { resultCount: 0 }
    private fitAddon = new FitAddon()
    private serializeAddon = new SerializeAddon()
    private ligaturesAddon?: LigaturesAddon
    private webGLAddon?: WebglAddon
    private canvasAddon?: CanvasAddon
    private opened = false
    private resizeObserver?: any
    private flowControl: FlowControl
    private layoutTransitionActive = false
    private skipObservedResizeUntil = 0
    private pendingObservedResizeFrame: number|null = null
    private readonly observedResizeResumeDelay = 120
    private readonly deferredPrintableFallbackDelay = 32
    private deferredPrintableInput: {
        fallbackText: string
        timer: number
    } | null = null

    // Bound event handlers for proper cleanup
    private boundDragOver: (event: any) => void
    private boundDrop: (event: DragEvent) => void
    private boundMouseDown: (event: MouseEvent) => void
    private boundMouseUp: (event: MouseEvent) => void
    private boundMouseWheel: (event: WheelEvent) => void
    private boundContextMenu: (event: MouseEvent) => void
    private boundDeferredPrintableInput?: (event: Event) => void
    private attachedHost?: HTMLElement

    private configService: ConfigService
    private hotkeysService: HotkeysService
    private platformService: PlatformService
    private hostApp: HostAppService
    private themes: ThemesService
    private notifications: NotificationsService
    private translate: TranslateService

    constructor (injector: Injector) {
        super(injector)
        this.configService = injector.get(ConfigService)
        this.hotkeysService = injector.get(HotkeysService)
        this.platformService = injector.get(PlatformService)
        this.hostApp = injector.get(HostAppService)
        this.themes = injector.get(ThemesService)
        this.notifications = injector.get(NotificationsService)
        this.translate = injector.get(TranslateService)

        this.xterm = new Terminal({
            allowTransparency: true,
            allowProposedApi: true,
            overviewRuler: {
                width: 8,
                showBottomBorder: false,
                showTopBorder: false,
            },
            reflowCursorLine: true,
            windowsPty: getRuntimePlatform() === 'win32' ? {
                backend: this.configService.store.terminal.useConPTY ? 'conpty' : 'winpty',
                buildNumber: getWindows10Build(),
            } : undefined,
        })
        this.flowControl = new FlowControl(this.xterm)
        this.xtermCore = (this.xterm as any)._core

        // Initialize bound event handlers for proper cleanup
        this.boundDragOver = (event: any) => this.dragOver.next(event)
        this.boundDrop = (event: DragEvent) => this.drop.next(event)
        this.boundMouseDown = (event: MouseEvent) => this.mouseEvent.next(event)
        this.boundMouseUp = (event: MouseEvent) => this.mouseEvent.next(event)
        this.boundMouseWheel = (event: WheelEvent) => this.mouseEvent.next(event as MouseEvent)
        this.boundContextMenu = (event: MouseEvent) => {
            event.preventDefault()
            event.stopPropagation()
        }

        this.xterm.onBinary(data => {
            this.clearDeferredPrintableInput()
            this.input.next(Buffer.from(data, 'binary'))
        })
        this.xterm.onData(data => {
            if (this.deferredPrintableInput) {
                if (data === this.deferredPrintableInput.fallbackText) {
                    return
                }
                this.clearDeferredPrintableInput()
            }
            this.input.next(Buffer.from(data, 'utf-8'))
        })
        this.xterm.onResize(({ cols, rows }) => {
            this.resize.next({ rows, columns: cols })
        })
        this.xterm.onTitleChange(title => {
            this.title.next(title)
        })
        this.xterm.onSelectionChange(() => {
            if (this.getSelection()) {
                if (this.copyOnSelect && !this.preventNextOnSelectionChangeEvent) {
                    this.copySelection()
                }
                this.preventNextOnSelectionChangeEvent = false
            }
        })
        this.xterm.onBell(() => {
            this.bell.next()
        })

        this.xterm.loadAddon(this.fitAddon)
        this.xterm.loadAddon(this.serializeAddon)
        this.xterm.loadAddon(new Unicode11Addon())
        this.xterm.loadAddon(new ClipboardAddon(undefined, {
            readText: async () => {
                return this.platformService.readClipboard()
            },
            writeText: async (_, text) => {
                this.platformService.setClipboard({ text })
                this.notifications.notice(this.translate.instant('Copied'))
            },
        }))
        this.xterm.unicode.activeVersion = '11'

        if (this.configService.store.terminal.sixel) {
            this.xterm.loadAddon(new ImageAddon())
        }

        const keyboardEventHandler = (name: string, event: KeyboardEvent) => {
            if (this.isAlternateScreenActive()) {
                let modifiers = 0
                modifiers += event.ctrlKey ? 1 : 0
                modifiers += event.altKey ? 1 : 0
                modifiers += event.shiftKey ? 1 : 0
                modifiers += event.metaKey ? 1 : 0
                if (event.key.startsWith('Arrow') && modifiers === 1) {
                    return true
                }
            }

            // Ctrl-/
            if (event.type === 'keydown' && event.key === '/' && event.ctrlKey) {
                this.input.next(Buffer.from('\u001f', 'binary'))
                return false
            }

            // Ctrl-@
            if (event.type === 'keydown' && event.key === '@' && event.ctrlKey) {
                this.input.next(Buffer.from('\u0000', 'binary'))
                return false
            }

            this.hotkeysService.pushKeyEvent(name, event)

            let ret = true
            if (this.hotkeysService.matchActiveHotkey(true) !== null) {
                event.stopPropagation()
                event.preventDefault()
                ret = false
            }
            return ret
        }

        this.xterm.attachCustomKeyEventHandler((event: KeyboardEvent) => {
            if (event.type === 'keydown' && this.shouldDeferPrintableInput(event)) {
                this.scheduleDeferredPrintableInput(this.getDeferredPrintableFallback(event)!)
                return false
            }
            if (event.type === 'keypress' && this.deferredPrintableInput) {
                return false
            }

            if (isIMEKeyboardEvent(event)) {
                return true
            }
            if (this.hostApp.platform !== Platform.Web) {
                if (
                    event.getModifierState('Meta') && event.key.toLowerCase() === 'v' ||
                    event.key === 'Insert' && event.shiftKey
                ) {
                    event.preventDefault()
                    return false
                }
            }
            if (event.getModifierState('Meta') && event.key.startsWith('Arrow')) {
                return false
            }

            return keyboardEventHandler('keydown', event)
        })

        this.xtermCore._scrollToBottom = this.xtermCore.scrollToBottom.bind(this.xtermCore)
        this.xtermCore.scrollToBottom = () => null

        this.resizeHandler = () => {
            try {
                if (!this.enableResizing) {
                    return
                }
                if (this.xterm.element && getComputedStyle(this.xterm.element).getPropertyValue('height') !== 'auto') {
                    this.fitAddon.fit()
                }
            } catch (e) {
                // tends to throw when element wasn't shown yet
                console.warn('Could not resize xterm', e)
            }
        }

        const oldKeyUp = this.xtermCore._keyUp.bind(this.xtermCore)
        this.xtermCore._keyUp = (e: KeyboardEvent) => {
            this.xtermCore.updateCursorStyle(e)
            if (keyboardEventHandler('keyup', e)) {
                oldKeyUp(e)
            }
        }

        this.xterm.buffer.onBufferChange(() => {
            const altBufferActive = this.xterm.buffer.active.type === 'alternate'
            this.alternateScreenActive.next(altBufferActive)
        })

    }

    async attach (host: HTMLElement, profile: BaseTerminalProfile): Promise<void> {
        this.element = host

        this.xterm.open(host)
        this.opened = true
        this.attachDeferredPrintableInputListener()

        // Work around font loading bugs
        await new Promise(resolve => {
            const timer = setTimeout(resolve, this.hostApp.platform === Platform.Web ? 1000 : 0)
            if (typeof (timer as any)?.unref === 'function') {
                (timer as any).unref()
            }
        })

        // Just configure the colors to avoid a flash
        this.configureColors(profile.terminalColorScheme)

        const subscribeTextureAtlasClear = (clear: () => void): void => {
            this.platformService.displayMetricsChanged$.pipe(
                takeUntil(this.destroyed$),
            ).subscribe(() => {
                clear()
            })
        }

        const tryLoadCanvasAddon = (): void => {
            this.canvasAddon = new CanvasAddon()
            this.xterm.loadAddon(this.canvasAddon)
            subscribeTextureAtlasClear(() => this.canvasAddon?.clearTextureAtlas())
        }

        if (this.enableWebGL) {
            try {
                this.webGLAddon = new WebglAddon()
                this.xterm.loadAddon(this.webGLAddon)
                subscribeTextureAtlasClear(() => this.webGLAddon?.clearTextureAtlas())
            } catch (error) {
                console.warn('Could not enable xterm WebGL renderer, falling back to canvas renderer', error)
                this.webGLAddon?.dispose()
                this.webGLAddon = undefined
                this.enableWebGL = false
                try {
                    tryLoadCanvasAddon()
                } catch (canvasError) {
                    console.warn('Could not enable xterm canvas renderer, using default renderer', canvasError)
                    this.canvasAddon?.dispose()
                    this.canvasAddon = undefined
                }
            }
        } else {
            try {
                tryLoadCanvasAddon()
            } catch (error) {
                console.warn('Could not enable xterm canvas renderer, using default renderer', error)
                this.canvasAddon?.dispose()
                this.canvasAddon = undefined
            }
        }

        // Allow an animation frame
        await new Promise(resolve => {
            const timer = setTimeout(resolve, 100)
            if (typeof (timer as any)?.unref === 'function') {
                (timer as any).unref()
            }
        })

        this.ready.next()
        this.ready.complete()

        this.xterm.loadAddon(this.search)

        this.search.onDidChangeResults(state => {
            this.searchState = state
        })

        window.addEventListener('resize', this.resizeHandler)

        this.resizeHandler()

        // Allow an animation frame
        await new Promise(resolve => {
            const timer = setTimeout(resolve, 0)
            if (typeof (timer as any)?.unref === 'function') {
                (timer as any).unref()
            }
        })

        host.addEventListener('dragOver', this.boundDragOver)
        host.addEventListener('drop', this.boundDrop)
        host.addEventListener('mousedown', this.boundMouseDown)
        host.addEventListener('mouseup', this.boundMouseUp)
        host.addEventListener('mousewheel', this.boundMouseWheel)
        host.addEventListener('contextmenu', this.boundContextMenu)
        this.attachedHost = host

        this.resizeObserver = new ResizeObserver(() => {
            if (!this.enableResizing || this.shouldSkipObservedResize()) {
                return
            }
            this.scheduleObservedResize()
        })
        this.resizeObserver.observe(host)
    }

    detach (_host: HTMLElement): void {
        window.removeEventListener('resize', this.resizeHandler)
        this.resizeObserver?.disconnect()
        this.clearPendingObservedResize()
        this.detachDeferredPrintableInputListener()
        delete this.resizeObserver

        // Remove event listeners from host
        if (this.attachedHost) {
            this.attachedHost.removeEventListener('dragOver', this.boundDragOver)
            this.attachedHost.removeEventListener('drop', this.boundDrop)
            this.attachedHost.removeEventListener('mousedown', this.boundMouseDown)
            this.attachedHost.removeEventListener('mouseup', this.boundMouseUp)
            this.attachedHost.removeEventListener('mousewheel', this.boundMouseWheel)
            this.attachedHost.removeEventListener('contextmenu', this.boundContextMenu)
            this.attachedHost = undefined
        }
    }

    destroy (): void {
        super.destroy()
        this.clearPendingObservedResize()
        this.detachDeferredPrintableInputListener()
        this.webGLAddon?.dispose()
        this.canvasAddon?.dispose()
        this.xterm.dispose()
    }

    getSelection (): string {
        return this.xterm.getSelection()
    }

    copySelection (): void {
        const text = this.getSelection()
        if (!text.trim().length) {
            return
        }
        if (text.length < 1024 * 32 && this.configService.store.terminal.copyAsHTML) {
            this.platformService.setClipboard({
                text: this.getSelection(),
                html: this.getSelectionAsHTML(),
            })
        } else {
            this.platformService.setClipboard({
                text: this.getSelection(),
            })
        }
    }

    selectAll (): void {
        this.xterm.selectAll()
    }

    clearSelection (): void {
        this.xterm.clearSelection()
    }

    focus (): void {
        const timer = setTimeout(() => this.xterm.focus())
        if (typeof (timer as any)?.unref === 'function') {
            (timer as any).unref()
        }
    }

    async write (data: string): Promise<void> {
        await this.flowControl.write(data)
    }

    clear (): void {
        this.xterm.clear()
    }

    visualBell (): void {
        if (this.element) {
            this.element.style.animation = 'none'
            const timer = setTimeout(() => {
                this.element!.style.animation = 'terminalShakeFrames 0.3s ease'
            })
            if (typeof (timer as any)?.unref === 'function') {
                (timer as any).unref()
            }
        }
    }

    scrollToTop (): void {
        this.xterm.scrollToTop()
    }

    scrollPages (pages: number): void {
        this.xterm.scrollPages(pages)
    }

    scrollLines (amount: number): void {
        this.xterm.scrollLines(amount)
    }

    scrollToBottom (): void {
        this.xtermCore._scrollToBottom()
    }

    private configureColors (scheme: TerminalColorScheme | null): void {
        const appColorScheme = this.themes._getActiveColorScheme() as TerminalColorScheme

        scheme = scheme ?? appColorScheme

        const theme: ITheme = {
            foreground: scheme.foreground,
            selectionBackground: scheme.selection ?? '#88888888',
            selectionForeground: scheme.selectionForeground ?? undefined,
            background: getTerminalBackgroundColor(this.configService, this.themes, scheme) ?? '#00000000',
            cursor: scheme.cursor,
            cursorAccent: scheme.cursorAccent,
            overviewRulerBorder: scheme.background,
        }

        const themeColors = theme as Record<string, string | undefined>
        for (let i = 0; i < COLOR_NAMES.length; i++) {
            themeColors[COLOR_NAMES[i]] = scheme.colors[i]
        }

        theme.scrollbarSliderBackground = getRootCSSVariable('--theme-scrollbar-thumb') ?? theme.brightBlack
        theme.scrollbarSliderHoverBackground = getRootCSSVariable('--theme-scrollbar-thumb-hover') ?? theme.brightBlack
        theme.scrollbarSliderActiveBackground = getRootCSSVariable('--theme-scrollbar-thumb-active') ?? theme.brightBlack

        if (!deepEqual(this.configuredTheme, theme)) {
            this.xterm.options.theme = theme
            this.configuredTheme = theme
        }
    }

    configure (profile: BaseTerminalProfile): void {
        const config = this.configService.store

        const resizeHandle = setImmediate(() => {
            if (this.xterm.cols && this.xterm.rows && this.xtermCore.charMeasure) {
                if (this.xtermCore.charMeasure) {
                    this.xtermCore.charMeasure.measure(this.xtermCore.options)
                }
                if (this.xtermCore.renderer) {
                    this.xtermCore.renderer._updateDimensions()
                }
                this.resizeHandler()
            }
        })
        if (typeof (resizeHandle as any)?.unref === 'function') {
            (resizeHandle as any).unref()
        }

        this.xtermCore.browser = {
            ...this.xtermCore.browser,
            isWindows: this.hostApp.platform === Platform.Windows,
            isLinux: this.hostApp.platform === Platform.Linux,
            isMac: this.hostApp.platform === Platform.macOS,
        }

        this.xterm.options.fontFamily = getCSSFontFamily(config)
        const cursorStyle = config.terminal.cursor === 'beam' ? 'bar' : config.terminal.cursor
        this.xterm.options.cursorStyle = cursorStyle as 'bar' | 'block' | 'underline' | undefined
        this.xterm.options.cursorBlink = config.terminal.cursorBlink
        this.xterm.options.macOptionIsMeta = config.terminal.altIsMeta
        this.xterm.options.scrollback = config.terminal.scrollbackLines
        this.xterm.options.wordSeparator = config.terminal.wordSeparator
        this.xterm.options.drawBoldTextInBrightColors = config.terminal.drawBoldTextInBrightColors
        this.xterm.options.fontWeight = config.terminal.fontWeight
        this.xterm.options.fontWeightBold = config.terminal.fontWeightBold
        this.xterm.options.minimumContrastRatio = config.terminal.minimumContrastRatio
        this.configuredFontSize = config.terminal.fontSize
        this.configuredLinePadding = config.terminal.linePadding
        this.setFontSize()

        this.copyOnSelect = config.terminal.copyOnSelect

        this.configureColors(profile.terminalColorScheme)

        if (this.opened && config.terminal.ligatures && !this.ligaturesAddon && this.hostApp.platform !== Platform.Web) {
            this.ligaturesAddon = new LigaturesAddon()
            this.xterm.loadAddon(this.ligaturesAddon)
        }
    }

    setZoom (zoom: number): void {
        this.zoom = zoom
        this.setFontSize()
        this.resizeHandler()
    }

    setLayoutTransitionActive (active: boolean): void {
        this.layoutTransitionActive = active
        if (active) {
            this.clearPendingObservedResize()
        }
        if (!active) {
            this.suppressObservedResize()
        }
    }

    fitToContainer (): void {
        this.clearPendingObservedResize()
        this.suppressObservedResize()
        this.resizeHandler()
    }

    private getSearchOptions (searchOptions?: SearchOptions): ISearchOptions {
        return {
            ...searchOptions,
            decorations: {
                matchOverviewRuler: '#888888',
                activeMatchColorOverviewRuler: '#ffff00',
                matchBackground: '#888888',
                activeMatchBackground: '#ffff00',
            },
        }
    }

    private wrapSearchResult (result: boolean): SearchState {
        if (!result) {
            return { resultCount: 0 }
        }
        return this.searchState
    }

    findNext (term: string, searchOptions?: SearchOptions): SearchState {
        if (this.copyOnSelect) {
            this.preventNextOnSelectionChangeEvent = true
        }
        return this.wrapSearchResult(
            this.search.findNext(term, this.getSearchOptions(searchOptions)),
        )
    }

    findPrevious (term: string, searchOptions?: SearchOptions): SearchState {
        if (this.copyOnSelect) {
            this.preventNextOnSelectionChangeEvent = true
        }
        return this.wrapSearchResult(
            this.search.findPrevious(term, this.getSearchOptions(searchOptions)),
        )
    }

    cancelSearch (): void {
        this.search.clearDecorations()
        this.focus()
    }

    private getRecoveryScrollbackLines (options?: { scrollback?: number }): number {
        if (options?.scrollback !== undefined) {
            const overridden = Number(options.scrollback)
            if (!Number.isFinite(overridden)) {
                return 0
            }
            return Math.min(MAX_RECOVERY_SCROLLBACK_LINES, Math.max(0, Math.round(overridden)))
        }
        const configured = Number(this.configService.store.terminal.recoveryScrollbackLines)
        if (!Number.isFinite(configured)) {
            return DEFAULT_RECOVERY_SCROLLBACK_LINES
        }
        return Math.min(MAX_RECOVERY_SCROLLBACK_LINES, Math.max(0, Math.round(configured)))
    }

    saveState (options?: { scrollback?: number }): any {
        return this.serializeAddon.serialize({
            excludeAltBuffer: true,
            excludeModes: true,
            scrollback: this.getRecoveryScrollbackLines(options),
        })
    }

    restoreState (state: string): void {
        this.xterm.write(state)
    }

    supportsBracketedPaste (): boolean {
        return this.xterm.modes.bracketedPasteMode
    }

    isAlternateScreenActive (): boolean {
        return this.xterm.buffer.active.type === 'alternate'
    }

    private shouldUseDeferredPrintableInput (): boolean {
        return this.hostApp.platform === Platform.macOS || this.hostApp.platform === Platform.Linux
    }

    private shouldDeferPrintableInput (event: KeyboardEvent): boolean {
        return this.shouldUseDeferredPrintableInput() &&
            event.type === 'keydown' &&
            !event.isComposing &&
            !event.ctrlKey &&
            !event.altKey &&
            !event.metaKey &&
            event.keyCode !== 229 &&
            !!this.getDeferredPrintableFallback(event)
    }

    private getDeferredPrintableFallback (event: KeyboardEvent): string | null {
        const mapping = DEFERRED_PRINTABLE_KEY_MAP[event.code]
        if (!mapping) {
            return null
        }
        return mapping[event.shiftKey ? 1 : 0] ?? mapping[0]
    }

    private scheduleDeferredPrintableInput (fallbackText: string): void {
        this.clearDeferredPrintableInput()

        const timer: number = window.setTimeout(() => {
            if (this.deferredPrintableInput?.timer !== timer) {
                return
            }

            const text = this.deferredPrintableInput.fallbackText
            this.deferredPrintableInput = null
            this.input.next(Buffer.from(text, 'utf-8'))
        }, this.deferredPrintableFallbackDelay)
        if (typeof (timer as any)?.unref === 'function') {
            (timer as any).unref()
        }

        this.deferredPrintableInput = {
            fallbackText,
            timer,
        }
    }

    private clearDeferredPrintableInput (): void {
        if (!this.deferredPrintableInput) {
            return
        }

        window.clearTimeout(this.deferredPrintableInput.timer)
        this.deferredPrintableInput = null
    }

    private resolveDeferredPrintableInput (text: string): void {
        this.clearDeferredPrintableInput()
        this.input.next(Buffer.from(text, 'utf-8'))
    }

    private shouldResolveDeferredPrintableInput (inputEvent: InputEvent): boolean {
        return !!this.deferredPrintableInput &&
            !!inputEvent.data &&
            typeof inputEvent.inputType === 'string' &&
            inputEvent.inputType.startsWith('insert')
    }

    private attachDeferredPrintableInputListener (): void {
        if (!this.shouldUseDeferredPrintableInput() || this.boundDeferredPrintableInput) {
            return
        }

        const textarea = this.xterm.textarea
        if (!textarea) {
            return
        }

        // For some desktop IME/layout combinations, xterm sends raw ASCII punctuation on keydown
        // before the textarea input event exposes the final user-facing character.
        this.boundDeferredPrintableInput = (event: Event) => {
            const inputEvent = event as InputEvent
            if (!this.shouldResolveDeferredPrintableInput(inputEvent)) {
                return
            }
            this.resolveDeferredPrintableInput(inputEvent.data!)
        }

        textarea.addEventListener('beforeinput', this.boundDeferredPrintableInput)
        textarea.addEventListener('input', this.boundDeferredPrintableInput)
    }

    private detachDeferredPrintableInputListener (): void {
        this.clearDeferredPrintableInput()

        if (!this.boundDeferredPrintableInput) {
            return
        }

        this.xterm.textarea?.removeEventListener('beforeinput', this.boundDeferredPrintableInput)
        this.xterm.textarea?.removeEventListener('input', this.boundDeferredPrintableInput)
        delete this.boundDeferredPrintableInput
    }

    private setFontSize () {
        const scale = Math.pow(1.1, this.zoom)
        this.xterm.options.fontSize = this.configuredFontSize * scale
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        this.xterm.options.lineHeight = Math.max(1, (this.configuredFontSize + this.configuredLinePadding * 2) / this.configuredFontSize)
        this.resizeHandler()
    }

    private getSelectionAsHTML (): string {
        return this.serializeAddon.serializeAsHTML({ includeGlobalBackground: true, onlySelection: true  })
    }

    /**
     * Refit the terminal to its container and refresh the display.
     * Used to restore canvas dimensions after they've been zeroed out
     * (e.g., when a tab becomes visible again after being hidden).
     */
    refit (): void {
        try {
            if (this.xterm.element && getComputedStyle(this.xterm.element).getPropertyValue('height') !== 'auto') {
                const canvasZeroed = this.xterm.element.querySelector('canvas')?.width === 0
                if (!canvasZeroed && this.xterm.cols > 0 && this.xterm.rows > 0) {
                    return
                }
                this.clearPendingObservedResize()
                this.suppressObservedResize()
                const prevCols = this.xterm.cols
                const prevRows = this.xterm.rows
                this.fitAddon.fit()
                // If canvas was zeroed (GPU memory optimization for hidden tabs)
                // and fit() didn't restore it (dimensions unchanged),
                // force a resize cycle to rebuild canvas elements
                if (canvasZeroed
                    && this.xterm.element.querySelector('canvas')?.width === 0
                    && prevCols > 0 && prevRows > 0
                    && this.xterm.cols === prevCols && this.xterm.rows === prevRows) {
                    this.xterm.resize(prevCols, prevRows + 1)
                    this.xterm.resize(prevCols, prevRows)
                }
                if (canvasZeroed && this.xterm.rows > 0) {
                    this.xterm.refresh(0, this.xterm.rows - 1)
                }
            }
        } catch (e) {
            console.warn('Could not refit xterm', e)
        }
    }

    private shouldSkipObservedResize (): boolean {
        return this.layoutTransitionActive || Date.now() < this.skipObservedResizeUntil
    }

    private suppressObservedResize (): void {
        this.skipObservedResizeUntil = Date.now() + this.observedResizeResumeDelay
    }

    private clearPendingObservedResize (): void {
        if (this.pendingObservedResizeFrame !== null) {
            cancelAnimationFrame(this.pendingObservedResizeFrame)
            this.pendingObservedResizeFrame = null
        }
    }

    private scheduleObservedResize (): void {
        if (this.pendingObservedResizeFrame !== null) {
            return
        }
        this.pendingObservedResizeFrame = requestAnimationFrame(() => {
            this.pendingObservedResizeFrame = null
            if (!this.enableResizing || this.shouldSkipObservedResize()) {
                return
            }
            this.resizeHandler()
        })
    }
}

/** @hidden */
export class XTermWebGLFrontend extends XTermFrontend {
    protected enableWebGL = true
}
