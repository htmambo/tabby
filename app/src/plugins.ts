import * as path from 'path'
import { access, readFile, readdir, rm, stat } from 'node:fs/promises'
import * as angularAnimations from '@angular/animations'
import * as angularCdkClipboard from '@angular/cdk/clipboard'
import * as angularCdkDragDrop from '@angular/cdk/drag-drop'
import * as angularCommon from '@angular/common'
import * as angularCompiler from '@angular/compiler'
import * as angularCore from '@angular/core'
import * as angularForms from '@angular/forms'
import * as angularLocalize from '@angular/localize'
import '@angular/localize/init'
import * as angularPlatformBrowser from '@angular/platform-browser'
import * as angularPlatformBrowserAnimations from '@angular/platform-browser/animations'
import * as angularPlatformBrowserDynamic from '@angular/platform-browser-dynamic'
import * as ngBootstrap from '@ng-bootstrap/ng-bootstrap'
import * as ngxToastr from 'ngx-toastr'
import * as rxjsModule from 'rxjs'
import * as rxjsOperators from 'rxjs/operators'
import * as zoneJs from 'zone.js'
import { TabbyPluginManifest } from '../../tabby-core/src/api/plugin-manifest'
import { getRuntimeCwd, getRuntimeEnv, getRuntimeResourcesPath, isRuntimeDev, setRuntimeEnv } from '../../tabby-core/src/api/rendererRuntime'
import { PluginInfo } from '../../tabby-core/src/api/mainProcess'
import { PLUGIN_BLACKLIST } from './pluginBlacklist'
import { getNodeRequire, getTabbyBridge } from './tabby-bridge'

type NodeModuleRuntime = typeof import('module') & {
    globalPaths: string[]
    _initPaths: () => void
    prototype: {
        require: NodeJS.Require
    }
}

type NodeModuleContext = {
    filename?: string
    path?: string
    parent?: NodeModuleContext | null
}

type GlobalModuleTarget = typeof globalThis & {
    module?: {
        paths?: string[]
    }
}

interface PluginDiscoveryCachePathState {
    path: string
    exists: boolean
    mtimeMs: number
}

interface PluginDiscoveryCacheEntry {
    version: number
    lookupPaths: string[]
    pathStates: PluginDiscoveryCachePathState[]
    plugins: PluginInfo[]
}

export interface FindPluginsResult {
    plugins: PluginInfo[]
    fromCache: boolean
}

const nodeRequire = getNodeRequire()
const nodeModule = nodeRequire('module') as NodeModuleRuntime
const bridgeIPC = getTabbyBridge().ipc
let managedUserPluginsNodeModulesPath: string | null = null
let pluginLookupPaths: string[] = []
const pluginRuntimeRoots = new Set<string>()
const PLUGIN_DISCOVERY_CACHE_KEY = 'tabby.pluginDiscoveryCache.v1'
const PLUGIN_DISCOVERY_CACHE_VERSION = 1

function normalizePath (p: string): string {
    const cygwinPrefix = '/cygdrive/'
    if (p.startsWith(cygwinPrefix)) {
        p = p.substring(cygwinPrefix.length).replace('/', '\\')
        p = p[0] + ':' + p.substring(1)
    }
    return p
}

function normalizePathForCompare (p: string): string {
    return normalizePath(path.resolve(p)).replace(/\\/g, '/').toLowerCase()
}

function parseBooleanRuntimeEnv (name: string, defaultValue: boolean): boolean {
    const value = getRuntimeEnv(name)?.trim().toLowerCase()
    if (value === undefined || value === '') {
        return defaultValue
    }
    if (['0', 'false', 'no', 'off'].includes(value)) {
        return false
    }
    if (['1', 'true', 'yes', 'on'].includes(value)) {
        return true
    }
    return defaultValue
}

function shouldUsePluginDiscoveryCache (): boolean {
    return !isRuntimeDev() && !parseBooleanRuntimeEnv('TABBY_DISABLE_PLUGIN_DISCOVERY_CACHE', false)
}

function getPluginDiscoveryStorage (): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage
    } catch {
        return null
    }
}

function normalizeLookupPaths (paths: string[]): string[] {
    return Array.from(new Set(paths.map(x => normalizePath(path.resolve(x)))))
}

