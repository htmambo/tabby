#!/usr/bin/env node
import * as vars from './vars.mjs'
import log from 'npmlog'
import webpack from 'webpack'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const configs = [
    '../app/webpack.config.main.mjs',
    '../app/webpack.config.mjs',
    ...vars.buildablePackages.map(x => pathToFileURL(vars.resolvePackageFile(x, 'webpack.config.mjs')).href),
]

;(async () => {
    for (const c of configs) {
        log.info('build', c)
        const stats = await promisify(webpack)((await import(c)).default())
        console.log(stats.toString({ colors: true }))
        if (stats.hasErrors()) {
            process.exit(1)
        }
    }
})()
