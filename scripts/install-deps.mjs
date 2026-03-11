#!/usr/bin/env node
import sh from 'shelljs'
import * as vars from './vars.mjs'
import log from 'npmlog'
import path from 'node:path'
import { runYarnInstallWithRetry } from './yarn-install-retry.mjs'

log.info('patch')
sh.exec(`yarn patch-package`, { fatal: true })

log.info('deps', 'app')
await runYarnInstallWithRetry({
    cwd: path.join(process.cwd(), 'app'),
    args: ['install', '--force', '--network-timeout', '1000000'],
    label: 'install app deps',
})
sh.cd('app')
// Some native packages might fail to build before patch-package gets a chance to run via postinstall
sh.exec(`yarn postinstall`, { fatal: false })
sh.cd('..')

for (let plugin of vars.allPackages) {
    log.info('deps', plugin)
    await runYarnInstallWithRetry({
        cwd: vars.resolvePackageDir(plugin),
        args: ['install', '--force', '--network-timeout', '1000000'],
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