async function getPluginDiscoveryPathStates (paths: string[]): Promise<PluginDiscoveryCachePathState[]> {
    return Promise.all(normalizeLookupPaths(paths).map(async pluginPath => {
        try {
            const info = await stat(pluginPath)
            return {
                path: pluginPath,
                exists: true,
                mtimeMs: Math.trunc(info.mtimeMs),
            }
        } catch {
            return {
                path: pluginPath,
                exists: false,
                mtimeMs: 0,
            }
        }
    }))
}

function serializePluginInfo (plugin: PluginInfo): PluginInfo {
    return {
        name: plugin.name,
        description: plugin.description ?? '',
        packageName: plugin.packageName,
        isBuiltin: plugin.isBuiltin,
        isLegacy: plugin.isLegacy,
        version: plugin.version,
        author: plugin.author,
        homepage: plugin.homepage,
        path: plugin.path,
    }
}

function sanitizeCachedPluginInfo (value: unknown): PluginInfo | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    const candidate = value as Partial<PluginInfo>
    if (
        typeof candidate.name !== 'string' ||
        typeof candidate.packageName !== 'string' ||
        typeof candidate.version !== 'string' ||
        typeof candidate.author !== 'string' ||
        typeof candidate.isBuiltin !== 'boolean' ||
        typeof candidate.isLegacy !== 'boolean'
    ) {
        return null
    }
    return {
        name: candidate.name,
        description: typeof candidate.description === 'string' ? candidate.description : '',
        packageName: candidate.packageName,
        isBuiltin: candidate.isBuiltin,
        isLegacy: candidate.isLegacy,
        version: candidate.version,
        author: candidate.author,
        homepage: typeof candidate.homepage === 'string' ? candidate.homepage : undefined,
        path: typeof candidate.path === 'string' ? candidate.path : undefined,
    }
}

function clearPluginDiscoveryCacheStorage (): void {
    const storage = getPluginDiscoveryStorage()
    if (!storage) {
        return
    }
    try {
        storage.removeItem(PLUGIN_DISCOVERY_CACHE_KEY)
    } catch {
        // Ignore storage cleanup failures.
    }
}

function arePluginDiscoveryPathStatesEqual (
    a: PluginDiscoveryCachePathState[],
    b: PluginDiscoveryCachePathState[],
): boolean {
    if (a.length !== b.length) {
        return false
    }
    return a.every((state, index) =>
        state.path === b[index]?.path &&
        state.exists === b[index]?.exists &&
        state.mtimeMs === b[index]?.mtimeMs,
    )
}

async function readPluginDiscoveryCache (paths: string[]): Promise<PluginInfo[] | null> {
    if (!shouldUsePluginDiscoveryCache()) {
        return null
    }

    const storage = getPluginDiscoveryStorage()
    if (!storage) {
        return null
    }

    let cache: PluginDiscoveryCacheEntry | null = null
    try {
        const raw = storage.getItem(PLUGIN_DISCOVERY_CACHE_KEY)
        cache = raw ? JSON.parse(raw) as PluginDiscoveryCacheEntry : null
    } catch {
        clearPluginDiscoveryCacheStorage()
        return null
    }

    const normalizedPaths = normalizeLookupPaths(paths)
    if (
        !cache ||
        cache.version !== PLUGIN_DISCOVERY_CACHE_VERSION ||
        JSON.stringify(cache.lookupPaths) !== JSON.stringify(normalizedPaths)
    ) {
        return null
    }

    const currentPathStates = await getPluginDiscoveryPathStates(normalizedPaths)
    if (!arePluginDiscoveryPathStatesEqual(cache.pathStates ?? [], currentPathStates)) {
        return null
    }

    const cachedPlugins = (cache.plugins ?? [])
        .map(sanitizeCachedPluginInfo)
        .filter((plugin): plugin is PluginInfo => !!plugin)

    if (!cachedPlugins.length && cache.plugins?.length) {
        clearPluginDiscoveryCacheStorage()
        return null
    }

    console.debug(`Using cached plugin discovery results (${cachedPlugins.length} plugins)`)
    return cachedPlugins
}

async function writePluginDiscoveryCache (paths: string[], plugins: PluginInfo[]): Promise<void> {
    if (!shouldUsePluginDiscoveryCache()) {
        return
    }

    const storage = getPluginDiscoveryStorage()
    if (!storage) {
        return
    }

    try {
        const normalizedPaths = normalizeLookupPaths(paths)
        const cache: PluginDiscoveryCacheEntry = {
            version: PLUGIN_DISCOVERY_CACHE_VERSION,
            lookupPaths: normalizedPaths,
            pathStates: await getPluginDiscoveryPathStates(normalizedPaths),
            plugins: plugins.map(serializePluginInfo),
        }
        storage.setItem(PLUGIN_DISCOVERY_CACHE_KEY, JSON.stringify(cache))
    } catch (error) {
        console.warn('Failed to persist plugin discovery cache', error)
    }
}

