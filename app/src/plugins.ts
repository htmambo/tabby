import * as fs from 'mz/fs'
import * as path from 'path'
import { rm } from 'node:fs/promises'
import * as remote from '@electron/remote'
import { PluginInfo } from '../../tabby-core/src/api/mainProcess'
import { PLUGIN_BLACKLIST } from './pluginBlacklist'

const nodeModule = require('module') // eslint-disable-line @typescript-eslint/no-var-requires

const nodeRequire = global['require']
let managedUserPluginsNodeModulesPath: string | null = null

function normalizePath (p: string): string {
    const cygwinPrefix = '/cygdrive/'
    if (p.startsWith(cygwinPrefix)) {
        p = p.substring(cygwinPrefix.length).replace('/', '\\')
        p = p[0] + ':' + p.substring(1)
    }
    return p
}

const builtinPluginsPath = process.env.TABBY_DEV ? path.dirname(remote.app.getAppPath()) : path.join((process as any).resourcesPath, 'builtin-plugins')
const configuredBuiltinPluginRootPaths = (process.env.TABBY_BUILTIN_PLUGINS || '')
    .split(path.delimiter)
    .filter(Boolean)
    .map(x => normalizePath(path.resolve(x)))
const builtinPluginRootPaths = [
    normalizePath(builtinPluginsPath),
    ...configuredBuiltinPluginRootPaths,
]
const builtinPluginRoots = new Set<string>([
    ...builtinPluginRootPaths.map(x => normalizePathForCompare(x)),
])

const cachedBuiltinModules = {
    '@angular/animations': require('@angular/animations'),
    '@angular/cdk/drag-drop': require('@angular/cdk/drag-drop'),
    '@angular/cdk/clipboard': require('@angular/cdk/clipboard'),
    '@angular/common': require('@angular/common'),
    '@angular/compiler': require('@angular/compiler'),
    '@angular/core': require('@angular/core'),
    '@angular/forms': require('@angular/forms'),
    '@angular/localize': require('@angular/localize'),
    '@angular/localize/init': require('@angular/localize/init'),
    '@angular/platform-browser': require('@angular/platform-browser'),
    '@angular/platform-browser/animations': require('@angular/platform-browser/animations'),
    '@angular/platform-browser-dynamic': require('@angular/platform-browser-dynamic'),
    '@ng-bootstrap/ng-bootstrap': require('@ng-bootstrap/ng-bootstrap'),
    'ngx-toastr': require('ngx-toastr'),
    rxjs: require('rxjs'),
    'rxjs/operators': require('rxjs/operators'),
    'zone.js/dist/zone.js': require('zone.js'),
    'zone.js': require('zone.js'),
}

const builtinModules = [
    ...Object.keys(cachedBuiltinModules),
    'tabby-core',
    'tabby-local',
    'tabby-settings',
    'tabby-terminal',
]

const originalRequire = (global as any).require
;(global as any).require = function (query: string) {
    if (cachedBuiltinModules[query]) {
        return cachedBuiltinModules[query]
    }
    return originalRequire.apply(this, [query])
}

const originalModuleRequire = nodeModule.prototype.require
nodeModule.prototype.require = function (query: string) {
    if (cachedBuiltinModules[query]) {
        return cachedBuiltinModules[query]
    }
    return originalModuleRequire.call(this, query)
}

export type ProgressCallback = (current: number, total: number) => void

function isBuiltinPluginDir (pluginDir: string): boolean {
    return builtinPluginRoots.has(normalizePathForCompare(pluginDir))
}

function resolveBuiltinPackagePath (packageName: string): string | null {
    for (const root of builtinPluginRootPaths) {
        const candidate = path.join(root, packageName)
        if (require('fs').existsSync(path.join(candidate, 'package.json'))) {
            return candidate
        }
    }
    return null
}

export function initModuleLookup (userPluginsPath: string): void {
    global['module'].paths.map((x: string) => nodeModule.globalPaths.push(normalizePath(x)))

    const paths = []
    managedUserPluginsNodeModulesPath = normalizePath(path.resolve(path.join(userPluginsPath, 'node_modules')))
    paths.unshift(path.join(userPluginsPath, 'node_modules'))
    paths.unshift(path.join(remote.app.getAppPath(), 'node_modules'))

    if (process.env.TABBY_DEV) {
        paths.unshift(path.dirname(remote.app.getAppPath()))
    }

    paths.unshift(builtinPluginsPath)
    // paths.unshift(path.join((process as any).resourcesPath, 'app.asar', 'node_modules'))
    if (process.env.TABBY_PLUGINS) {
        process.env.TABBY_PLUGINS
            .split(path.delimiter)
            .filter(Boolean)
            .map(x => paths.push(normalizePath(path.resolve(x))))
    }

    process.env.NODE_PATH = [
        process.env.NODE_PATH || '',
        paths.join(path.delimiter),
    ].filter(Boolean).join(path.delimiter)
    nodeModule._initPaths()

    builtinModules.forEach(m => {
        if (!cachedBuiltinModules[m]) {
            const builtinPackagePath = resolveBuiltinPackagePath(m)
            if (builtinPackagePath) {
                cachedBuiltinModules[m] = nodeRequire(builtinPackagePath)
                console.info(`Pinned builtin module ${m} to ${builtinPackagePath}`)
            } else {
                cachedBuiltinModules[m] = nodeRequire(m)
            }
        }
    })
}

