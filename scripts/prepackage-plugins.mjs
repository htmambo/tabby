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
const electronVersion = vars.getElectronVersion()
sh.mkdir('-p', target)
fs.writeFileSync(path.join(target, 'package.json'), '{}')
sh.cd(target)
for (let plugin of vars.builtinPlugins) {
    log.info('install', plugin)
    const sourcePath = vars.resolvePackageDir(plugin)
    const targetPath = path.resolve(target, plugin)
    if (sourcePath !== targetPath) {
        // 清理旧的预打包副本，避免遗留已删除文件
        sh.rm('-rf', targetPath)
        sh.cp('-r', sourcePath, '.')
    }
    const packagePath = path.join(targetPath, 'package.json')
    if (fs.existsSync(packagePath)) {
        const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
        if (packageInfo.version !== vars.version) {
            packageInfo.version = vars.version
            fs.writeFileSync(packagePath, `${JSON.stringify(packageInfo, null, 2)}\n`)
            log.info('version', `${plugin}: staged package.json -> ${vars.version}`)
        }
    }
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
            electronVersion,
            arch: process.env.ARCH ?? process.arch,
            force: true,
            useCache: false,
        })
    }
    sh.cd('..')
}
fs.unlinkSync(path.join(target, 'package.json'), '{}')