function pathExistsSync (targetPath: string): boolean {
    return bridgeIPC.sendSync<boolean>('bridge:fs:exists-sync', targetPath)
}

function resolveDevelopmentWorkspaceRoot (): string | null {
    const candidates = Array.from(new Set([
        normalizePath(path.resolve(getRuntimeCwd())),
        normalizePath(path.resolve(__dirname, '../..')),
        normalizePath(path.dirname(appPath)),
    ]))

    for (const candidate of candidates) {
        if (
            pathExistsSync(path.join(candidate, 'app', 'package.json')) &&
            pathExistsSync(path.join(candidate, 'tabby-core', 'package.json'))
        ) {
            return candidate
        }
    }

    return null
}

const appPath = bridgeIPC.sendSync<string>('bridge:app:get-app-path')
const developmentWorkspaceRoot = resolveDevelopmentWorkspaceRoot()
const effectiveAppPath = developmentWorkspaceRoot
    ? path.join(developmentWorkspaceRoot, 'app')
    : appPath
const builtinPluginsPath = developmentWorkspaceRoot
    ? developmentWorkspaceRoot
    : path.join(getRuntimeResourcesPath() ?? effectiveAppPath, 'builtin-plugins')
const configuredBuiltinPluginRootPaths = (getRuntimeEnv('TABBY_BUILTIN_PLUGINS') ?? '')
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

const cachedBuiltinModules: Record<string, unknown> = {
    '@angular/animations': angularAnimations,
    '@angular/cdk/drag-drop': angularCdkDragDrop,
    '@angular/cdk/clipboard': angularCdkClipboard,
    '@angular/common': angularCommon,
    '@angular/compiler': angularCompiler,
    '@angular/core': angularCore,
    '@angular/forms': angularForms,
    '@angular/localize': angularLocalize,
    '@angular/localize/init': {},
    '@angular/platform-browser': angularPlatformBrowser,
    '@angular/platform-browser/animations': angularPlatformBrowserAnimations,
    '@angular/platform-browser-dynamic': angularPlatformBrowserDynamic,
    '@ng-bootstrap/ng-bootstrap': ngBootstrap,
    'ngx-toastr': ngxToastr,
    rxjs: rxjsModule,
    'rxjs/operators': rxjsOperators,
    'zone.js/dist/zone.js': zoneJs,
    'zone.js': zoneJs,
}

const builtinModules = [
    ...Object.keys(cachedBuiltinModules),
    'tabby-core',
    'tabby-local',
    'tabby-settings',
    'tabby-terminal',
]

const originalModuleRequire = nodeModule.prototype.require
nodeModule.prototype.require = (function (this: unknown, query: string) {
    if (cachedBuiltinModules[query] && isPluginModuleContext(this)) {
        return cachedBuiltinModules[query]
    }
    return originalModuleRequire.call(this, query)
}) as NodeJS.Require

export type ProgressCallback = (current: number, total: number) => void

function normalizePluginManifest (manifest: TabbyPluginManifest | undefined, pluginName: string): TabbyPluginManifest | undefined {
    if (!manifest) {
        return undefined
    }
    if (!manifest.name) {
        return {
            ...manifest,
            name: pluginName,
        }
    }
    return manifest
}

function delay (ms: number): Promise<void> {
    return new Promise(resolve => {
        const timer = setTimeout(resolve, ms)
        if (typeof timer === 'object' && typeof timer.unref === 'function') {
            timer.unref()
        }
    })
}

function isWithinRuntimeRoot (candidatePath: string): boolean {
    const normalizedCandidate = normalizePathForCompare(candidatePath)
    for (const root of pluginRuntimeRoots) {
        if (normalizedCandidate === root || normalizedCandidate.startsWith(`${root}/`)) {
            return true
        }
    }
    return false
}

function registerPluginRuntimeRoot (pluginRoot: string | null | undefined): void {
    if (!pluginRoot) {
        return
    }
    pluginRuntimeRoots.add(normalizePathForCompare(pluginRoot))
}

