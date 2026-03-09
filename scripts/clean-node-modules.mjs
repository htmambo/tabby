#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const cwd = process.cwd()
const argv = new Set(process.argv.slice(2))

if (argv.has('--help') || argv.has('-h')) {
    console.log(`Usage: node scripts/clean-node-modules.mjs [options]

Options:
  --dry-run                  Print directories that would be removed
  --include-dist             Remove dist directories in addition to node_modules
  --include-builtin-plugins  Remove the generated builtin-plugins directory
  --help, -h                 Show this help message
`)
    process.exit(0)
}

const options = {
    dryRun: argv.has('--dry-run'),
    includeDist: argv.has('--include-dist'),
    includeBuiltinPlugins: argv.has('--include-builtin-plugins'),
}

const targets = []
const seen = new Set()

function addTarget (target) {
    const resolved = path.resolve(target)
    if (seen.has(resolved)) {
        return
    }

    seen.add(resolved)
    targets.push(resolved)
}

function shouldRemoveDirectory (name) {
    if (name === 'node_modules') {
        return true
    }

    return options.includeDist && name === 'dist'
}

async function collectTargets (dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue
        }

        if (entry.name === '.git') {
            continue
        }

        const fullPath = path.join(dir, entry.name)
        if (options.includeBuiltinPlugins && fullPath === path.join(cwd, 'builtin-plugins')) {
            addTarget(fullPath)
            continue
        }

        if (shouldRemoveDirectory(entry.name)) {
            addTarget(fullPath)
            continue
        }

        await collectTargets(fullPath)
    }
}

function formatPath (target) {
    return path.relative(cwd, target) || '.'
}

async function removeTarget (target) {
    await fs.rm(target, {
        recursive: true,
        force: true,
        maxRetries: 3,
    })
}

await collectTargets(cwd)

targets.sort((a, b) => a.localeCompare(b))

if (!targets.length) {
    console.log('No matching directories found.')
    process.exit(0)
}

const action = options.dryRun ? 'Would remove' : 'Removing'
console.log(`${action} ${targets.length} director${targets.length === 1 ? 'y' : 'ies'}:`)
for (const target of targets) {
    console.log(`- ${formatPath(target)}`)
}

if (options.dryRun) {
    process.exit(0)
}

for (const target of targets) {
    await removeTarget(target)
}

console.log('Cleanup complete.')
