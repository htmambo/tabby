#!/usr/bin/env node
import * as os from 'node:os'
import * as path from 'node:path'
import { readdir, rm, stat } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import log from 'npmlog'
import webpack from 'webpack'
import * as vars from './vars.mjs'

const configs = [
    '../app/webpack.config.main.mjs',
    '../app/webpack.config.mjs',
    ...vars.buildablePackages.map(x => pathToFileURL(vars.resolvePackageFile(x, 'webpack.config.mjs')).href),
]

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const KIB = 1024
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const APP_ARTIFACT_BUDGETS = {
    bundleJs: Math.trunc(2.25 * MIB),
    preloadJs: 192 * KIB,
    mainJs: 384 * KIB,
    appDistTotal: Math.trunc(3.5 * MIB),
    fontTotal: 384 * KIB,
}

function formatBytes (bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) {
        return '0 B'
    }
    const units = ['B', 'KB', 'MB', 'GB']
    let value = bytes
    let unitIndex = 0
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024
        unitIndex += 1
    }
    const precision = unitIndex === 0 ? 0 : (value >= 10 ? 1 : 2)
    return `${value.toFixed(precision)} ${units[unitIndex]}`
}

function parseBooleanEnv (name, defaultValue = false) {
    const value = process.env[name]?.trim().toLowerCase()
    if (value === undefined || value === '') {
        return defaultValue
    }
    if (['1', 'true', 'yes', 'on'].includes(value)) {
        return true
    }
    if (['0', 'false', 'no', 'off'].includes(value)) {
        return false
    }
    return defaultValue
}

async function getFileSizeOrZero (targetPath) {
    try {
        return (await stat(targetPath)).size
    } catch {
        return 0
    }
}

async function collectDirectoryMetrics (directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true })
    const files = entries.filter(entry => entry.isFile())
    const sizes = await Promise.all(files.map(async entry => ({
        name: entry.name,
        size: await getFileSizeOrZero(path.join(directoryPath, entry.name)),
    })))
    return {
        fileCount: sizes.length,
        totalSize: sizes.reduce((sum, entry) => sum + entry.size, 0),
        entries: sizes,
    }
}

async function inspectAppArtifacts () {
    const distPath = path.resolve(repoRoot, 'app', 'dist')
    const metrics = await collectDirectoryMetrics(distPath)
    const fontExtensions = new Set(['.ttf', '.otf', '.eot', '.woff', '.woff2'])
    const fontTotal = metrics.entries
        .filter(entry => fontExtensions.has(path.extname(entry.name)))
        .reduce((sum, entry) => sum + entry.size, 0)
    const mapCount = metrics.entries.filter(entry => entry.name.endsWith('.map')).length
    const bundleJs = metrics.entries.find(entry => entry.name === 'bundle.js')?.size ?? 0
    const preloadJs = metrics.entries.find(entry => entry.name === 'preload.js')?.size ?? 0
    const mainJs = metrics.entries.find(entry => entry.name === 'main.js')?.size ?? 0

    return {
        distPath,
        fileCount: metrics.fileCount,
        totalSize: metrics.totalSize,
        fontTotal,
        mapCount,
        bundleJs,
        preloadJs,
        mainJs,
    }
}

async function reportBuildBudgets (buildDurationMs) {
    const artifacts = await inspectAppArtifacts()
    const warnings = []
    const shouldEmitSourceMaps = parseBooleanEnv('TABBY_DEV', false) || parseBooleanEnv('CI', false) || parseBooleanEnv('TABBY_RELEASE_SOURCEMAPS', false)

    log.info('summary', `build completed in ${(buildDurationMs / 1000).toFixed(2)}s`)
    log.info('summary', `${path.relative(repoRoot, artifacts.distPath)}: ${formatBytes(artifacts.totalSize)} across ${artifacts.fileCount} files`)
    log.info('summary', `bundle.js=${formatBytes(artifacts.bundleJs)}, preload.js=${formatBytes(artifacts.preloadJs)}, main.js=${formatBytes(artifacts.mainJs)}`)
    log.info('summary', `fonts=${formatBytes(artifacts.fontTotal)}, sourceMaps=${artifacts.mapCount}`)

    if (artifacts.bundleJs > APP_ARTIFACT_BUDGETS.bundleJs) {
        warnings.push(`bundle.js exceeded budget (${formatBytes(artifacts.bundleJs)} > ${formatBytes(APP_ARTIFACT_BUDGETS.bundleJs)})`)
    }
    if (artifacts.preloadJs > APP_ARTIFACT_BUDGETS.preloadJs) {
        warnings.push(`preload.js exceeded budget (${formatBytes(artifacts.preloadJs)} > ${formatBytes(APP_ARTIFACT_BUDGETS.preloadJs)})`)
    }
    if (artifacts.mainJs > APP_ARTIFACT_BUDGETS.mainJs) {
        warnings.push(`main.js exceeded budget (${formatBytes(artifacts.mainJs)} > ${formatBytes(APP_ARTIFACT_BUDGETS.mainJs)})`)
    }
    if (artifacts.totalSize > APP_ARTIFACT_BUDGETS.appDistTotal) {
        warnings.push(`app/dist exceeded budget (${formatBytes(artifacts.totalSize)} > ${formatBytes(APP_ARTIFACT_BUDGETS.appDistTotal)})`)
    }
    if (artifacts.fontTotal > APP_ARTIFACT_BUDGETS.fontTotal) {
        warnings.push(`font payload exceeded budget (${formatBytes(artifacts.fontTotal)} > ${formatBytes(APP_ARTIFACT_BUDGETS.fontTotal)})`)
    }
    if (!shouldEmitSourceMaps && artifacts.mapCount > 0) {
        warnings.push(`unexpected source maps present in app/dist (${artifacts.mapCount})`)
    }

    for (const warning of warnings) {
        log.warn('budget', warning)
    }

    if (warnings.length && parseBooleanEnv('TABBY_ENFORCE_BUILD_BUDGETS', false)) {
        throw new Error(`Build budget check failed (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`)
    }
}

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

    const fullClean = parseBooleanEnv('CI', false) || parseBooleanEnv('TABBY_FULL_OUTPUT_CLEAN', false)

    await Promise.all(outputPaths.map(async outputPath => {
        if (fullClean) {
            log.info('clean', outputPath)
            await rm(outputPath, { recursive: true, force: true })
            return
        }

        try {
            const entries = await readdir(outputPath, { withFileTypes: true })
            const sourceMaps = entries
                .filter(entry => entry.isFile() && entry.name.endsWith('.map'))
                .map(entry => entry.name)

            if (!sourceMaps.length) {
                return
            }

            log.info('clean', `${outputPath} (source maps only)`)
            await Promise.all(sourceMaps.map(entry => rm(path.join(outputPath, entry), { force: true })))
        } catch (error) {
            const code = error?.code
            if (code !== 'ENOENT') {
                throw error
            }
        }
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
    const buildStart = performance.now()
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
    await reportBuildBudgets(performance.now() - buildStart)
})()
