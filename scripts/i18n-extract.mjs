#!/usr/bin/env node
import sh from 'shelljs'
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import * as vars from './vars.mjs'
import log from 'npmlog'
import { GettextExtractor, JsExtractors, HtmlExtractors } from 'gettext-extractor'

let extractor = new GettextExtractor()

const tempOutput = 'locale/app.new.pot'
const pot = 'locale/app.pot'
const tempHtml = 'locale/tmp-html'

;(async () => {
    sh.mkdir('-p', tempHtml)
    try {
        for (const plugin of vars.builtinPlugins) {
            log.info('compile-pug', plugin)

            sh.exec(`yarn pug --doctype html -s --pretty -O '{require: function(){}}' -o ${tempHtml}/${plugin} ${plugin}`, { fatal: true })
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
        sh.rm('-r', tempHtml)
        await fs.rm(tempOutput, { force: true })
    }
})().catch(error => {
    log.error('i18n', error instanceof Error ? error.message : String(error))
    process.exitCode = 1
})
