import { spawn } from 'child_process'

const run = (command, args) => new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', error => resolve({ code: error.code ?? 1, error }))
    child.on('exit', code => resolve({ code: code ?? 0 }))
})

const level = process.env.AUDIT_LEVEL ?? 'high'
const userAgent = process.env.npm_config_user_agent ?? ''
const preferYarn = userAgent.includes('yarn')

const runAudit = async () => {
    if (!preferYarn) {
        const result = await run('npm', ['audit', `--audit-level=${level}`])
        if (result.error?.code !== 'ENOENT') {
            return result
        }
    }

    const fallback = await run('yarn', ['audit', '--level', level])
    if (fallback.error?.code === 'ENOENT' && preferYarn) {
        return run('npm', ['audit', `--audit-level=${level}`])
    }
    return fallback
}

const result = await runAudit()

if (result.error?.code === 'ENOENT') {
    console.error('deps:audit: yarn 或 npm 不可用，无法执行安全审计。')
    process.exitCode = 1
} else {
    process.exitCode = result.code
}
