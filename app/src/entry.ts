import 'zone.js'
import 'core-js/proposals/reflect-metadata'

import './global.scss'
import './toastr.scss'

// Importing before @angular/*
import { clearPluginDiscoveryCache, findPlugins, initModuleLookup, loadPlugins, resolvePluginAlternativeEntryPath } from './plugins'
import { getTabbyBridge } from './tabby-bridge'

import { enableProdMode, NgModuleRef, ApplicationRef } from '@angular/core'
import { enableDebugTools } from '@angular/platform-browser'
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic'

import { getRootModule } from './app.module'
import { setRendererPluginModules, setRendererSafeModeReason } from '../../tabby-core/src/api/rendererState'
import { getRuntimeEnv, getRuntimePlatform, hasRuntimeEnv, isRuntimeDev, setRuntimeEnv, setRuntimePromiseAPIEnabled } from '../../tabby-core/src/api/rendererRuntime'
import { BootstrapData, BOOTSTRAP_DATA, PluginInfo } from '../../tabby-core/src/api/mainProcess'

// Always land on the start view
location.hash = ''

setRuntimePromiseAPIEnabled(true)

if (getRuntimePlatform() === 'win32' && !hasRuntimeEnv('HOME')) {
    const homeDrive = getRuntimeEnv('HOMEDRIVE') ?? ''
    const homePath = getRuntimeEnv('HOMEPATH') ?? ''
    setRuntimeEnv('HOME', `${homeDrive}${homePath}`)
}

if (isRuntimeDev() && !hasRuntimeEnv('TABBY_FORCE_ANGULAR_PROD')) {
    console.warn('Running in debug mode')
} else {
    enableProdMode()
}

const ipc = getTabbyBridge().ipc
const DEFAULT_DELAYED_PLUGIN_NAMES = ['ai-assistant', 'plugin-manager', 'settings']
const startupDebugEnabled = isRuntimeDev()

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

const configuredDelayedPluginNames = getRuntimeEnv('TABBY_DELAYED_PLUGINS')
    ?.split(',')
    .map(x => x.trim())
    .filter(Boolean)
const delayedPluginNames = new Set(configuredDelayedPluginNames?.length ? configuredDelayedPluginNames : DEFAULT_DELAYED_PLUGIN_NAMES)
const delayOptionalPluginsOverrideEnabled = (() => {
    const envValue = getRuntimeEnv('TABBY_DELAY_OPTIONAL_PLUGINS')
    if (envValue === undefined || envValue === '') {
        return null
    }
    return parseBooleanRuntimeEnv('TABBY_DELAY_OPTIONAL_PLUGINS', false)
})()

function shouldDelayOptionalPlugins (config: Record<string, any>): boolean {
    if (delayOptionalPluginsOverrideEnabled !== null) {
        return delayOptionalPluginsOverrideEnabled
    }
    return !!config.delayOptionalPluginsForStartup
}

const startupMetricsEnabled = parseBooleanRuntimeEnv('TABBY_STARTUP_METRICS', isRuntimeDev())
const startupDiagnosticsEnabled = startupDebugEnabled || startupMetricsEnabled

function splitStartupPlugins (plugins: PluginInfo[], config: Record<string, any>): { startupPlugins: PluginInfo[], deferredPlugins: PluginInfo[] } {
    if (!shouldDelayOptionalPlugins(config)) {
        return {
            startupPlugins: plugins,
            deferredPlugins: [],
        }
    }

    const startupPlugins: PluginInfo[] = []
    const deferredPlugins: PluginInfo[] = []

    for (const plugin of plugins) {
        if (delayedPluginNames.has(plugin.name)) {
            const minimalEntryPath = resolvePluginAlternativeEntryPath(plugin, 'index-minimal.js')
            if (minimalEntryPath) {
                startupPlugins.push({
                    ...plugin,
                    entryPath: minimalEntryPath,
                })
                deferredPlugins.push(plugin)
                continue
            }
            console.warn(`Startup deferral requested for ${plugin.name}, but no minimal entry was found`)
        }
        startupPlugins.push(plugin)
    }

    return {
        startupPlugins,
        deferredPlugins,
    }
}

function logStartupMetric (name: string, startTime: number): void {
    if (!startupMetricsEnabled) {
        return
    }
    console.info(`[startup] ${name}: ${(performance.now() - startTime).toFixed(1)}ms`)
}

