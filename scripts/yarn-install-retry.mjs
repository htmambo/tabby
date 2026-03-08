#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultAttempts = Number.parseInt(process.env.YARN_INSTALL_RETRIES ?? '3', 10)
const defaultDelaySeconds = Number.parseInt(process.env.YARN_INSTALL_RETRY_DELAY_SECONDS ?? '15', 10)
const yarnBin = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'

function sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function run (args, cwd) {
    return new Promise(resolve => {
        const child = spawn(yarnBin, args, {
            cwd,
            stdio: 'inherit',
            env: process.env,
        })

        child.on('error', error => resolve({
            code: 1,
            error,
        }))

        child.on('close', code => resolve({
            code: code ?? 1,
        }))
    })
}

function parseCliArgs (argv) {
    const args = []
    let cwd = process.cwd()

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg === '--cwd') {
            cwd = path.resolve(argv[i + 1] ?? cwd)
            i++
            continue
        }

        if (arg.startsWith('--cwd=')) {
            cwd = path.resolve(arg.slice('--cwd='.length))
            continue
        }

        args.push(arg)
    }

    return { args, cwd }
}

export async function runYarnInstallWithRetry ({
    args = [],
    attempts = defaultAttempts,
    cwd = process.cwd(),
    delaySeconds = defaultDelaySeconds,
    label = null,
} = {}) {
    const displayArgs = args.join(' ').trim()
    const command = displayArgs ? `yarn ${displayArgs}` : 'yarn'
    const context = label ?? command

    for (let attempt = 1; attempt <= attempts; attempt++) {
        const result = await run(args, cwd)
        if (result.code === 0) {
            return
        }

        if (attempt === attempts) {
            throw new Error(`${context} failed after ${attempts} attempts`)
        }

        console.error(`[yarn-install-retry] ${context} failed in ${cwd} on attempt ${attempt}/${attempts}, cleaning cache and retrying...`)
        await run(['cache', 'clean'], cwd)
        await sleep(attempt * delaySeconds * 1000)
    }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
    const { args, cwd } = parseCliArgs(process.argv.slice(2))
    await runYarnInstallWithRetry({ args, cwd })
}
