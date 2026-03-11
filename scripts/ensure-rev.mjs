#!/usr/bin/env node
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import log from 'npmlog'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const envPath = path.resolve(__dirname, '../.env')

function parseRev(value) {
    const rev = Number.parseInt(String(value ?? '').trim(), 10)
    return Number.isFinite(rev) && rev >= 0 ? rev : 0
}

let lines = []
if (fs.existsSync(envPath)) {
    lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)
} else {
    log.info('rev', `.env not found, creating ${envPath}`)
}

let revLineIndex = -1
let currentRev = 0

for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s*REV\s*=\s*(.*?)\s*$/)
    if (match) {
        revLineIndex = i
        currentRev = parseRev(match[1])
        break
    }
}

if (revLineIndex === -1) {
    lines.push('REV=0')
    log.info('rev', 'REV not found, initialized to 0')
} else {
    const nextRev = currentRev + 1
    lines[revLineIndex] = `REV=${nextRev}`
    log.info('rev', `REV ${currentRev} -> ${nextRev}`)
}

while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop()
}

fs.writeFileSync(envPath, `${lines.join('\n')}\n`)
