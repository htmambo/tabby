import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

const runtimeRequire = createRequire(__filename)

let yamlModule: typeof import('js-yaml') | null = null
let atomicallyModule: typeof import('atomically') | null = null


export const configPath = path.join(process.env.TABBY_CONFIG_DIRECTORY!, 'config.yaml')
const legacyConfigPath = path.join(process.env.TABBY_CONFIG_DIRECTORY!, '../terminus', 'config.yaml')
const configCachePath = path.join(process.env.TABBY_CONFIG_DIRECTORY!, 'config.cache.json')

interface ConfigCacheData {
    mtimeMs: number
    size: number
    hasValue: boolean
    parsed?: any
}

function getYAML (): typeof import('js-yaml') {
    yamlModule ??= runtimeRequire('js-yaml') as typeof import('js-yaml')
    return yamlModule
}

function getAtomicallyWriteFile (): typeof import('atomically').writeFile {
    atomicallyModule ??= runtimeRequire('atomically') as typeof import('atomically')
    return atomicallyModule.writeFile
}

function loadConfigCache (stats: fs.Stats): ConfigCacheData | null {
    try {
        const cache = JSON.parse(fs.readFileSync(configCachePath, 'utf8')) as ConfigCacheData
        if (cache.mtimeMs !== stats.mtimeMs || cache.size !== stats.size) {
            return null
        }
        return cache
    } catch {
        return null
    }
}

function persistConfigCacheSync (stats: fs.Stats, parsed: any): void {
    try {
        const cache: ConfigCacheData = {
            mtimeMs: stats.mtimeMs,
            size: stats.size,
            hasValue: parsed !== undefined,
        }
        if (parsed !== undefined) {
            cache.parsed = parsed
        }
        fs.writeFileSync(configCachePath, JSON.stringify(cache), 'utf8')
    } catch {
        // Cache persistence is best-effort and must not block loading the source YAML.
    }
}

async function persistConfigCache (parsed: any): Promise<void> {
    try {
        const stats = fs.statSync(configPath)
        const writeFile = getAtomicallyWriteFile()
        const cache: ConfigCacheData = {
            mtimeMs: stats.mtimeMs,
            size: stats.size,
            hasValue: parsed !== undefined,
        }
        if (parsed !== undefined) {
            cache.parsed = parsed
        }
        await writeFile(configCachePath, JSON.stringify(cache), { encoding: 'utf8' })
    } catch {
        // Cache persistence is best-effort and must not block saving the source YAML.
    }
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
        const stats = fs.statSync(configPath)
        const cached = loadConfigCache(stats)
        if (cached) {
            return cached.hasValue ? cached.parsed : undefined
        }

        const parsed = getYAML().load(fs.readFileSync(configPath, 'utf8'))
        persistConfigCacheSync(stats, parsed)
        return parsed
    } else {
        return {}
    }
}

export async function saveConfig (content: string): Promise<void> {
    const writeFile = getAtomicallyWriteFile()
    await writeFile(configPath, content, { encoding: 'utf8' })
    await writeFile(configPath + '.backup', content, { encoding: 'utf8' })
    try {
        await persistConfigCache(getYAML().load(content))
    } catch {
        // Keep save behavior unchanged even if cache refresh fails or content is temporarily invalid.
    }
}
