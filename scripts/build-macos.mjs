#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'

const isTag = (process.env.GITHUB_REF || '').startsWith('refs/tags/')
const publishConfigs = vars.getPublishConfigs()

process.env.ARCH = process.env.ARCH || process.arch
const macTargets = (process.env.MACOS_TARGETS ?? 'dmg,zip')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)

if (process.env.GITHUB_HEAD_REF) {
    delete process.env.CSC_LINK
    delete process.env.CSC_KEY_PASSWORD
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}

process.env.APPLE_ID ??= process.env.APPSTORE_USERNAME
process.env.APPLE_APP_SPECIFIC_PASSWORD ??= process.env.APPSTORE_PASSWORD

    builder({
        dir: true,
        mac: macTargets,
        x64: process.env.ARCH === 'x86_64',
        arm64: process.env.ARCH === 'arm64',
    config: {
        extraMetadata: {
            version: vars.version,
            teamId: process.env.APPLE_TEAM_ID,
        },
        mac: {
            identity: !process.env.CI || process.env.CSC_LINK ? undefined : null,
            notarize: !!process.env.APPLE_TEAM_ID,
        },
        npmRebuild: process.env.ARCH !== 'arm64',
        publish: publishConfigs,
    },
    publish: vars.shouldPublishBuild(isTag) ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
