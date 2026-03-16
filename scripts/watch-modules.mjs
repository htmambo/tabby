#!/usr/bin/env node
import * as vars from './vars.mjs'
import log from 'npmlog'
import webpack from 'webpack'
import { pathToFileURL } from 'node:url'

const configPaths = [
    '../app/webpack.config.main.mjs',
    '../app/webpack.config.mjs',
    ...vars.buildablePackages.map(x => pathToFileURL(vars.resolvePackageFile(x, 'webpack.config.mjs')).href),
]

async function loadConfigs () {
    const configs = []

    for (const configPath of configPaths) {
        log.info('watch', configPath)
        configs.push((await import(configPath)).default())
    }

    return configs
}

const compiler = webpack(await loadConfigs())

const watcher = compiler.watch({}, (err, stats) => {
    if (err) {
        console.error(err)
        return
    }

    if (stats) {
        console.log(stats.toString({ colors: true }))
    }
})

const closeWatcher = () => watcher.close(closeErr => {
    if (closeErr) {
        console.error(closeErr)
        process.exitCode = 1
    }
})

process.on('SIGINT', closeWatcher)
process.on('SIGTERM', closeWatcher)