function prepareStartupPlugins (bootstrapData: BootstrapData, installedPlugins: PluginInfo[]): PluginInfo[] {
    bootstrapData.installedPlugins = installedPlugins

    const pluginBlacklist = bootstrapData.config.pluginBlacklist?.length
        ? new Set<string>(bootstrapData.config.pluginBlacklist)
        : null
    const plugins: PluginInfo[] = []
    for (const plugin of installedPlugins) {
        if (plugin.name === 'web') {
            continue
        }
        if (pluginBlacklist?.has(plugin.name)) {
            continue
        }
        plugins.push(plugin)
    }

    const { startupPlugins, deferredPlugins } = splitStartupPlugins(plugins, bootstrapData.config)
    if (deferredPlugins.length && startupDiagnosticsEnabled) {
        console.info('Deferring optional plugin bundles for startup speed in this session:', deferredPlugins.map(x => x.name))
    }

    return startupPlugins
}

async function bootstrap (bootstrapData: BootstrapData, plugins: PluginInfo[], safeMode = false): Promise<NgModuleRef<any>> {
    const bootstrapStart = performance.now()
    if (safeMode) {
        plugins = plugins.filter(x => x.isBuiltin)
    }

    const loadPluginsStart = performance.now()
    const progressBar = document.querySelector('.progress .bar') as HTMLElement | null
    const pluginModules = await loadPlugins(plugins, (current, total) => {
        if (progressBar) {
            progressBar.style.width = `${100 * current / total}%`
        }
    })
    logStartupMetric('loadPlugins', loadPluginsStart)

    if (startupDebugEnabled) {
        console.debug('Loaded plugin modules:', pluginModules.map(x => x?.pluginName).filter(Boolean))
    }

    setRendererPluginModules(pluginModules)

    const module = getRootModule(pluginModules)
    const angularBootstrapStart = performance.now()
    const moduleRef = await platformBrowserDynamic([
        { provide: BOOTSTRAP_DATA, useValue: bootstrapData },
    ]).bootstrapModule(module)
    logStartupMetric('bootstrapModule', angularBootstrapStart)
    if (isRuntimeDev()) {
        const applicationRef = moduleRef.injector.get(ApplicationRef)
        const componentRef = applicationRef.components[0]
        enableDebugTools(componentRef)
    }
    logStartupMetric('bootstrapTotal', bootstrapStart)
    return moduleRef
}

ipc.once('start', async (bootstrapData: BootstrapData) => {
    if (startupDebugEnabled) {
        console.debug('Window bootstrap data:', bootstrapData)
    }
    const startupStart = performance.now()

    initModuleLookup(bootstrapData.userPluginsPath)

    const findPluginsStart = performance.now()
    let pluginDiscovery = await findPlugins()
    logStartupMetric('findPlugins', findPluginsStart)
    let startupPlugins = prepareStartupPlugins(bootstrapData, pluginDiscovery.plugins)

    if (startupDebugEnabled) {
        console.debug('Starting with plugins:', startupPlugins)
    }
    try {
        await bootstrap(bootstrapData, startupPlugins)
    } catch (error) {
        if (pluginDiscovery.fromCache) {
            console.warn('Bootstrap failed after cached plugin discovery, retrying with a fresh scan')
            clearPluginDiscoveryCache()

            const refreshPluginsStart = performance.now()
            pluginDiscovery = await findPlugins({ forceRefresh: true })
            logStartupMetric('findPluginsRefresh', refreshPluginsStart)
            startupPlugins = prepareStartupPlugins(bootstrapData, pluginDiscovery.plugins)
            if (startupDebugEnabled) {
                console.debug('Retrying startup with freshly discovered plugins:', startupPlugins)
            }

            try {
                await bootstrap(bootstrapData, startupPlugins)
                logStartupMetric('total', startupStart)
                return
            } catch (refreshError) {
                error = refreshError
            }
        }

        console.error('Angular bootstrapping error:', error)
        console.warn('Trying safe mode')
        setRendererSafeModeReason(error)
        try {
            await bootstrap(bootstrapData, startupPlugins, true)
        } catch (error2) {
            console.error('Bootstrap failed:', error2)
        }
    }
    logStartupMetric('total', startupStart)
})

ipc.send('ready')
