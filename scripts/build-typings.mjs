#!/usr/bin/env node
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as vars from './vars.mjs'
import log from 'npmlog'

const GIB = 1024 ** 3
const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const tscCliPath = path.resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')
const activeChildren = new Set()
const dependencyFields = ['dependencies', 'peerDependencies', 'devDependencies']
const packageTypingsDependencies = new Map()

function getDefaultTypingsConcurrency () {
    const totalMemory = os.totalmem()
    const availableParallelism = os.availableParallelism?.() ?? 1

    let recommendedConcurrency = 2
    if (totalMemory >= 24 * GIB) {
        recommendedConcurrency = 4
    } else if (totalMemory >= 16 * GIB) {
        recommendedConcurrency = 3
    }

    if (process.env.CI && recommendedConcurrency > 1) {
        recommendedConcurrency -= 1
    }

    return Math.max(1, Math.min(recommendedConcurrency, availableParallelism, vars.packagesWithTypings.length))
}

function getTypingsConcurrency () {
    const configured = Number.parseInt(process.env.TABBY_TYPINGS_CONCURRENCY ?? process.env.TABBY_BUILD_CONCURRENCY ?? '', 10)
    if (Number.isFinite(configured) && configured > 0) {
        return Math.max(1, Math.min(configured, vars.packagesWithTypings.length))
    }
    return getDefaultTypingsConcurrency()
}

function stopActiveChildren () {
    for (const child of activeChildren) {
        child.kill('SIGTERM')
    }
}

function runTypingsBuild (plugin) {
    log.info('typings', plugin)
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            tscCliPath,
            '--project',
            vars.resolvePackageRelativePath(plugin, 'tsconfig.typings.json'),
        ], {
            cwd: repoRoot,
            stdio: 'inherit',
        })
        activeChildren.add(child)

        let settled = false
        const finish = error => {
            if (settled) {
                return
            }
            settled = true
            activeChildren.delete(child)
            if (error) {
                reject(error)
            } else {
                resolve(undefined)
            }
        }

        child.once('error', finish)
        child.once('exit', (code, signal) => {
            if (code === 0) {
                finish(undefined)
                return
            }
            finish(new Error(`Type generation failed for ${plugin}${signal ? ` (${signal})` : ` (exit ${code ?? 'unknown'})`}`))
        })
    })
}

function getPackageTypingsDependencies (plugin) {
    if (packageTypingsDependencies.has(plugin)) {
        return packageTypingsDependencies.get(plugin)
    }

    const packageJson = JSON.parse(fs.readFileSync(vars.resolvePackageFile(plugin, 'package.json'), 'utf8'))
    const deps = dependencyFields
        .flatMap(field => Object.keys(packageJson[field] ?? {}))
        .filter(dep => dep !== plugin && vars.packagesWithTypings.includes(dep))
    packageTypingsDependencies.set(plugin, deps)
    return deps
}

function getTypingsBuildLevels () {
    const remaining = new Set(vars.packagesWithTypings)
    const built = new Set()
    const levels = []

    while (remaining.size) {
        const ready = [...remaining].filter(plugin =>
            getPackageTypingsDependencies(plugin).every(dep => built.has(dep)),
        )

        if (!ready.length) {
            throw new Error(`Unable to resolve typings build order for: ${[...remaining].join(', ')}`)
        }

        levels.push(ready)
        ready.forEach(plugin => {
            remaining.delete(plugin)
            built.add(plugin)
        })
    }

    return levels
}

async function runTypingsBuildBatch (plugins, concurrency) {
    let nextIndex = 0
    let failed = false

    const workers = Array.from({ length: Math.min(concurrency, plugins.length) }, async () => {
        while (!failed) {
            const currentIndex = nextIndex
            nextIndex += 1
            if (currentIndex >= plugins.length) {
                return
            }

            try {
                await runTypingsBuild(plugins[currentIndex])
            } catch (error) {
                failed = true
                stopActiveChildren()
                throw error
            }
        }
    })

    await Promise.all(workers)
}

;(async () => {
    const concurrency = getTypingsConcurrency()
    log.info('typings', `Using concurrency ${concurrency}`)
    const levels = getTypingsBuildLevels()

    for (const level of levels) {
        log.info('typings', `Building level: ${level.join(', ')}`)
        await runTypingsBuildBatch(level, concurrency)
    }
})().catch(error => {
    log.error('typings', error.message)
    process.exitCode = 1
})
