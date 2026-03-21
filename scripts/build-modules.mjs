#!/usr/bin/env node
import * as os from 'node:os'
import { rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import log from 'npmlog'
import webpack from 'webpack'
import * as vars from './vars.mjs'

const configs = [
    '../app/webpack.config.main.mjs',
    '../app/webpack.config.mjs',
    ...vars.buildablePackages.map(x => pathToFileURL(vars.resolvePackageFile(x, 'webpack.config.mjs')).href),
]

const GIB = 1024 ** 3

function getDefaultBuildConcurrency () {
    const totalMemory = os.totalmem()
    const availableParallelism = os.availableParallelism?.() ?? 1

    let recommendedConcurrency = 2
    if (totalMemory >= 24 * GIB) {
        recommendedConcurrency = 4
    } else if (totalMemory >= 16 * GIB) {
        recommendedConcurrency = 4
    } else if (totalMemory >= 8 * GIB) {
        recommendedConcurrency = 3
    }

    if (process.env.CI && recommendedConcurrency > 1) {
        recommendedConcurrency -= 1
    }

    return Math.max(1, Math.min(recommendedConcurrency, availableParallelism, configs.length))
}

function getBuildConcurrency () {
    const configured = Number.parseInt(process.env.TABBY_BUILD_CONCURRENCY ?? '', 10)
    if (Number.isFinite(configured) && configured > 0) {
        return configured
    }
    return getDefaultBuildConcurrency()
}

async function loadWebpackConfig (configPath) {
    return {
        configPath,
        config: (await import(configPath)).default(),
    }
}

async function cleanOutputPaths (loadedConfigs) {
    const outputPaths = Array.from(new Set(
        loadedConfigs
            .map(entry => entry.config?.output?.path)
            .filter(Boolean),
    ))

    await Promise.all(outputPaths.map(async outputPath => {
        log.info('clean', outputPath)
        await rm(outputPath, { recursive: true, force: true })
    }))
}

async function runWebpackConfig ({ configPath, config }) {
    log.info('build', configPath)
    const compiler = webpack(config)

    try {
        const stats = await new Promise((resolve, reject) => {
            compiler.run((error, compilationStats) => {
                if (error) {
                    reject(error)
                    return
                }
                resolve(compilationStats)
            })
        })

        console.log(stats.toString({ colors: true }))

        if (stats.hasErrors()) {
            throw new Error(`Webpack reported errors for ${configPath}`)
        }
    } finally {
        await new Promise((resolve, reject) => {
            compiler.close(error => {
                if (error) {
                    reject(error)
                    return
                }
                resolve(undefined)
            })
        })
    }
}

;(async () => {
    const concurrency = getBuildConcurrency()
    log.info('build', `Using concurrency ${concurrency}`)
    const loadedConfigs = await Promise.all(configs.map(loadWebpackConfig))
    await cleanOutputPaths(loadedConfigs)

    let nextIndex = 0

    const workers = Array.from({ length: Math.min(concurrency, loadedConfigs.length) }, async () => {
        while (true) {
            const currentIndex = nextIndex
            nextIndex += 1
            if (currentIndex >= loadedConfigs.length) {
                return
            }
            await runWebpackConfig(loadedConfigs[currentIndex])
        }
    })

    await Promise.all(workers)
})()
