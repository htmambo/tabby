import axios from 'axios'
import { compare as semverCompare } from 'semver'
import { Observable, catchError, from, forkJoin, map, of } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { Logger, LogService, PlatformService, BOOTSTRAP_DATA, BootstrapData, PluginInfo } from 'tabby-core'
import { PLUGIN_BLACKLIST } from '../../../app/src/pluginBlacklist'

const OFFICIAL_NPM_ACCOUNT = 'eugenepankov'

interface NPMRegistrySearchPackage {
    name?: string
    keywords?: string[]
    version?: string
    description?: string
    author?: {
        name?: string
    } | string
    maintainers?: {
        username?: string
    }[]
    publisher?: {
        username?: string
    }
    links?: {
        homepage?: string
    }
}

interface NPMRegistrySearchObject {
    package?: NPMRegistrySearchPackage
}

interface NPMRegistrySearchResponse {
    objects?: NPMRegistrySearchObject[]
}

export interface AvailablePluginInfo extends PluginInfo {
    isOfficial: boolean
    searchScore?: number
}

export interface AvailablePluginsResult {
    plugins: AvailablePluginInfo[]
    warnings: string[]
}


@Injectable({ providedIn: 'root' })
export class PluginManagerService {
    logger: Logger
    userPluginsPath: string
    installedPlugins: PluginInfo[]

    private constructor (
        log: LogService,
        private platform: PlatformService,
        @Inject(BOOTSTRAP_DATA) bootstrapData: BootstrapData,
    ) {
        this.logger = log.create('pluginManager')
        this.installedPlugins = [...bootstrapData.installedPlugins]
        this.installedPlugins.sort((a, b) => a.name.localeCompare(b.name))
        this.userPluginsPath = bootstrapData.userPluginsPath
    }

    listAvailable (query?: string): Observable<AvailablePluginsResult> {
        const warnings: string[] = []
        return forkJoin(
            this._listAvailableInternal('tabby-', 'tabby-plugin', query, warnings),
            this._listAvailableInternal('terminus-', 'terminus-plugin', query, warnings),
        ).pipe(
            map(x => x.reduce((a, b) => a.concat(b), [])),
            map(x => {
                const names = new Set<string>()
                return x.filter(item => {
                    if (names.has(item.name)) {
                        return false
                    }
                    names.add(item.name)
                    return true
                })
            }),
map(x => x.sort((a, b) => b.searchScore! - a.searchScore!)),
            map(plugins => ({
                plugins,
                warnings: [...warnings],
            })),
        )
    }

    listInstalled (query: string): Observable<PluginInfo[]> {
        return of(this.installedPlugins.filter(x=>x.name.includes(query)))
    }

    _listAvailableInternal (namePrefix: string, keyword: string, query: string|undefined, warnings: string[]): Observable<AvailablePluginInfo[]> {
        const encodedQuery = encodeURIComponent((query ?? '').trim())
        const url = `https://registry.npmjs.com/-/v1/search?text=keywords%3A${keyword}${encodedQuery ? `%20${encodedQuery}` : ''}&size=250`

        return from(
            axios.get<NPMRegistrySearchResponse>(url, { timeout: 10000 }),
        ).pipe(
map(response => response.data.objects ?? []),
            map(items => items
                .map(item => this.parseRegistryPlugin(item, namePrefix))
                .filter((plugin): plugin is AvailablePluginInfo => plugin !== null),
            ),
            map(plugins => {
                const mapping: Record<string, AvailablePluginInfo[]> = {}
                for (const p of plugins) {
                    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
                    mapping[p.name] ??= []
                    mapping[p.name].push(p)
                }
                return Object.values(mapping).map(list => {
                    list.sort((a, b) => this.comparePluginVersions(a, b))
                    return list[0]
                })
            }),
            map(plugins => plugins.sort((a, b) => a.name.localeCompare(b.name))),
            catchError(error => {
                const warning = `Failed to load npm registry results for ${keyword}`
                warnings.push(warning)
                this.logger.warn(`${warning}: ${url}`, error)
                return of([])
            }),
        )
    }

    private parseRegistryPlugin (item: NPMRegistrySearchObject, namePrefix: string): AvailablePluginInfo | null {
        const info = item.package
        if (!info?.name?.startsWith(namePrefix)) {
            return null
        }
        if (info.keywords?.includes('tabby-dummy-transition-plugin')) {
            return null
        }
        if (PLUGIN_BLACKLIST.includes(info.name)) {
            return null
        }
        if (!info.version) {
            this.logger.warn(`Skipping plugin ${info.name}: missing version in npm registry response`)
            return null
        }

        return {
            name: info.name.substring(namePrefix.length),
            packageName: info.name,
            description: info.description ?? '',
            version: info.version,
            homepage: info.links?.homepage,
            author: this.getPluginAuthor(info),
            isOfficial: info.publisher?.username === OFFICIAL_NPM_ACCOUNT,
            searchScore: item.searchScore,
            isBuiltin: false,
            isLegacy: [
                info.name.startsWith('terminus-'),
                info.keywords?.includes('terminus-plugin') ?? false,
                info.keywords?.includes('terminus-builtin-plugin') ?? false,
            ].some(Boolean),
        }
    }

    private getPluginAuthor (info: NPMRegistrySearchPackage): string {
        if (typeof info.author === 'string') {
            return info.author
        }
        if (info.author?.name) {
            return info.author.name
        }
        return info.maintainers?.[0]?.username ?? info.publisher?.username ?? ''
    }

    private comparePluginVersions (a: PluginInfo, b: PluginInfo): number {
        try {
            return -semverCompare(a.version, b.version)
        } catch (error) {
            this.logger.warn(`Failed to compare plugin versions for ${a.packageName} (${a.version}) and ${b.packageName} (${b.version})`, error)
            return b.version.localeCompare(a.version)
        }
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.installPlugin(plugin.packageName, plugin.version)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
            this.installedPlugins.push(plugin)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.uninstallPlugin(plugin.packageName)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }
}
