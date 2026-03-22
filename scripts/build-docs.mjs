#!/usr/bin/env node
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as vars from './vars.mjs'
import log from 'npmlog'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const typedocCliPath = path.resolve(repoRoot, 'node_modules', 'typedoc', 'bin', 'typedoc')

vars.packagesWithDocs.forEach(([dest, src]) => {
    log.info('docs', src)
    execFileSync(process.execPath, [
        typedocCliPath,
        '--out',
        `docs/api/${dest}`,
        '--tsconfig',
        `${src}/tsconfig.typings.json`,
        `${src}/src/index.ts`,
    ], {
        cwd: repoRoot,
        stdio: 'inherit',
    })
})
