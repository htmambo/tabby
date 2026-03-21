import { afterNextRender, Component, Injector, NgZone, OnDestroy } from '@angular/core'
import { DomSanitizer, SafeHtml } from '@angular/platform-browser'
import { HomeBaseService } from '../services/homeBase.service'
import { CommandService } from '../services/commands.service'
import { PlatformService } from '../api/platform'
import { Command, CommandLocation } from '../api/commands'

interface StartPageCommand extends Command {
    safeIcon: SafeHtml
}

type IdleRequestCallbackLike = () => void
type IdleRequestOptionsLike = {
    timeout?: number
}
type IdleCallbackGlobal = typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallbackLike, options?: IdleRequestOptionsLike) => number
    cancelIdleCallback?: (handle: number) => void
}

/** @hidden */
@Component({
    standalone: false,
    selector: 'start-page',
    templateUrl: './startPage.component.pug',
    styleUrls: ['./startPage.component.scss'],
})
export class StartPageComponent implements OnDestroy {
    appVersion: string
    commands: StartPageCommand[] = []
    private readonly startupCommandLoadDelay = 150
    private readonly startupHomeBaseInitDelay = 250
    private readonly startupIdleFallbackDelay = 50
    private readonly startupCommandLoadIdleTimeout = 800
    private readonly startupHomeBaseInitIdleTimeout = 1500
    private destroyed = false
    private pendingTimeouts = new Set<number>()
    private pendingIdleCallbacks = new Set<number>()
    private commandServiceInstance: CommandService | null = null
    private homeBaseServiceInstance: HomeBaseService | null = null

    constructor (
        private injector: Injector,
        private domSanitizer: DomSanitizer,
        private ngZone: NgZone,
    ) {
        this.appVersion = this.injector.get(PlatformService).getAppVersion()
        afterNextRender(() => {
            this.scheduleIdleTask(() => {
                if (this.destroyed) {
                    return
                }
                void this.homeBase
            }, this.startupHomeBaseInitDelay, this.startupHomeBaseInitIdleTimeout)
            this.scheduleIdleTask(async () => {
                try {
                    const loadedCommands = await this.commandService.getCommands({})
                    if (this.destroyed) {
                        return
                    }
                    const commands = loadedCommands
                        .filter(x => x.locations?.includes(CommandLocation.StartPage))
                        .map(command => ({
                            ...command,
                            safeIcon: this.domSanitizer.bypassSecurityTrustHtml(command.icon ?? ''),
                        }))
                    this.runInAngular(() => {
                        this.commands = commands
                    })
                } catch (error) {
                    console.warn('Failed to load start page commands', error)
                }
            }, this.startupCommandLoadDelay, this.startupCommandLoadIdleTimeout)
        })
    }

    private runInAngular (callback: () => void): void {
        if (NgZone.isInAngularZone()) {
            callback()
            return
        }
        this.ngZone.run(callback)
    }

    private scheduleIdleTask (fn: () => void, delay = 0, timeout = 1000): void {
        this.scheduleTimeout(() => {
            this.scheduleIdleCallback(fn, timeout)
        }, delay)
    }

    private scheduleIdleCallback (fn: () => void, timeout = 1000): number | null {
        if (this.destroyed) {
            return null
        }
        const idleGlobal = globalThis as IdleCallbackGlobal
        if (idleGlobal.requestIdleCallback) {
            let handle = 0
            handle = idleGlobal.requestIdleCallback(() => {
                this.pendingIdleCallbacks.delete(handle)
                if (this.destroyed) {
                    return
                }
                fn()
            }, { timeout })
            this.pendingIdleCallbacks.add(handle)
            return handle
        }
        return this.scheduleTimeout(fn, this.startupIdleFallbackDelay)
    }

    private scheduleTimeout (fn: () => void, delay = 0): number | null {
        if (this.destroyed) {
            return null
        }
        const handle = window.setTimeout(() => {
            this.pendingTimeouts.delete(handle)
            if (this.destroyed) {
                return
            }
            fn()
        }, delay)
        this.pendingTimeouts.add(handle)
        return handle
    }

    private clearPendingIdleCallbacks (): void {
        const idleGlobal = globalThis as IdleCallbackGlobal
        if (!idleGlobal.cancelIdleCallback) {
            this.pendingIdleCallbacks.clear()
            return
        }
        for (const handle of this.pendingIdleCallbacks) {
            idleGlobal.cancelIdleCallback(handle)
        }
        this.pendingIdleCallbacks.clear()
    }

    private clearPendingTimeouts (): void {
        for (const handle of this.pendingTimeouts) {
            window.clearTimeout(handle)
        }
        this.pendingTimeouts.clear()
    }

    private get commandService (): CommandService {
        this.commandServiceInstance ??= this.injector.get(CommandService)
        return this.commandServiceInstance
    }

    private get homeBase (): HomeBaseService {
        this.homeBaseServiceInstance ??= this.injector.get(HomeBaseService)
        return this.homeBaseServiceInstance
    }

    openGitHub (): void {
        this.homeBase.openGitHub()
    }

    reportBug (): void {
        this.homeBase.reportBug()
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    buttonsTrackBy (_index: number, btn: StartPageCommand): any {
        return btn.label + btn.icon
    }

    ngOnDestroy (): void {
        this.destroyed = true
        this.clearPendingIdleCallbacks()
        this.clearPendingTimeouts()
    }
}
