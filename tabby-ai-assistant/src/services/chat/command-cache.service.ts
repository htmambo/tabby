import { Injectable, OnDestroy } from '@angular/core'
import { Subscription } from 'rxjs'
import { LoggerService } from '../core/logger.service'
import { FileStorageService } from '../core/file-storage.service'
import { ConfigProviderService } from '../core/config-provider.service'

/**
 * 替代命令
 */
export interface AlternativeCommand {
    command: string
    explanation: string
    confidence: number
    tags?: string[]  // 标签：如 'safe', 'fast', 'compatible'
}

/**
 * 命令缓存条目
 */
export interface CommandCacheEntry {
    id: string
    naturalLanguage: string    // 用户原始输入
    contextHash: string        // 上下文指纹
    command: string            // 生成的命令
    explanation: string        // 命令说明
    confidence: number         // 置信度
    alternatives?: AlternativeCommand[]
    provider: string           // LLM 提供商
    model: string              // 模型名称
    createdAt: number          // 创建时间戳
    lastAccessedAt: number     // 最后访问时间戳
    hitCount: number           // 命中次数
    ttl: number                // 过期时间（秒）
}

/**
 * 命令缓存配置
 */
export interface CommandCacheConfig {
    enabled: boolean
    maxSize: number            // 最大条目数
    defaultTtl: number         // 默认过期时间（秒）
}

/**
 * 缓存统计信息
 */
export interface CommandCacheStats {
    totalEntries: number
    totalHits: number
    totalMisses: number
    hitRate: number
    expiredEntries: number
    oldestEntry: number | null
    newestEntry: number | null
}

/**
 * 上下文指纹参数
 */
export interface ContextFingerprint {
    os?: string
    shell?: string
    provider: string
    model: string
    temperature?: number
    maxTokens?: number
}

const DEFAULT_CACHE_CONFIG: CommandCacheConfig = {
    enabled: true,
    maxSize: 500,
    defaultTtl: 7 * 24 * 3600,  // 7 天
}

const STORAGE_KEY = 'command-cache.json'

/**
 * 命令缓存服务
 * 提供 LRU 缓存机制，支持 TTL 过期和持久化存储
 */
@Injectable({
    providedIn: 'root',
})
export class CommandCacheService implements OnDestroy {
    private cache = new Map<string, CommandCacheEntry>()
    private config: CommandCacheConfig = { ...DEFAULT_CACHE_CONFIG }
    private stats = {
        hits: 0,
        misses: 0,
    }
    private cleanupInterval: ReturnType<typeof setInterval> | null = null
    private initialized = false
    private configSubscription: Subscription | null = null

    constructor(
        private logger: LoggerService,
        private fileStorage: FileStorageService,
        private configProvider: ConfigProviderService,
    ) {
        this.initialize()
        this.subscribeToConfigChanges()
    }

    ngOnDestroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
            this.cleanupInterval = null
        }
        if (this.configSubscription) {
            this.configSubscription.unsubscribe()
            this.configSubscription = null
        }
        // 保存缓存到文件
        this.persist()
    }

    /**
     * 订阅配置变更
     */
    private subscribeToConfigChanges(): void {
        this.configSubscription = this.configProvider.onConfigChange().subscribe(({ key, value }) => {
            if (key === 'commandCache' || key === '*') {
                this.applyExternalConfig(value)
            }
        })
    }

    /**
     * 应用外部配置
     */
    private applyExternalConfig(externalConfig: CommandCacheConfig | undefined): void {
        if (!externalConfig) {
            return
        }

        const oldEnabled = this.config.enabled
        this.config = { ...DEFAULT_CACHE_CONFIG, ...externalConfig }

        // 如果 maxSize 变小，需要淘汰多余的条目
        if (externalConfig.maxSize !== undefined && this.cache.size > externalConfig.maxSize) {
            this.evictLRU(this.cache.size - externalConfig.maxSize)
        }

        // 配置变更时持久化
        this.schedulePersist()

        this.logger.info('Applied external command cache config', {
            enabled: this.config.enabled,
            maxSize: this.config.maxSize,
            defaultTtl: this.config.defaultTtl,
            wasEnabled: oldEnabled,
        })
    }

    /**
     * 初始化缓存
     */
    private initialize(): void {
        if (this.initialized) {
            return
        }

        try {
            // 加载持久化数据
            this.load()

            // 启动定时清理任务（每分钟）
            this.cleanupInterval = setInterval(() => {
                this.cleanupExpired()
            }, 60 * 1000)

            this.initialized = true
            this.logger.info('CommandCacheService initialized', {
                entries: this.cache.size,
                config: this.config,
            })
        } catch (error) {
            this.logger.error('Failed to initialize CommandCacheService', error)
        }
    }

    /**
     * 更新缓存配置
     */
    updateConfig(config: Partial<CommandCacheConfig>): void {
        this.config = { ...this.config, ...config }
        this.logger.info('Cache config updated', this.config)

        // 如果 maxSize 变小，需要淘汰多余的条目
        if (config.maxSize !== undefined && this.cache.size > config.maxSize) {
            this.evictLRU(this.cache.size - config.maxSize)
        }

        // 同步到全局配置
        this.configProvider.updateCommandCacheConfig(this.config)

        // 持久化
        this.schedulePersist()
    }

    /**
     * 获取当前配置
     */
    getConfig(): CommandCacheConfig {
        return { ...this.config }
    }

    /**
     * 计算上下文指纹哈希
     */
    computeContextHash(fingerprint: ContextFingerprint): string {
        const parts = [
            fingerprint.os ?? '',
            fingerprint.shell ?? '',
            fingerprint.provider,
            fingerprint.model,
            fingerprint.temperature?.toString() ?? '',
            fingerprint.maxTokens?.toString() ?? '',
        ]
        return this.simpleHash(parts.join('|'))
    }

    /**
     * 简单哈希函数
     */
    private simpleHash(str: string): string {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i)
            hash = ((hash << 5) - hash) + char
            hash = hash & hash // Convert to 32bit integer
        }
        return Math.abs(hash).toString(36)
    }

    /**
     * 计算缓存键
     */
    private computeCacheKey(naturalLanguage: string, contextHash: string): string {
        const normalizedInput = naturalLanguage.trim().toLowerCase()
        return `${contextHash}:${this.simpleHash(normalizedInput)}`
    }

    /**
     * 获取缓存条目
     */
    get(naturalLanguage: string, fingerprint: ContextFingerprint): CommandCacheEntry | null {
        if (!this.config.enabled) {
            return null
        }

        const contextHash = this.computeContextHash(fingerprint)
        const key = this.computeCacheKey(naturalLanguage, contextHash)
        const entry = this.cache.get(key)

        if (!entry) {
            this.stats.misses++
            this.logger.debug('Cache miss', { key, naturalLanguage })
            return null
        }

        // 检查是否过期
        if (this.isExpired(entry)) {
            this.cache.delete(key)
            this.stats.misses++
            this.logger.debug('Cache entry expired', { key, naturalLanguage })
            return null
        }

        // 更新访问信息（LRU）
        entry.lastAccessedAt = Date.now()
        entry.hitCount++

        this.stats.hits++
        this.logger.debug('Cache hit', { key, naturalLanguage, hitCount: entry.hitCount })

        return { ...entry }
    }

    /**
     * 设置缓存条目
     */
    set(
        naturalLanguage: string,
        fingerprint: ContextFingerprint,
        command: string,
        explanation: string,
        confidence: number,
        alternatives?: AlternativeCommand[],
        ttl?: number,
    ): CommandCacheEntry {
        const contextHash = this.computeContextHash(fingerprint)
        const key = this.computeCacheKey(naturalLanguage, contextHash)
        const now = Date.now()

        const entry: CommandCacheEntry = {
            id: this.generateId(),
            naturalLanguage: naturalLanguage.trim(),
            contextHash,
            command,
            explanation,
            confidence,
            alternatives,
            provider: fingerprint.provider,
            model: fingerprint.model,
            createdAt: now,
            lastAccessedAt: now,
            hitCount: 0,
            ttl: ttl ?? this.config.defaultTtl,
        }

        // 检查是否需要淘汰
        if (this.cache.size >= this.config.maxSize) {
            this.evictLRU(1)
        }

        this.cache.set(key, entry)

        this.logger.debug('Cache entry set', {
            key,
            naturalLanguage: entry.naturalLanguage,
            command: entry.command,
            ttl: entry.ttl,
        })

        // 异步持久化
        this.schedulePersist()

        return { ...entry }
    }

    /**
     * 删除缓存条目
     */
    delete(naturalLanguage: string, fingerprint: ContextFingerprint): boolean {
        const contextHash = this.computeContextHash(fingerprint)
        const key = this.computeCacheKey(naturalLanguage, contextHash)

        const deleted = this.cache.delete(key)

        if (deleted) {
            this.logger.debug('Cache entry deleted', { key })
            this.schedulePersist()
        }

        return deleted
    }

    /**
     * 通过 ID 删除缓存条目
     */
    deleteById(id: string): boolean {
        for (const [key, entry] of this.cache.entries()) {
            if (entry.id === id) {
                this.cache.delete(key)
                this.logger.debug('Cache entry deleted by ID', { id, key })
                this.schedulePersist()
                return true
            }
        }
        return false
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        const count = this.cache.size
        this.cache.clear()
        this.logger.info('Cache cleared', { entriesRemoved: count })
        this.schedulePersist()
    }

    /**
     * 检查条目是否过期
     */
    private isExpired(entry: CommandCacheEntry): boolean {
        const expiresAt = entry.createdAt + (entry.ttl * 1000)
        return Date.now() > expiresAt
    }

    /**
     * 清理过期条目
     */
    private cleanupExpired(): void {
        const now = Date.now()
        let expiredCount = 0

        for (const [key, entry] of this.cache.entries()) {
            if (this.isExpired(entry)) {
                this.cache.delete(key)
                expiredCount++
            }
        }

        if (expiredCount > 0) {
            this.logger.info('Expired cache entries cleaned up', { count: expiredCount })
            this.schedulePersist()
        }
    }

    /**
     * LRU 淘汰策略
     */
    private evictLRU(count: number): void {
        if (count <= 0 || this.cache.size === 0) {
            return
        }

        // 按最后访问时间排序，淘汰最久未访问的
        const entries = Array.from(this.cache.entries())
            .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)

        const toEvict = entries.slice(0, count)
        for (const [key] of toEvict) {
            this.cache.delete(key)
        }

        this.logger.debug('LRU eviction completed', { evictedCount: toEvict.length })
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): CommandCacheStats {
        const entries = Array.from(this.cache.values())
        const now = Date.now()

        let oldestEntry: number | null = null
        let newestEntry: number | null = null
        let expiredCount = 0

        for (const entry of entries) {
            if (oldestEntry === null || entry.createdAt < oldestEntry) {
                oldestEntry = entry.createdAt
            }
            if (newestEntry === null || entry.createdAt > newestEntry) {
                newestEntry = entry.createdAt
            }
            if (this.isExpired(entry)) {
                expiredCount++
            }
        }

        const totalRequests = this.stats.hits + this.stats.misses
        const hitRate = totalRequests > 0 ? this.stats.hits / totalRequests : 0

        return {
            totalEntries: this.cache.size,
            totalHits: this.stats.hits,
            totalMisses: this.stats.misses,
            hitRate: Math.round(hitRate * 100) / 100,
            expiredEntries: expiredCount,
            oldestEntry,
            newestEntry,
        }
    }

    /**
     * 重置统计信息
     */
    resetStats(): void {
        this.stats.hits = 0
        this.stats.misses = 0
        this.logger.info('Cache stats reset')
    }

    /**
     * 获取所有缓存条目（用于调试）
     */
    getAllEntries(): CommandCacheEntry[] {
        return Array.from(this.cache.values()).map(entry => ({ ...entry }))
    }

    /**
     * 搜索缓存条目
     */
    search(query: string, limit: number = 10): CommandCacheEntry[] {
        const normalizedQuery = query.trim().toLowerCase()
        const results: CommandCacheEntry[] = []

        for (const entry of this.cache.values()) {
            if (this.isExpired(entry)) {
                continue
            }

            // 搜索自然语言输入或命令
            if (
                entry.naturalLanguage.toLowerCase().includes(normalizedQuery) ||
                entry.command.toLowerCase().includes(normalizedQuery)
            ) {
                results.push({ ...entry })
            }

            if (results.length >= limit) {
                break
            }
        }

        return results
    }

    /**
     * 持久化缓存到文件
     */
    private persist(): void {
        try {
            const entries = Array.from(this.cache.entries())
            const data = {
                version: 1,
                config: this.config,
                entries: entries.map(([key, entry]) => ({ key, entry })),
                stats: this.stats,
                savedAt: Date.now(),
            }

            this.fileStorage.save(STORAGE_KEY, data)
            this.logger.debug('Cache persisted', { entries: entries.length })
        } catch (error) {
            this.logger.error('Failed to persist cache', error)
        }
    }

    /**
     * 从文件加载缓存
     */
    private load(): void {
        try {
            const data = this.fileStorage.load<{
                version: number
                config?: CommandCacheConfig
                entries?: Array<{ key: string; entry: CommandCacheEntry }>
                stats?: { hits: number; misses: number }
            }>(STORAGE_KEY, { version: 1, entries: [] })

            if (data.config) {
                this.config = { ...DEFAULT_CACHE_CONFIG, ...data.config }
            }

            if (data.entries) {
                const now = Date.now()
                for (const { key, entry } of data.entries) {
                    // 跳过过期条目
                    if (entry.createdAt + (entry.ttl * 1000) > now) {
                        this.cache.set(key, entry)
                    }
                }
            }

            if (data.stats) {
                this.stats.hits = data.stats.hits ?? 0
                this.stats.misses = data.stats.misses ?? 0
            }

            this.logger.info('Cache loaded from storage', {
                entries: this.cache.size,
                hits: this.stats.hits,
                misses: this.stats.misses,
            })
        } catch (error) {
            this.logger.error('Failed to load cache', error)
            // 使用空缓存
            this.cache.clear()
        }
    }

    /**
     * 调度持久化（防抖）
     */
    private persistTimeout: ReturnType<typeof setTimeout> | null = null

    private schedulePersist(): void {
        if (this.persistTimeout) {
            clearTimeout(this.persistTimeout)
        }

        this.persistTimeout = setTimeout(() => {
            this.persist()
            this.persistTimeout = null
        }, 1000)
    }

    /**
     * 生成唯一 ID
     */
    private generateId(): string {
        return `cache-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    }

    /**
     * 手动触发持久化（用于测试或特殊场景）
     */
    flush(): void {
        this.persist()
    }

    /**
     * 检查缓存是否启用
     */
    isEnabled(): boolean {
        return this.config.enabled
    }

    /**
     * 启用/禁用缓存
     */
    setEnabled(enabled: boolean): void {
        this.config.enabled = enabled
        this.logger.info('Cache enabled state changed', { enabled })

        if (!enabled) {
            // 禁用时可以选择清空缓存
            // this.clear() // 可选：清空缓存
        }
    }

    /**
     * 获取缓存大小
     */
    size(): number {
        return this.cache.size
    }

    /**
     * 预热缓存（批量添加条目）
     */
    warmup(entries: Array<{
        naturalLanguage: string
        fingerprint: ContextFingerprint
        command: string
        explanation: string
        confidence: number
        alternatives?: AlternativeCommand[]
    }>): number {
        let added = 0
        for (const entry of entries) {
            this.set(
                entry.naturalLanguage,
                entry.fingerprint,
                entry.command,
                entry.explanation,
                entry.confidence,
                entry.alternatives,
            )
            added++
        }

        this.logger.info('Cache warmup completed', { entriesAdded: added })
        return added
    }
}