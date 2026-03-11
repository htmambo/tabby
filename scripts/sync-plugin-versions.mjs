#!/usr/bin/env node
import * as fs from 'node:fs'
import * as vars from './vars.mjs'
import log from 'npmlog'

const targetVersion = vars.version
let updatedCount = 0

for (const plugin of vars.builtinPlugins) {
    const packagePath = vars.resolvePackageFile(plugin, 'package.json')
    if (!fs.existsSync(packagePath)) {
        log.warn('sync', `${plugin}: package.json not found, skipped`)
        continue
    }

    const packageInfo = JSON.parse(fs.readFileSync(packagePath, 'utf-8'))
    const currentVersion = packageInfo.version
    if (currentVersion === targetVersion) {
        continue
    }

    packageInfo.version = targetVersion
    fs.writeFileSync(packagePath, `${JSON.stringify(packageInfo, null, 2)}\n`)
    updatedCount++
    log.info('sync', `${plugin}: ${currentVersion ?? 'unknown'} -> ${targetVersion}`)
}

log.info('sync', `plugin version sync done, updated ${updatedCount} package(s) to ${targetVersion}`)