function isPluginModuleContext (moduleContext: unknown): boolean {
    const visited = new Set<NodeModuleContext>()
    let current = moduleContext as NodeModuleContext | null | undefined

    while (current && typeof current === 'object' && !visited.has(current)) {
        visited.add(current)

        if (
            (current.filename && isWithinRuntimeRoot(current.filename)) ||
            (current.path && isWithinRuntimeRoot(current.path))
        ) {
            return true
        }

        current = current.parent ?? null
    }

    return false
}

function getInitialModuleLookupPaths (): string[] {
    const rendererModulePaths = (globalThis as GlobalModuleTarget).module?.paths ?? []
    const mainModulePaths = nodeRequire.main?.paths ?? []
    return Array.from(new Set([
        ...rendererModulePaths,
        ...mainModulePaths,
    ].map(x => normalizePath(path.resolve(x)))))
}

function isBuiltinPluginDir (pluginDir: string): boolean {
    return builtinPluginRoots.has(normalizePathForCompare(pluginDir))
}

async function pathExists (targetPath: string): Promise<boolean> {
    try {
        await access(targetPath)
        return true
    } catch {
        return false
    }
}

function resolveBuiltinPackagePath (packageName: string): string | null {
    for (const root of builtinPluginRootPaths) {
        const candidate = path.join(root, packageName)
        if (pathExistsSync(path.join(candidate, 'package.json'))) {
            return candidate
        }
    }
    return null
}

