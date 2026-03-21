import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

const runtimeRequire = createRequire(__filename)

let yamlModule: typeof import('js-yaml') | null = null
let atomicallyModule: typeof import('atomically') | null = null


export const configPath = path.join(process.env.TABBY_CONFIG_DIRECTORY!, 'config.yaml')
const legacyConfigPath = path.join(process.env.TABBY_CONFIG_DIRECTORY!, '../terminus', 'config.yaml')

function getYAML (): typeof import('js-yaml') {
    yamlModule ??= runtimeRequire('js-yaml') as typeof import('js-yaml')
    return yamlModule
}

function getAtomicallyWriteFile (): typeof import('atomically').writeFile {
    atomicallyModule ??= runtimeRequire('atomically') as typeof import('atomically')
    return atomicallyModule.writeFile
}


export function migrateConfig (): void {
    if (fs.existsSync(legacyConfigPath) && (
        !fs.existsSync(configPath) ||
        fs.statSync(configPath).mtime < fs.statSync(legacyConfigPath).mtime
    )) {
        fs.writeFileSync(configPath, fs.readFileSync(legacyConfigPath, 'utf8'), 'utf8')
    }
}

export function loadConfig (): any {
    migrateConfig()

    if (fs.existsSync(configPath)) {
        return getYAML().load(fs.readFileSync(configPath, 'utf8'))
    } else {
        return {}
    }
}

export async function saveConfig (content: string): Promise<void> {
    const writeFile = getAtomicallyWriteFile()
    await writeFile(configPath, content, { encoding: 'utf8' })
    await writeFile(configPath + '.backup', content, { encoding: 'utf8' })
}
