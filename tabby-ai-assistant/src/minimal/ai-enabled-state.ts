import * as path from 'path'
import { getRuntimeCwd, getRuntimeEnv } from 'tabby-core'
import { getTabbyBridge } from '../../../app/src/tabby-bridge'

interface StoredAiAssistantConfig {
    enabled?: boolean
}

const AI_ASSISTANT_CONFIG_FILE_NAME = 'config.json'

function getAiAssistantConfigPath (): string {
    const baseDir = getRuntimeEnv('APPDATA') ?? getRuntimeEnv('HOME') ?? getRuntimeCwd()
    return path.join(baseDir, 'tabby', 'plugins', 'tabby-ai-assistant', 'data', AI_ASSISTANT_CONFIG_FILE_NAME)
}

export function isAiAssistantEnabled (): boolean {
    try {
        const ipc = getTabbyBridge().ipc
        const configPath = getAiAssistantConfigPath()
        if (!ipc.sendSync<boolean>('bridge:fs:exists-sync', configPath)) {
            return true
        }
        const raw = ipc.sendSync<string>('bridge:fs:read-file-text-sync', configPath, 'utf-8')
        const parsed = JSON.parse(raw) as StoredAiAssistantConfig
        return parsed.enabled !== false
    } catch {
        return true
    }
}
