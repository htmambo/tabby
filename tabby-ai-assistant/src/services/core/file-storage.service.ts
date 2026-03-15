import { Injectable } from '@angular/core'
import { getRuntimeCwd, getRuntimeEnv } from 'tabby-core'
import { getTabbyBridge } from '../../../../app/src/tabby-bridge'
import { LoggerService } from './logger.service'

/**
 * 数据存储位置配置
 */
export interface DataStorageConfig {
    /** 数据目录路径 */
    dataDir: string;
    /** 是否启用文件存储 */
    enabled: boolean;
}

/**
 * 文件存储服务
 * 将持久化数据从 localStorage 迁移到插件目录的 JSON 文件
 * 实现用户可查看、可备份、可迁移的数据管理
 */
@Injectable({
    providedIn: 'root',
})
export class FileStorageService {
    /** 插件数据目录 */
    private readonly DATA_DIR: string

    /** 文件后缀名 */
    private readonly FILE_EXTENSION = '.json'

    /** 数据目录是否已初始化 */
    private initialized = false
    private writeQueue = Promise.resolve()
    private pendingFileContents = new Map<string, string>()
    private pendingDeletes = new Map<string, symbol>()

    constructor(private logger: LoggerService) {
        // 确定数据目录路径
        this.DATA_DIR = this.getDataDirectoryPath()
        this.ensureDataDir()
        this.logger.info('FileStorageService initialized', { dataDir: this.DATA_DIR })
    }

    /**
     * 获取数据目录路径
     */
    private getDataDirectoryPath(): string {
        // 优先使用 APPDATA 环境变量（Windows）
        const appData = getRuntimeEnv('APPDATA')
        if (appData) {
            return appData
        }
        // Linux/macOS 使用 HOME
        const homeDir = getRuntimeEnv('HOME')
        if (homeDir) {
            return homeDir
        }
        // 回退到当前工作目录
        return getRuntimeCwd()
    }

    /**
     * 确保数据目录存在
     */
    private ensureDataDir(): void {
        if (this.initialized) {
            return
        }

        try {
            const pluginDataDir = this.getPluginDataDirectory()

            if (!this.existsSync(pluginDataDir)) {
                this.mkdirSync(pluginDataDir, { recursive: true })
                this.logger.info('Created plugin data directory', { path: pluginDataDir })
            }

            this.initialized = true
        } catch (error) {
            this.logger.error('Failed to create data directory', { error })
        }
    }

    /**
     * 获取插件专用数据目录
     * 格式: {APPDATA}/tabby/plugins/tabby-ai-assistant/data
     */
    getPluginDataDirectory(): string {
        const baseDir = getRuntimeEnv('APPDATA')
            ?? getRuntimeEnv('HOME')
            ?? getRuntimeCwd()
        return this.joinPath(baseDir, 'tabby', 'plugins', 'tabby-ai-assistant', 'data')
    }

    /**
     * 保存数据到 JSON 文件
     */
    save<T>(filename: string, data: T): boolean {
        try {
            const filePath = this.getFilePath(filename)
            const jsonContent = JSON.stringify(data, null, 2)
            this.pendingDeletes.delete(filePath)
            this.pendingFileContents.set(filePath, jsonContent)
            this.enqueueWrite(async () => {
                try {
                    await this.writeFile(filePath, jsonContent, 'utf-8')
                    this.logger.debug('Saved data to file', { filename, path: filePath })
                } catch (error) {
                    this.logger.error('Failed to save data', { filename, error })
                } finally {
                    if (this.pendingFileContents.get(filePath) === jsonContent) {
                        this.pendingFileContents.delete(filePath)
                    }
                }
            })
            return true
        } catch (error) {
            this.logger.error('Failed to save data', { filename, error })
            return false
        }
    }

    /**
     * 从 JSON 文件加载数据
     */
    load<T>(filename: string, defaultValue: T): T {
        try {
            const filePath = this.getFilePath(filename)
            if (this.pendingDeletes.has(filePath)) {
                return defaultValue
            }

            const pendingContent = this.pendingFileContents.get(filePath)
            if (pendingContent !== undefined) {
                return JSON.parse(pendingContent) as T
            }

            if (this.existsSync(filePath)) {
                const content = this.readFileSync(filePath, 'utf-8')
                return JSON.parse(content) as T
            }
        } catch (error) {
            this.logger.error('Failed to load data', { filename, error })
        }
        return defaultValue
    }

    /**
     * 检查文件是否存在
     */
    exists(filename: string): boolean {
        try {
            const filePath = this.getFilePath(filename)
            if (this.pendingDeletes.has(filePath)) {
                return false
            }
            if (this.pendingFileContents.has(filePath)) {
                return true
            }
            return this.existsSync(filePath)
        } catch {
            return false
        }
    }

