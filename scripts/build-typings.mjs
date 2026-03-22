#!/usr/bin/env node
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as vars from './vars.mjs'
import log from 'npmlog'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const tscCliPath = path.resolve(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc')

vars.packagesWithTypings.forEach(plugin => {
    log.info('typings', plugin)
    execFileSync(process.execPath, [
        tscCliPath,
        '--project',
        vars.resolvePackageRelativePath(plugin, 'tsconfig.typings.json'),
    ], {
        cwd: repoRoot,
        stdio: 'inherit',
    })
})
