/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { BehaviorSubject, Observable, catchError, combineLatest, debounceTime, distinctUntilChanged, first, map, of, shareReplay, switchMap, tap } from 'rxjs'
import semverGt from 'semver/functions/gt'

import { Component, HostBinding, Input } from '@angular/core'
import { ConfigService, PlatformService, PluginInfo, TranslateService } from 'tabby-core'
import { AvailablePluginInfo, PluginManagerService } from '../services/pluginManager.service'

enum BusyState { Installing = 'Installing', Uninstalling = 'Uninstalling' }

const FORCE_ENABLE = ['tabby-core', 'tabby-settings', 'tabby-electron', 'tabby-plugin-manager']

_('Search plugins')
_('Some plugin sources failed to load. Results may be incomplete.')
_('No plugins matched your search')
_('Show community plugins')
_('Community plugins are not verified and can run local code with your user permissions.')
_('Install unverified plugin?')
_('This plugin is not marked as official. Installing it will execute third-party code on your machine with your account permissions.')
_('Install anyway')

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './pluginsSettingsTab.component.pug',
    styleUrls: ['./pluginsSettingsTab.component.scss'],
})
export class PluginsSettingsTabComponent {
    BusyState = BusyState
    @Input() availablePlugins$: Observable<AvailablePluginInfo[]>
    @Input() availablePluginsQuery$ = new BehaviorSubject<string>('')
    @Input() availablePluginsReady = false
    @Input() installedPluginsQuery$ = new BehaviorSubject<string>('')
    @Input() knownUpgrades: Record<string, AvailablePluginInfo|null> = {}
    @Input() busy = new Map<string, BusyState>()
    @Input() erroredPlugin: string
    @Input() errorMessage: string
    @Input() showUnofficialPlugins = false

    private readonly showUnofficialPlugins$ = new BehaviorSubject<boolean>(this.showUnofficialPlugins)

    @HostBinding('class.content-box') readonly contentBox = true

    installedPlugins$: PluginInfo[] = []
    availableWarnings: string[] = []
    installedFilter = ''
    availableFilter = ''

    constructor (
        private config: ConfigService,
        private platform: PlatformService,
        public pluginManager: PluginManagerService,
        private translate: TranslateService,
    ) {
    }

    ngOnInit () {
        this.showUnofficialPlugins$.next(this.showUnofficialPlugins)

        const availableResults$: Observable<AvailablePluginInfo[]> = this.availablePluginsQuery$
            .asObservable()
            .pipe(
                debounceTime(200),
                distinctUntilChanged(),
                switchMap(query => {
                    this.availablePluginsReady = false
                    this.availableWarnings = []
                    return this.pluginManager.listAvailable(query).pipe(tap(() => {
                        this.erroredPlugin = ''
                        this.errorMessage = ''
                        this.availablePluginsReady = true
                    }), map(result => {
                        this.availableWarnings = result.warnings
                        return result.plugins
                    }), catchError(error => {
                        console.error('Error listing available plugins', error)
                        this.erroredPlugin = 'available plugins'
                        this.errorMessage = `${error}`
                        this.availablePluginsReady = true
                        return of<AvailablePluginInfo[]>([])
                    }))
                }),
                shareReplay({ bufferSize: 1, refCount: true }),
            )

        this.availablePlugins$ = combineLatest([
            availableResults$,
            this.showUnofficialPlugins$,
        ]).pipe(
            map(([available, showUnofficial]) => showUnofficial ? available : available.filter(plugin => plugin.isOfficial)),
        )

        availableResults$.pipe(first()).subscribe(available => {
            for (const plugin of this.pluginManager.installedPlugins) {
                this.knownUpgrades[plugin.name] = available.find(x => x.name === plugin.name && semverGt(x.version, plugin.version)) ?? null
            }
        })

        this.installedPluginsQuery$
            .asObservable()
            .pipe(
                debounceTime(200),
                distinctUntilChanged(),
                switchMap(query => {
                    return this.pluginManager.listInstalled(query)
                }),
            ).subscribe(plugin => {
                this.installedPlugins$ = plugin
            })
    }

    toggleShowUnofficialPlugins (value: boolean): void {
        this.showUnofficialPlugins = value
        this.showUnofficialPlugins$.next(value)
    }

    openPluginsFolder (): void {
        this.platform.openPath(this.pluginManager.userPluginsPath)
    }

    searchAvailable (query: string) {
        this.availablePluginsQuery$.next(query)
    }

    searchInstalled (query: string) {
        this.installedPluginsQuery$.next(query)
    }

    isAlreadyInstalled (plugin: PluginInfo): boolean {
        return this.pluginManager.installedPlugins.some(x => x.name === plugin.name)
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        if (!(plugin as AvailablePluginInfo).isOfficial) {
            const result = await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant(_('Install unverified plugin?')),
                detail: this.translate.instant(_('This plugin is not marked as official. Installing it will execute third-party code on your machine with your account permissions.')),
                buttons: [
                    this.translate.instant(_('Install anyway')),
                    this.translate.instant(_('Cancel')),
                ],
                defaultId: 1,
                cancelId: 1,
            })
            if (result.response === 1) {
                return
            }
        }

        this.busy.set(plugin.name, BusyState.Installing)
        try {
            await this.pluginManager.installPlugin(plugin)
            this.busy.delete(plugin.name)
            this.config.requestRestart()
        } catch (err) {
            console.error('Error installing plugin', plugin.name, err)
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            this.busy.delete(plugin.name)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        this.busy.set(plugin.name, BusyState.Uninstalling)
        try {
            await this.pluginManager.uninstallPlugin(plugin)
            this.busy.delete(plugin.name)
            this.config.requestRestart()
        } catch (err) {
            console.error('Error uninstalling plugin', plugin.name, err)
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            this.busy.delete(plugin.name)
            throw err
        }
    }

    async upgradePlugin (plugin: PluginInfo): Promise<void> {
        return this.installPlugin(this.knownUpgrades[plugin.name]!)
    }

    showPluginInfo (plugin: PluginInfo) {
        this.platform.openExternal('https://www.npmjs.com/package/' + plugin.packageName)
    }

    showPluginHomepage (plugin: PluginInfo) {
        this.platform.openExternal(plugin.homepage ?? '')
    }

    isPluginEnabled (plugin: PluginInfo) {
        return !this.config.store.pluginBlacklist.includes(plugin.name)
    }

    canDisablePlugin (plugin: PluginInfo) {
        return !FORCE_ENABLE.includes(plugin.packageName)
    }

    togglePlugin (plugin: PluginInfo) {
        if (this.isPluginEnabled(plugin)) {
            this.disablePlugin(plugin)
        } else {
            this.enablePlugin(plugin)
        }
    }

    enablePlugin (plugin: PluginInfo) {
        this.config.store.pluginBlacklist = this.config.store.pluginBlacklist.filter((x: string) => x !== plugin.name)
        this.config.save()
        this.config.requestRestart()
    }

    disablePlugin (plugin: PluginInfo) {
        this.config.store.pluginBlacklist = [...this.config.store.pluginBlacklist, plugin.name]
        this.config.save()
        this.config.requestRestart()
    }
}