    /**
     * 删除数据文件
     */
    delete(filename: string): boolean {
        try {
            const filePath = this.getFilePath(filename)
            if (!this.pendingFileContents.has(filePath) && !this.existsSync(filePath)) {
                return false
            }

            const deleteToken = Symbol(filePath)
            this.pendingFileContents.delete(filePath)
            this.pendingDeletes.set(filePath, deleteToken)
            this.enqueueWrite(async () => {
                try {
                    await this.unlinkFile(filePath)
                    this.logger.debug('Deleted data file', { filename })
                } catch (error: any) {
                    if (error?.code !== 'ENOENT') {
                        this.logger.error('Failed to delete data', { filename, error })
                    }
                } finally {
                    if (this.pendingDeletes.get(filePath) === deleteToken) {
                        this.pendingDeletes.delete(filePath)
                    }
                }
            })
            return true
        } catch (error) {
            this.logger.error('Failed to delete data', { filename, error })
        }
        return false
    }

    /**
     * 列出所有数据文件
     */
    listFiles(): string[] {
        try {
            const files = this.readdirSync(this.DATA_DIR)
            return files.filter(f => f.endsWith(this.FILE_EXTENSION))
        } catch (error) {
            this.logger.error('Failed to list data files', { error })
            return []
        }
    }

    /**
     * 列出所有数据文件（带元信息）
     */
    listFilesWithInfo(): { name: string; size: number; modified: Date }[] {
        try {
            const files = this.readdirSync(this.DATA_DIR)
            const result: { name: string; size: number; modified: Date }[] = []

            for (const file of files) {
                if (file.endsWith(this.FILE_EXTENSION)) {
                    const filePath = this.getFilePath(file)
                    try {
                        const stats = this.statSync(filePath)
                        result.push({
                            name: file,
                            size: stats.size,
                            modified: stats.mtime,
                        })
                    } catch {
                        // 忽略无法获取信息的文件
                    }
                }
            }

            return result
        } catch (error) {
            this.logger.error('Failed to list data files with info', { error })
            return []
        }
    }

    /**
     * 获取数据目录路径（供用户查看）
     */
    getDataDirectory(): string {
        return this.getPluginDataDirectory()
    }

    /**
     * 导出所有数据为 JSON
     */
    exportAll(): string {
        const files = this.listFilesWithInfo()
        const allData: Record<string, any> = {}

        for (const file of files) {
            try {
                const data = this.load(file.name, null)
                if (data !== null) {
                    // 移除文件扩展名作为键名
                    const key = file.name.replace(this.FILE_EXTENSION, '')
                    allData[key] = data
                }
            } catch {
                this.logger.warn('Failed to load file for export', { filename: file.name })
            }
        }

        return JSON.stringify({
            exportDate: new Date().toISOString(),
            version: '1.0',
            data: allData,
        }, null, 2)
    }

    /**
     * 导入数据
     */
    importAll(jsonContent: string): { success: boolean; imported: string[]; errors: string[] } {
        const result = {
            success: true,
            imported: [] as string[],
            errors: [] as string[],
        }

        try {
            const importData = JSON.parse(jsonContent)

            if (!importData.data || typeof importData.data !== 'object') {
                throw new Error('Invalid import format')
            }

            for (const [key, value] of Object.entries(importData.data)) {
                const filename = `${key}${this.FILE_EXTENSION}`
                try {
                    const saved = this.save(filename, value)
                    if (saved) {
                        result.imported.push(filename)
                    } else {
                        result.errors.push(`${filename}: save failed`)
                    }
                } catch (error) {
                    result.errors.push(`${filename}: ${error}`)
                }
            }

            result.success = result.errors.length === 0
        } catch (error) {
            result.success = false
            result.errors.push(`Import failed: ${error}`)
        }

        return result
    }

    /**
     * 清除所有数据
     */
    clearAll(): number {
        let cleared = 0
        const files = this.listFiles()

        for (const file of files) {
            if (this.delete(file)) {
                cleared++
            }
        }

        this.logger.info('Cleared all data files', { count: cleared })
        return cleared
    }

    /**
     * 从 localStorage 迁移数据
     * 返回迁移的文件列表
     */
    migrateFromLocalStorage(): string[] {
        const migratedFiles: string[] = []

        // 定义需要迁移的 localStorage 键和对应的文件名
        const migrationMap: Record<string, string> = {
            'tabby-ai-assistant-memories': 'memories',
            'tabby-ai-assistant-chat-history': 'chat-sessions',
            'ai-assistant-config': 'config',
            'tabby-ai-assistant-context-config': 'context-config',
            'tabby-ai-assistant-auto-compact': 'auto-compact',
        }

        for (const [localStorageKey, filename] of Object.entries(migrationMap)) {
            try {
                const value = localStorage.getItem(localStorageKey)
                if (value) {
                    const data = JSON.parse(value)
                    const saved = this.save(`${filename}${this.FILE_EXTENSION}`, data)
                    if (saved) {
                        migratedFiles.push(filename)
                        this.logger.info('Migrated from localStorage', {
                            from: localStorageKey,
                            to: `${filename}${this.FILE_EXTENSION}`,
                        })
                    }
                }
            } catch (error) {
                this.logger.error('Failed to migrate from localStorage', {
                    key: localStorageKey,
                    error,
                })
            }
        }

        return migratedFiles
    }

