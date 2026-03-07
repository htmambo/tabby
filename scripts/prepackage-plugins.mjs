#!/usr/bin/env node
import { rebuild } from '@electron/rebuild'
import sh from 'shelljs'
import path from 'node:path'
import fs from 'node:fs'
import * as vars from './vars.mjs'
import log from 'npmlog'

import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

function execQuietly (command, context) {
    const result = sh.exec(command, { silent: true, fatal: false })
    if (result.code === 0) {
        return
    }

    const output = [result.stdout, result.stderr]
        .map(x => x?.trim())
        .filter(Boolean)
        .join('\n')
    throw new Error(output ? `${context} failed\n${output}` : `${context} failed`)
}

let target = path.resolve(__dirname, '../builtin-plugins')
sh.mkdir('-p', target)
fs.writeFileSync(path.join(target, 'package.json'), '{}')
sh.cd(target)
vars.builtinPlugins.forEach(plugin => {
    log.info('install', plugin)
    sh.cp('-r', path.join('..', plugin), '.')
    sh.rm('-rf', path.join(plugin, 'node_modules'))
    sh.cd(plugin)
    execQuietly('yarn install --force --production', `install ${plugin}`)


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
})
fs.unlinkSync(path.join(target, 'package.json'), '{}')
