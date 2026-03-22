#!/usr/bin/env node
import * as vars from './vars.mjs'
import log from 'npmlog'
import { execFileSync } from 'node:child_process'

const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

vars.allPackages.forEach(plugin => {
    log.info('bump', plugin)
    const pluginDir = vars.resolvePackageDir(plugin)
    execFileSync(npmBin, ['--no-git-tag-version', 'version', vars.version], {
        cwd: pluginDir,
        stdio: 'inherit',
    })
    execFileSync(npmBin, ['publish', '--tag', 'latest'], {
        cwd: pluginDir,
        stdio: 'inherit',
    })
})