    /**
     * 获取文件完整路径
     */
    private getFilePath(filename: string): string {
        // 如果已包含扩展名，直接使用；否则添加扩展名
        const normalizedName = filename.endsWith(this.FILE_EXTENSION)
            ? filename
            : `${filename}${this.FILE_EXTENSION}`
        return this.joinPath(this.DATA_DIR, normalizedName)
    }

    private enqueueWrite(operation: () => Promise<void>): void {
        this.writeQueue = this.writeQueue
            .catch(() => null)
            .then(operation)
    }

    // ==================== 文件系统操作封装 ====================

    private getBridgeIPC() {
        try {
            return getTabbyBridge().ipc
        } catch {
            return null
        }
    }

    private joinPath(...paths: string[]): string {
        // 使用 path.join 的替代方案
        return paths.map(p => p.replace(/\\/g, '/').replace(/\/+/g, '/')).join('/')
    }

    private async writeFile(path: string, data: string, encoding?: string): Promise<void> {
        const ipc = this.getBridgeIPC()
        if (ipc) {
            await ipc.invoke('bridge:fs:write-file-text', path, data, encoding ?? 'utf-8')
            return
        }
        this.writeFileSync(path, data, encoding)
    }

    private async unlinkFile(path: string): Promise<void> {
        this.unlinkSync(path)
    }

    private existsSync(path: string): boolean {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                return ipc.sendSync<boolean>('bridge:fs:exists-sync', path)
            }
            // 回退：使用 XMLHttpRequest 检查
            return this.fallbackExistsSync(path)
        } catch {
            return this.fallbackExistsSync(path)
        }
    }

    private fallbackExistsSync(path: string): boolean {
        try {
            const xhr = new XMLHttpRequest()
            xhr.open('HEAD', `file://${path}`, false)
            xhr.send()
            return xhr.status === 200
        } catch {
            return false
        }
    }

    private mkdirSync(path: string, options?: { recursive?: boolean }): void {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                ipc.sendSync('bridge:fs:mkdir-sync', path, options?.recursive ?? false)
            }
        } catch (error) {
            this.logger.error('mkdirSync failed', { path, error })
        }
    }

    private writeFileSync(path: string, data: string, encoding?: string): void {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                ipc.sendSync('bridge:fs:write-file-text-sync', path, data, encoding ?? 'utf-8')
            } else {
                this.fallbackWriteFileSync(path, data)
            }
        } catch (error) {
            this.logger.error('writeFileSync failed', { path, error })
            throw error
        }
    }

    private fallbackWriteFileSync(path: string, data: string): void {
        try {
            // 在纯浏览器环境中，使用 Blob 下载
            const blob = new Blob([data], { type: 'application/json' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = path.split('/').pop() ?? 'data.json'
            a.click()
            URL.revokeObjectURL(url)
        } catch (error) {
            this.logger.error('fallbackWriteFileSync failed', { error })
        }
    }

    private readFileSync(path: string, encoding?: string): string {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                return ipc.sendSync<string>('bridge:fs:read-file-text-sync', path, encoding ?? 'utf-8')
            }
            return this.fallbackReadFileSync(path)
        } catch (error) {
            this.logger.error('readFileSync failed', { path, error })
            throw error
        }
    }

    private fallbackReadFileSync(_path: string): string {
        return ''
    }

    private unlinkSync(path: string): void {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                ipc.sendSync('bridge:fs:unlink-sync', path)
            }
        } catch (error) {
            this.logger.error('unlinkSync failed', { path, error })
        }
    }

    private readdirSync(path: string): string[] {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                return ipc.sendSync<Array<{ name: string }>>('bridge:fs:read-dir-sync', path).map(entry => entry.name)
            }
            return []
        } catch {
            return []
        }
    }

    private statSync(path: string): { size: number; mtime: Date } {
        try {
            const ipc = this.getBridgeIPC()
            if (ipc) {
                const stats = ipc.sendSync<{ size: number; mtimeMs: number } | null>('bridge:fs:stat-sync', path)
                if (stats) {
                    return { size: stats.size, mtime: new Date(stats.mtimeMs) }
                }
            }
            return { size: 0, mtime: new Date() }
        } catch {
            return { size: 0, mtime: new Date() }
        }
    }
}
