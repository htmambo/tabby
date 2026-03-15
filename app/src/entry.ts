import 'zone.js'
import 'core-js/proposals/reflect-metadata'
import 'rxjs'

import './global.scss'
import './toastr.scss'

// Importing before @angular/*
import { findPlugins, initModuleLookup, loadPlugins } from './plugins'
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

async function bootstrap (bootstrapData: BootstrapData, plugins: PluginInfo[], safeMode = false): Promise<NgModuleRef<any>> {
    if (safeMode) {
        plugins = plugins.filter(x => x.isBuiltin)
    }

    const pluginModules = await loadPlugins(plugins, (current, total) => {
        (document.querySelector('.progress .bar') as HTMLElement).style.width = `${100 * current / total}%` // eslint-disable-line
    })

    console.info('Loaded plugin modules summary:', JSON.stringify(pluginModules.map(x => ({
        pluginName: x?.pluginName,
        hasBootstrap: !!x?.bootstrap,
        moduleName: x?.constructor?.name,
    }))))

    setRendererPluginModules(pluginModules)

    const module = getRootModule(pluginModules)
    const moduleRef = await platformBrowserDynamic([
        { provide: BOOTSTRAP_DATA, useValue: bootstrapData },
    ]).bootstrapModule(module)
    if (isRuntimeDev()) {
        const applicationRef = moduleRef.injector.get(ApplicationRef)
        const componentRef = applicationRef.components[0]
        enableDebugTools(componentRef)
    }
    return moduleRef
}

ipc.once('start', async (bootstrapData: BootstrapData) => {
    console.log('Window bootstrap data:', bootstrapData)

    initModuleLookup(bootstrapData.userPluginsPath)

    let plugins = await findPlugins()
    bootstrapData.installedPlugins = plugins
    if (bootstrapData.config.pluginBlacklist) {
        plugins = plugins.filter(x => !bootstrapData.config.pluginBlacklist.includes(x.name))
    }
    plugins = plugins.filter(x => x.name !== 'web')

    console.log('Starting with plugins:', plugins)
    try {
        await bootstrap(bootstrapData, plugins)
    } catch (error) {
        console.error('Angular bootstrapping error:', error)
        console.warn('Trying safe mode')
        setRendererSafeModeReason(error)
        try {
            await bootstrap(bootstrapData, plugins, true)
        } catch (error2) {
            console.error('Bootstrap failed:', error2)
        }
    }
})

ipc.send('ready')
