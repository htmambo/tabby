#!/usr/bin/env node
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as vars from './vars.mjs'
import log from 'npmlog'
import { GettextExtractor, JsExtractors, HtmlExtractors } from 'gettext-extractor'
import pug from 'pug'

const extractor = new GettextExtractor()

const tempOutput = 'locale/app.new.pot'
const pot = 'locale/app.pot'
const tempHtml = 'locale/tmp-html'
const PUG_RENDER_OPTIONS = {
    doctype: 'html',
    pretty: true,
    require: () => '',
}

function assertMsgcatAvailable () {
    try {
        execFileSync('msgcat', ['--version'], {
            stdio: 'ignore',
        })
    } catch {
        throw new Error('msgcat is required for i18n extraction. Install gettext to provide it.')
    }
}

async function collectPugTemplatePaths (rootDir) {
    const templatePaths = []
    const pendingDirs = [rootDir]

    while (pendingDirs.length) {
        const currentDir = pendingDirs.pop()
        let entries
        try {
            entries = await fs.readdir(currentDir, { withFileTypes: true })
        } catch (error) {
            if (error?.code === 'ENOENT') {
                continue
            }
            throw error
        }

        for (const entry of entries) {
            const entryPath = path.join(currentDir, entry.name)
            if (entry.isDirectory()) {
                if (!['dist', 'node_modules', 'typings'].includes(entry.name)) {
                    pendingDirs.push(entryPath)
                }
                continue
            }
            if (entry.isFile() && entry.name.endsWith('.pug')) {
                templatePaths.push(entryPath)
            }
        }
    }

    templatePaths.sort()
    return templatePaths
}

async function compilePluginPugTemplates (plugin) {
    const pluginDir = vars.resolvePackageDir(plugin)
    const templatePaths = await collectPugTemplatePaths(pluginDir)

    for (const templatePath of templatePaths) {
        const relativeTemplatePath = path.relative(pluginDir, templatePath)
        const outputPath = path.join(
            tempHtml,
            plugin,
            relativeTemplatePath.replace(/\.pug$/u, '.html'),
        )
        const html = pug.renderFile(templatePath, PUG_RENDER_OPTIONS)
        await fs.mkdir(path.dirname(outputPath), { recursive: true })
        await fs.writeFile(outputPath, html)
    }
}

;(async () => {
    assertMsgcatAvailable()
    await fs.rm(tempHtml, { recursive: true, force: true })
    await fs.mkdir(tempHtml, { recursive: true })
    try {
        for (const plugin of vars.builtinPlugins) {
            log.info('compile-pug', plugin)
            await compilePluginPugTemplates(plugin)
        }

        log.info('extract-ts')
        extractor.createJsParser([
            JsExtractors.callExpression('this.translate.instant', {
                arguments: { text: 0 },
            }),
            JsExtractors.callExpression('translate.instant', {
                arguments: { text: 0 },
            }),
            JsExtractors.callExpression('_', {
                arguments: { text: 0 },
            }),
        ]).parseFilesGlob('./tabby-*/src/**/*.ts')

        log.info('extract-pug')
        const options = {
            attributes: {
                context: 'translatecontext',
            },
        }
        extractor.createHtmlParser([
            HtmlExtractors.elementContent('translate, [translate=""]', options),
            HtmlExtractors.elementAttribute('[translate*=" "]', 'translate', options),
        ]).parseFilesGlob(`${tempHtml}/**/*.html`)

        extractor.savePotFile(tempOutput)
        extractor.printStats()

        const normalizedPot = execFileSync('msgcat', ['-s', tempOutput], {
            cwd: process.cwd(),
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'inherit'],
        })
        await fs.writeFile(pot, normalizedPot)
    } finally {
        await fs.rm(tempHtml, { recursive: true, force: true })
        await fs.rm(tempOutput, { force: true })
    }
})().catch(error => {
    log.error('i18n', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