const PLUGIN_PREFIX = 'tabby-'
const LEGACY_PLUGIN_PREFIX = 'terminus-'

async function getCandidateLocationsInPluginDir (pluginDir: any): Promise<{ pluginDir: string, packageName: string }[]> {
    const candidateLocations: { pluginDir: string, packageName: string }[] = []

    if (await fs.exists(pluginDir)) {
        const pluginNames = await fs.readdir(pluginDir)
        if (await fs.exists(path.join(pluginDir, 'package.json'))) {
            candidateLocations.push({
                pluginDir: path.dirname(pluginDir),
                packageName: path.basename(pluginDir),
            })
        }

        const promises = []

        for (const packageName of pluginNames) {
            if ((packageName.startsWith(PLUGIN_PREFIX) || packageName.startsWith(LEGACY_PLUGIN_PREFIX)) && !PLUGIN_BLACKLIST.includes(packageName)) {
                const pluginPath = path.join(pluginDir, packageName)
                const infoPath = path.join(pluginPath, 'package.json')
                promises.push(fs.exists(infoPath).then(result => {
                    if (result) {
                        candidateLocations.push({ pluginDir, packageName })
                    }
                }))
            }
        }

        await Promise.all(promises)
    }

    return candidateLocations
}

async function getPluginCandidateLocation (paths: any): Promise<{ pluginDir: string, packageName: string }[]> {
    const candidateLocationsPromises: Promise<{ pluginDir: string, packageName: string }[]>[] = []

    const processedPaths = []

    for (let pluginDir of paths) {
        if (processedPaths.includes(pluginDir)) {
            continue
        }
        processedPaths.push(pluginDir)

        pluginDir = normalizePath(pluginDir)

        candidateLocationsPromises.push(getCandidateLocationsInPluginDir(pluginDir))

    }

    const candidateLocations: { pluginDir: string, packageName: string }[] = []
    for (const pluginCandidateLocations of await Promise.all(candidateLocationsPromises)) {
        candidateLocations.push(...pluginCandidateLocations)
    }

    return candidateLocations
}

async function parsePluginInfo (pluginDir: string, packageName: string): Promise<PluginInfo|null> {
    const pluginPath = path.join(pluginDir, packageName)
    const infoPath = path.join(pluginPath, 'package.json')

    const name = packageName.startsWith(PLUGIN_PREFIX) ? packageName.substring(PLUGIN_PREFIX.length) : packageName.substring(LEGACY_PLUGIN_PREFIX.length)

    try {
        const info = JSON.parse(await fs.readFile(infoPath, { encoding: 'utf-8' }))

        if (!info.keywords || !(info.keywords.includes('terminus-plugin') || info.keywords.includes('terminus-builtin-plugin') || info.keywords.includes('tabby-plugin') || info.keywords.includes('tabby-builtin-plugin'))) {
            return null
        }

        let author = info.author
        author = author.name || author

        console.log(`Found ${name} in ${pluginDir}`)

        return {
            name: name,
            packageName: packageName,
            isBuiltin: isBuiltinPluginDir(pluginDir),
            isLegacy: info.keywords.includes('terminus-plugin') || info.keywords.includes('terminus-builtin-plugin'),
            version: info.version,
            description: info.description,
            author,
            path: pluginPath,
            info,
        }
    } catch (error) {
        console.error('Cannot load package info for', packageName)
        return null
    }
}

function normalizePathForCompare (p: string): string {
    return normalizePath(path.resolve(p)).replace(/\\/g, '/').toLowerCase()
}

function isManagedUserPluginCopy (pluginPath: string): boolean {
    if (!managedUserPluginsNodeModulesPath) {
        return false
    }
    const managedRoot = normalizePathForCompare(managedUserPluginsNodeModulesPath)
    const target = normalizePathForCompare(pluginPath)
    return target === managedRoot || target.startsWith(`${managedRoot}/`)
}

function cleanupStaleUserPluginCopy (stalePlugin: PluginInfo, builtinPlugin: PluginInfo): void {
    if (stalePlugin.isBuiltin || !stalePlugin.path) {
        return
    }
    if (!isManagedUserPluginCopy(stalePlugin.path)) {
        console.info(`Skip cleanup for ${stalePlugin.packageName}: path is outside managed user plugin cache (${stalePlugin.path})`)
        return
    }

    rm(stalePlugin.path, { recursive: true, force: true })
        .then(() => {
            console.info(`Removed stale cached plugin ${stalePlugin.packageName}@${stalePlugin.version}, using builtin ${builtinPlugin.version}`)
        })
        .catch(error => {
            console.warn(`Failed to remove stale cached plugin ${stalePlugin.packageName} at ${stalePlugin.path}`, error)
        })
}

