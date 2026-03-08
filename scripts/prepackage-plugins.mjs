#!/usr/bin/env node
import { rebuild } from '@electron/rebuild'
import sh from 'shelljs'
import path from 'node:path'
import fs from 'node:fs'
import * as vars from './vars.mjs'
import log from 'npmlog'
import { runYarnInstallWithRetry } from './yarn-install-retry.mjs'

import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

let target = path.resolve(__dirname, '../builtin-plugins')
sh.mkdir('-p', target)
fs.writeFileSync(path.join(target, 'package.json'), '{}')
sh.cd(target)
for (let plugin of vars.builtinPlugins) {
    log.info('install', plugin)
    sh.cp('-r', path.join('..', plugin), '.')
    sh.rm('-rf', path.join(plugin, 'node_modules'))
    await runYarnInstallWithRetry({
        cwd: path.join(target, plugin),
        args: ['install', '--force', '--production'],
        label: `install ${plugin}`,
    })
    sh.cd(plugin)


    log.info('rebuild', 'native')
    if (fs.existsSync('node_modules')) {
        rebuild({
            buildPath: path.resolve('.'),
            electronVersion: vars.electronVersion,
            arch: process.env.ARCH ?? process.arch,
            force: true,
            useCache: false,
        })
    }
    sh.cd('..')
}
fs.unlinkSync(path.join(target, 'package.json'), '{}')
