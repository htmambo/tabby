import { execFileSync } from 'node:child_process'

function getChangedFiles () {
    const base = process.env.LINT_BASE
    const args = base
        ? ['diff', '--name-only', '--diff-filter=ACMRTUXB', `${base}...HEAD`]
        : ['diff', '--name-only', '--diff-filter=ACMRTUXB', 'HEAD']
    const output = execFileSync('git', args, { encoding: 'utf8' }).trim()
    if (!output) {
        return []
    }
    return output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
}

const targets = getChangedFiles()
    .filter(file => file.endsWith('.ts'))
    .filter(file => file.startsWith('app/src/') || file.startsWith('tabby-core/src/'))

if (!targets.length) {
    console.log('lint:progressive: no matching files to lint')
    process.exit(0)
}

const eslintBin = './node_modules/.bin/eslint'
execFileSync(eslintBin, ['--config', '.eslintrc.progressive.yml', '--ext', 'ts', ...targets], {
    stdio: 'inherit',
})
