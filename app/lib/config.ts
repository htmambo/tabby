import * as fs from 'fs'
import * as path from 'path'
import { createRequire } from 'module'

const runtimeRequire = createRequire(__filename)

let yamlModule: typeof import('js-yaml') | null = null
let atomicWriteCounter = 0


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

function getAtomicTempPath (filePath: string): string {
    return path.join(
        path.dirname(filePath),
        `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${atomicWriteCounter++}.tmp`,
    )
}

async function closeFileHandleQuietly (fileHandle: fs.promises.FileHandle | null): Promise<void> {
    if (!fileHandle) {
        return
    }
    try {
        await fileHandle.close()
    } catch {
        // Best-effort cleanup only.
    }
}

async function removeFileQuietly (filePath: string): Promise<void> {
    try {
        await fs.promises.unlink(filePath)
    } catch {
        // Best-effort cleanup only.
    }
}

async function writeFileAtomically (filePath: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
    const tempPath = getAtomicTempPath(filePath)
    const mode = await fs.promises.stat(filePath).then(stats => stats.mode & 0o777).catch(() => 0o600)
    let fileHandle: fs.promises.FileHandle | null = null

    try {
        fileHandle = await fs.promises.open(tempPath, 'wx', mode)
        await fileHandle.writeFile(content, { encoding })
        await fileHandle.sync()
        await fileHandle.close()
        fileHandle = null
        await fs.promises.rename(tempPath, filePath)
    } catch (error) {
        await closeFileHandleQuietly(fileHandle)
        await removeFileQuietly(tempPath)
        throw error
    }
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
        const cache: ConfigCacheData = {
            mtimeMs: stats.mtimeMs,
            size: stats.size,
            hasValue: parsed !== undefined,
        }
        if (parsed !== undefined) {
            cache.parsed = parsed
        }
        await writeFileAtomically(configCachePath, JSON.stringify(cache), 'utf8')
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
    await writeFileAtomically(configPath, content, 'utf8')
    await writeFileAtomically(configPath + '.backup', content, 'utf8')
    try {
        await persistConfigCache(getYAML().load(content))
    } catch {
        // Keep save behavior unchanged even if cache refresh fails or content is temporarily invalid.
    }
}