function resolveDuplicatePlugin (existing: PluginInfo, candidate: PluginInfo): PluginInfo {
    // 优先非 legacy 插件
    if (existing.isLegacy !== candidate.isLegacy) {
        const preferred = existing.isLegacy ? candidate : existing
        console.info(`Plugin ${candidate.packageName} already exists, using ${preferred.packageName} (non-legacy preferred)`)
        return preferred
    }

    // 内置插件与缓存/用户插件冲突时：
    // 1. 若版本不一致，直接使用内置插件（视为更新到内置版本）
    // 2. 若版本一致，也统一使用内置插件，避免重复来源导致不确定行为
    if (existing.isBuiltin !== candidate.isBuiltin) {
        const builtin = existing.isBuiltin ? existing : candidate
        const cached = existing.isBuiltin ? candidate : existing
        if (builtin.version !== cached.version) {
            console.info(`Plugin ${cached.packageName} cache version ${cached.version} differs from builtin ${builtin.version}, using builtin`)
        } else {
            console.info(`Plugin ${cached.packageName} cache version matches builtin (${builtin.version}), using builtin`)
        }
        cleanupStaleUserPluginCopy(cached, builtin)
        return builtin
    }

    // 同来源重复（都内置或都非内置）时保留先发现的一项
    console.info(`Plugin ${candidate.packageName} already exists, keeping ${existing.packageName}`)
    return existing
}

export async function findPlugins (): Promise<PluginInfo[]> {
    const paths = nodeModule.globalPaths
    const foundPlugins: PluginInfo[] = []

    const candidateLocations: { pluginDir: string, packageName: string }[] = await getPluginCandidateLocation(paths)

    const foundPluginsPromises: Promise<PluginInfo|null>[] = []
    for (const { pluginDir, packageName } of candidateLocations) {

        if (builtinModules.includes(packageName) && !isBuiltinPluginDir(pluginDir)) {
            continue
        }

        foundPluginsPromises.push(parsePluginInfo(pluginDir, packageName))
    }

    for (const pluginInfo of await Promise.all(foundPluginsPromises)) {
        if (pluginInfo) {
            const existingIndex = foundPlugins.findIndex(x => x.name === pluginInfo.name)
            if (existingIndex >= 0) {
                foundPlugins[existingIndex] = resolveDuplicatePlugin(foundPlugins[existingIndex], pluginInfo)
                continue
            }

            foundPlugins.push(pluginInfo)
        }
    }

    foundPlugins.sort((a, b) => a.name > b.name ? 1 : -1)
    foundPlugins.sort((a, b) => a.isBuiltin < b.isBuiltin ? 1 : -1)
    return foundPlugins
}

export async function loadPlugins (foundPlugins: PluginInfo[], progress: ProgressCallback): Promise<any[]> {
    const plugins: any[] = []
    const pluginsPromises: Promise<any>[] = []

    let index = 0
    const setProgress = function () {
        index++
        progress(index, foundPlugins.length)
    }

    progress(0, 1)
    for (const foundPlugin of foundPlugins) {
        pluginsPromises.push(new Promise(x => {
            try {
                let resolvedPath = foundPlugin.path
                try {
                    if (foundPlugin.path) {
                        resolvedPath = nodeRequire.resolve(foundPlugin.path)
                    }
                } catch {
                    // Ignore resolution errors here; the actual load attempt below will report them if needed.
                }
                console.info(`Loading ${foundPlugin.name}: ${resolvedPath}`)
                const packageModule = nodeRequire(foundPlugin.path)
                if (foundPlugin.packageName.startsWith('tabby-')) {
                    cachedBuiltinModules[foundPlugin.packageName.replace('tabby-', 'terminus-')] = packageModule
                }
                const pluginRootModule = packageModule.default
                if (!pluginRootModule) {
                    throw new Error(`Plugin ${foundPlugin.name} has no default export`)
                }
                const pluginModule = pluginRootModule.forRoot ? pluginRootModule.forRoot() : pluginRootModule
                pluginModule.pluginName = foundPlugin.name
                pluginModule.bootstrap = packageModule.bootstrap
                console.info(`Loaded ${foundPlugin.name}:`, {
                    hasDefaultExport: !!packageModule.default,
                    hasBootstrapExport: !!packageModule.bootstrap,
                    pluginName: pluginModule.pluginName,
                    moduleName: pluginModule?.constructor?.name,
                })
                plugins.push(pluginModule)
            } catch (error) {
                console.error(`Could not load ${foundPlugin.name}:`, error)
            }
            setProgress()
            setTimeout(x, 50)
        }))
    }
    await Promise.all(pluginsPromises)

    progress(1, 1)
    return plugins
}