export function initModuleLookup (userPluginsPath: string): void {
    for (const modulePath of getInitialModuleLookupPaths()) {
        if (!nodeModule.globalPaths.includes(modulePath)) {
            nodeModule.globalPaths.push(modulePath)
        }
    }

    const paths = []
    managedUserPluginsNodeModulesPath = normalizePath(path.resolve(path.join(userPluginsPath, 'node_modules')))
    paths.unshift(path.join(userPluginsPath, 'node_modules'))
    paths.unshift(path.join(effectiveAppPath, 'node_modules'))

    if (developmentWorkspaceRoot) {
        paths.unshift(path.dirname(effectiveAppPath))
    }

    paths.unshift(builtinPluginsPath)
    // paths.unshift(path.join((process as any).resourcesPath, 'app.asar', 'node_modules'))
    const extraPluginPaths = getRuntimeEnv('TABBY_PLUGINS')
    if (extraPluginPaths) {
        extraPluginPaths
            .split(path.delimiter)
            .filter(Boolean)
            .map(x => paths.push(normalizePath(path.resolve(x))))
    }

    setRuntimeEnv('NODE_PATH', [
        getRuntimeEnv('NODE_PATH') ?? '',
        paths.join(path.delimiter),
    ].filter(Boolean).join(path.delimiter))
    nodeModule._initPaths()
    pluginLookupPaths = Array.from(new Set(
        paths.map(x => normalizePath(path.resolve(x))),
    ))

    builtinModules.forEach(m => {
        if (!cachedBuiltinModules[m]) {
            const builtinPackagePath = resolveBuiltinPackagePath(m)
            if (builtinPackagePath) {
                registerPluginRuntimeRoot(builtinPackagePath)
                cachedBuiltinModules[m] = nodeRequire(builtinPackagePath)
                console.debug(`Pinned builtin module ${m} to ${builtinPackagePath}`)
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

    if (await pathExists(pluginDir)) {
        const pluginNames = await readdir(pluginDir)
        if (await pathExists(path.join(pluginDir, 'package.json'))) {
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
                promises.push(pathExists(infoPath).then(result => {
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

    const processedPaths: string[] = []

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
        const info = JSON.parse(await readFile(infoPath, { encoding: 'utf-8' }))

        if (!info.keywords || !(info.keywords.includes('terminus-plugin') || info.keywords.includes('terminus-builtin-plugin') || info.keywords.includes('tabby-plugin') || info.keywords.includes('tabby-builtin-plugin'))) {
            return null
        }

        let author = info.author
        author = author.name || author

        console.debug(`Found ${name} in ${pluginDir}`)

        return {
            name: name,
            packageName: packageName,
            isBuiltin: isBuiltinPluginDir(pluginDir),
            isLegacy: info.keywords.includes('terminus-plugin') || info.keywords.includes('terminus-builtin-plugin'),
            version: info.version,
            description: info.description ?? '',
            author,
            homepage: info.homepage,
            path: pluginPath,
            info,
        }
    } catch (error) {
        console.error('Cannot load package info for', packageName)
        return null
    }
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
        console.debug(`Skip cleanup for ${stalePlugin.packageName}: path is outside managed user plugin cache (${stalePlugin.path})`)
        return
    }

    rm(stalePlugin.path, { recursive: true, force: true })
        .then(() => {
            console.debug(`Removed stale cached plugin ${stalePlugin.packageName}@${stalePlugin.version}, using builtin ${builtinPlugin.version}`)
        })
        .catch(error => {
            console.warn(`Failed to remove stale cached plugin ${stalePlugin.packageName} at ${stalePlugin.path}`, error)
        })
}

function resolveDuplicatePlugin (existing: PluginInfo, candidate: PluginInfo): PluginInfo {
    // 优先非 legacy 插件
    if (existing.isLegacy !== candidate.isLegacy) {
        const preferred = existing.isLegacy ? candidate : existing
        console.debug(`Plugin ${candidate.packageName} already exists, using ${preferred.packageName} (non-legacy preferred)`)
        return preferred
    }

    // 内置插件与缓存/用户插件冲突时：
    // 1. 若版本不一致，直接使用内置插件（视为更新到内置版本）
    // 2. 若版本一致，也统一使用内置插件，避免重复来源导致不确定行为
    if (existing.isBuiltin !== candidate.isBuiltin) {
        const builtin = existing.isBuiltin ? existing : candidate
        const cached = existing.isBuiltin ? candidate : existing
        if (builtin.version !== cached.version) {
            console.debug(`Plugin ${cached.packageName} cache version ${cached.version} differs from builtin ${builtin.version}, using builtin`)
        } else {
            console.debug(`Plugin ${cached.packageName} cache version matches builtin (${builtin.version}), using builtin`)
        }
        cleanupStaleUserPluginCopy(cached, builtin)
        return builtin
    }

    // 同来源重复（都内置或都非内置）时保留先发现的一项
    console.debug(`Plugin ${candidate.packageName} already exists, keeping ${existing.packageName}`)
    return existing
}

export function clearPluginDiscoveryCache (): void {
    clearPluginDiscoveryCacheStorage()
}

export async function findPlugins (options: { forceRefresh?: boolean } = {}): Promise<FindPluginsResult> {
    const paths = pluginLookupPaths.length ? pluginLookupPaths : nodeModule.globalPaths
    if (!options.forceRefresh) {
        const cachedPlugins = await readPluginDiscoveryCache(paths)
        if (cachedPlugins) {
            return {
                plugins: cachedPlugins,
                fromCache: true,
            }
        }
    }

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
    await writePluginDiscoveryCache(paths, foundPlugins)
    return {
        plugins: foundPlugins,
        fromCache: false,
    }
}

export async function loadPlugins (foundPlugins: PluginInfo[], progress: ProgressCallback): Promise<any[]> {
    const plugins: any[] = []
    const pluginsPromises: Promise<any>[] = []

    foundPlugins.forEach(plugin => registerPluginRuntimeRoot(plugin.path))

    let index = 0
    const setProgress = function () {
        index++
        progress(index, foundPlugins.length)
    }

    progress(0, 1)
    for (const foundPlugin of foundPlugins) {
        pluginsPromises.push((async () => {
            try {
                let resolvedPath = foundPlugin.path
                try {
                    if (foundPlugin.path) {
                        resolvedPath = nodeRequire.resolve(foundPlugin.path)
                    }
                } catch {
                    // Ignore resolution errors here; the actual load attempt below will report them if needed.
                }
                console.debug(`Loading ${foundPlugin.name}: ${resolvedPath}`)
                const packageModule = nodeRequire(foundPlugin.path)
                const manifestCandidate = packageModule.manifest ?? packageModule.pluginManifest ?? packageModule.default?.manifest
                const pluginManifest = normalizePluginManifest(manifestCandidate as TabbyPluginManifest | undefined, foundPlugin.name)
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
                if (pluginManifest) {
                    pluginModule.pluginManifest = pluginManifest
                }
                console.debug(`Loaded ${foundPlugin.name}:`, {
                    hasDefaultExport: !!packageModule.default,
                    hasBootstrapExport: !!packageModule.bootstrap,
                    pluginName: pluginModule.pluginName,
                    moduleName: pluginModule?.constructor?.name,
                    hasManifest: !!pluginManifest,
                })
                plugins.push(pluginModule)
            } catch (error) {
                console.error(`Could not load ${foundPlugin.name}:`, error)
            }
            setProgress()
            await delay(50)
        })())
    }
    await Promise.all(pluginsPromises)

    progress(1, 1)
    return plugins
}
