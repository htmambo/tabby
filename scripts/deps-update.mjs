import { spawn } from 'child_process'

const run = (command, args) => new Promise(resolve => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.on('error', error => resolve({ code: error.code ?? 1, error }))
    child.on('exit', code => resolve({ code: code ?? 0 }))
})

const userAgent = process.env.npm_config_user_agent ?? ''
const preferYarn = userAgent.includes('yarn')

const runUpdate = async () => {
    if (preferYarn) {
        const result = await run('yarn', ['upgrade', '--latest'])
        if (result.error?.code !== 'ENOENT') {
            return result
        }
    }

    const fallback = await run('npm', ['update'])
    if (fallback.error?.code === 'ENOENT' && !preferYarn) {
        return run('yarn', ['upgrade', '--latest'])
    }
    return fallback
}

const result = await runUpdate()

if (result.error?.code === 'ENOENT') {
    console.error('deps:update: yarn 或 npm 不可用，无法执行依赖更新。')
    process.exitCode = 1
} else {
    process.exitCode = result.code
}
