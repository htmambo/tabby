/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { NgModule } from '@angular/core'
import { BrowserModule } from '@angular/platform-browser'
import { ToastrModule } from 'ngx-toastr'

type ZoneSymbolProvider = {
    __symbol__?: (name: string) => string
}

function patchZoneAwareRequestAnimationFrame (): void {
    const zone = (window as Window & { Zone?: ZoneSymbolProvider }).Zone
    const zoneSymbol = zone?.__symbol__?.('requestAnimationFrame')
    if (!zoneSymbol) {
        return
    }
    const windowAny = window as unknown as Record<string, unknown>
    const zoneRequestAnimationFrame = windowAny[zoneSymbol]
    if (typeof zoneRequestAnimationFrame === 'function') {
        window.requestAnimationFrame = zoneRequestAnimationFrame as typeof window.requestAnimationFrame
    }
}

export function getRootModule (plugins: any[]) {
    const imports = [
        BrowserModule,
        ...plugins,
        ToastrModule.forRoot({
            positionClass: 'toast-bottom-center',
            toastClass: 'toast',
            preventDuplicates: true,
            extendedTimeOut: 1000,
        }),
    ]

    const bootstrap = [
        ...plugins.filter(x => x.bootstrap).map(x => x.bootstrap),
    ]

    if (bootstrap.length === 0) {
        throw new Error('Did not find any bootstrap components. Are there any plugins installed?')
    }

    @NgModule({
        imports,
        bootstrap,
    }) class RootModule {
        constructor () {
            patchZoneAwareRequestAnimationFrame()
        }
    }

    return RootModule
}
