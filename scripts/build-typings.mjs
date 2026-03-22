#!/usr/bin/env node
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

;(async () => {
    const concurrency = getTypingsConcurrency()
    log.info('typings', `Using concurrency ${concurrency}`)

    let nextIndex = 0
    let failed = false

    const workers = Array.from({ length: Math.min(concurrency, vars.packagesWithTypings.length) }, async () => {
        while (!failed) {
            const currentIndex = nextIndex
            nextIndex += 1
            if (currentIndex >= vars.packagesWithTypings.length) {
                return
            }

            try {
                await runTypingsBuild(vars.packagesWithTypings[currentIndex])
            } catch (error) {
                failed = true
                stopActiveChildren()
                throw error
            }
        }
    })
    await Promise.all(workers)
})().catch(error => {
    log.error('typings', error.message)
    process.exitCode = 1
})
