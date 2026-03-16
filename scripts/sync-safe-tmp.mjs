#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const safeTmpDir = path.join(repoRoot, 'node_modules', 'tmp')
const targets = [
    path.join(repoRoot, 'node_modules', 'tmp-promise', 'node_modules', 'tmp'),
]

async function pathExists (target) {
    try {
        await fs.access(target)
        return true
    } catch {
        return false
    }
}

async function readPackageVersion (target) {
    try {
        const pkg = JSON.parse(await fs.readFile(path.join(target, 'package.json'), 'utf8'))
        return pkg.version ?? null
    } catch {
        return null
    }
}

async function ensureSafeTmpVersion () {
    if (!await pathExists(safeTmpDir)) {
        console.warn('[sync-safe-tmp] root tmp package is missing, skipping')
        return
    }

    const safeVersion = await readPackageVersion(safeTmpDir)
    if (safeVersion !== '0.2.4') {
        throw new Error(`[sync-safe-tmp] expected node_modules/tmp to be 0.2.4, got ${safeVersion ?? 'unknown'}`)
    }

    for (const target of targets) {
        const parent = path.dirname(target)
        if (!await pathExists(parent)) {
            continue
        }

        const currentVersion = await readPackageVersion(target)
        if (currentVersion === null) {
            continue
        }
        if (currentVersion === safeVersion) {
            continue
        }

        await fs.rm(target, { recursive: true, force: true })
        await fs.cp(safeTmpDir, target, { recursive: true, force: true })
        console.log(`[sync-safe-tmp] ${path.relative(repoRoot, target)} -> ${safeVersion}`)
    }
}

await ensureSafeTmpVersion()
