#!/usr/bin/env node
import sh from 'shelljs'
import * as vars from './vars.mjs'
import log from 'npmlog'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { runYarnInstallWithRetry } from './yarn-install-retry.mjs'

const yarnBin = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'

log.info('patch')
execFileSync(yarnBin, ['patch-package'], {
    cwd: process.cwd(),
    stdio: 'inherit',
})

log.info('deps', 'app')
await runYarnInstallWithRetry({
    cwd: path.join(process.cwd(), 'app'),
    args: ['install', '--force', '--ignore-engines', '--network-timeout', '1000000'],
    label: 'install app deps',
})
sh.cd('app')
// Some native packages might fail to build before patch-package gets a chance to run via postinstall
try {
    execFileSync(yarnBin, ['postinstall'], {
        cwd: process.cwd(),
        stdio: 'inherit',
    })
} catch (error) {
    log.warn('deps', `app postinstall failed: ${error instanceof Error ? error.message : String(error)}`)
}
sh.cd('..')

for (let plugin of vars.allPackages) {
    log.info('deps', plugin)
    await runYarnInstallWithRetry({
        cwd: vars.resolvePackageDir(plugin),
        args: ['install', '--force', '--ignore-engines', '--network-timeout', '1000000'],
        label: `install ${plugin} deps`,
    })
}

if (['darwin', 'linux'].includes(process.platform)) {
    sh.cd('node_modules')
    for (let x of vars.builtinPlugins) {
        sh.ln('-fs', path.relative(process.cwd(), vars.resolvePackageDir(x)), x)
    }
    sh.cd('..')
}
