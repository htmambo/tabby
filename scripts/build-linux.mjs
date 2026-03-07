#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'

const isTag = (process.env.GITHUB_REF || '').startsWith('refs/tags/')
const publishConfigs = vars.getPublishConfigs()

process.env.ARCH = (process.env.ARCH || process.arch) === 'arm' ? 'armv7l' : process.env.ARCH || process.arch
const linuxTargets = (process.env.LINUX_TARGETS ?? 'deb,tar.gz,rpm,pacman,appimage')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)

builder({
    dir: true,
    linux: linuxTargets,
    armv7l: process.env.ARCH === 'armv7l',
    arm64: process.env.ARCH === 'arm64',
    config: {
        npmRebuild: false,
        extraMetadata: {
            version: vars.version,
        },
        publish: publishConfigs,
    },
    publish: vars.shouldPublishBuild(isTag) ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
