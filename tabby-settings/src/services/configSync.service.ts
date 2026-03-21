import { Injectable, OnDestroy } from '@angular/core'
import { lastValueFrom } from 'rxjs'
import { ConfigService, HostAppService, Logger, LogService, Platform, PlatformService } from 'tabby-core'

export interface User {
    id: number
}

export interface Config {
    id: number
    name: string
    content: string
    last_used_with_version: string|null
    created_at: Date
    modified_at: Date
}

interface UploadOptions {
    expectedRemoteModifiedAt?: Date
    onConflict?: 'throw' | 'download'
    localData?: any
    localFingerprint?: string
}

export class SyncConflictError extends Error {
    remoteConfig: Config
    expectedRemoteModifiedAt: Date
    actualRemoteModifiedAt: Date

    constructor (remoteConfig: Config, expectedRemoteModifiedAt: Date) {
        const parsedActualRemoteModifiedAt = new Date(remoteConfig.modified_at)
        const actualRemoteModifiedAt = Number.isNaN(parsedActualRemoteModifiedAt.getTime()) ? new Date(0) : parsedActualRemoteModifiedAt
        const parsedExpectedRemoteModifiedAt = new Date(expectedRemoteModifiedAt)
        const safeExpectedRemoteModifiedAt = Number.isNaN(parsedExpectedRemoteModifiedAt.getTime()) ? new Date(0) : parsedExpectedRemoteModifiedAt
        super(`Remote config changed (${actualRemoteModifiedAt.toISOString()}) after local checkpoint (${safeExpectedRemoteModifiedAt.toISOString()})`)
        this.name = 'SyncConflictError'
        this.remoteConfig = remoteConfig
        this.expectedRemoteModifiedAt = safeExpectedRemoteModifiedAt
        this.actualRemoteModifiedAt = actualRemoteModifiedAt
    }
}

const OPTIONAL_CONFIG_PARTS = ['hotkeys', 'appearance', 'vault']
const MISSING_CONFIG_VALUE = Symbol('missing-config-value')
const NON_SYNCED_CONFIG_PATHS = [
    // Add more dotted paths here when a setting should remain local-only.
    'appearance.dock',
    'appearance.dockAlwaysOnTop',
    'appearance.dockFill',
    'appearance.dockHideOnBlur',
    'appearance.dockScreen',
    'appearance.dockSpace',
    'appearance.frame',
    'appearance.opacity',
    'appearance.vibrancy',
    'appearance.vibrancyType',
]

@Injectable({ providedIn: 'root' })
export class ConfigSyncService implements OnDestroy {
    private logger: Logger
    private lastRemoteChange = new Date(0)
    private lastSyncedLocalFingerprint: string|null = null
    private internalConfigWriteInProgress = false
    private autoSyncLocalChangeInProgress = false
    private destroyed = false
    private autoSyncSleepHandle: ReturnType<typeof setTimeout> | null = null
    private yamlModulePromise: Promise<any> | null = null
    private axiosModulePromise: Promise<any> | null = null

    constructor (
        log: LogService,
        private platform: PlatformService,
        private hostApp: HostAppService,
        private config: ConfigService,
    ) {
        this.logger = log.create('configSync')
        void lastValueFrom(config.ready$).then(async () => {
            try {
                this.lastSyncedLocalFingerprint = await this.readLocalSyncFingerprint()
            } catch (error) {
                this.logger.debug('Failed to initialize local sync fingerprint', error)
            }
            this.autoSync()
            config.changed$.subscribe(() => {
                if (this.internalConfigWriteInProgress) {
                    return
                }
                if (this.isEnabled() && this.isAutoSyncEnabled()) {
                    void this.handleLocalConfigChanged()
                }
            })
        })
    }

    ngOnDestroy (): void {
        this.destroyed = true
        if (this.autoSyncSleepHandle !== null) {
            clearTimeout(this.autoSyncSleepHandle)
            this.autoSyncSleepHandle = null
        }
    }

    isAvailable (): boolean {
        return this.hostApp.platform !== Platform.Web
    }

    isEnabled (): boolean {
        return this.isAvailable() &&
            !!this.config.store.configSync.host &&
            !!this.config.store.configSync.token &&
            !!this.config.store.configSync.configID
    }

    private isAutoSyncEnabled (): boolean {
        return this.config.store.configSync.auto === true
    }

    async getConfigs (): Promise<Config[]> {
        return this.request('GET', '/api/1/configs')
    }

    async getConfig (id: number): Promise<Config> {
        return this.request('GET', `/api/1/configs/${id}`)
    }

    async updateConfig (id: number, data: Partial<Config>): Promise<Config> {
        return this.request('PATCH', `/api/1/configs/${id}`, { data })
    }

    async getUser (): Promise<any> {
        return this.request('GET', '/api/1/user')
    }

    async createNewConfig (name: string): Promise<Config> {
        return this.request('POST', '/api/1/configs', {
            data: {
                name,
            },
        })
    }

    async deleteConfig (id: number): Promise<any> {
        return this.request('DELETE', `/api/1/configs/${id}`)
    }

    setConfig (config: Config): void {
        this.config.store.configSync.configID = config.id
        void this.config.save()
        this.lastRemoteChange = this.parseModifiedAt(config.modified_at)
    }

    isSyncConflictError (error: unknown): error is SyncConflictError {
        return error instanceof SyncConflictError
    }

    async upload (remoteConfig?: Config, options: UploadOptions = {}): Promise<void> {
        if (!this.isEnabled()) {
            return
        }
        try {
            const yaml = await this.getYaml()
            const data = options.localData ?? await this.readConfigDataForSync()
            const localFingerprint = options.localFingerprint ?? this.serializeForSyncFingerprint(data)
            const currentRemoteConfig = remoteConfig ?? await this.getConfig(this.config.store.configSync.configID)
            const expectedRemoteModifiedAt = options.expectedRemoteModifiedAt ?? this.lastRemoteChange
            if (this.parseModifiedAt(currentRemoteConfig.modified_at) > expectedRemoteModifiedAt) {
                this.logger.warn('Remote config is newer than local checkpoint, rejecting upload to avoid overwrite')
                if (options.onConflict === 'download') {
                    await this.download(currentRemoteConfig)
                    return
                }
                throw new SyncConflictError(currentRemoteConfig, expectedRemoteModifiedAt)
            }
            const remoteData = yaml.load(currentRemoteConfig.content) as any
            for (const part of OPTIONAL_CONFIG_PARTS) {
                if (!this.config.store.configSync.parts[part]) {
                    data[part] = remoteData[part]
                }
            }
            this.removeNonSyncedConfigPaths(data)
            const content = yaml.dump(data)
            const result = await this.updateConfig(this.config.store.configSync.configID, {
                content,
                last_used_with_version: this.platform.getAppVersion(),
            })
            this.lastRemoteChange = this.parseModifiedAt(result.modified_at)
            this.lastSyncedLocalFingerprint = localFingerprint
            this.logger.debug('Config uploaded')
        } catch (error) {
            this.logger.error('Upload failed:', error)
            throw error
        }
    }

    async download (remoteConfig?: Config): Promise<void> {
        if (!this.isEnabled()) {
            return
        }
        try {
            const yaml = await this.getYaml()
            const config = remoteConfig ?? await this.getConfig(this.config.store.configSync.configID)
            const data = yaml.load(config.content) as any

            const localData = yaml.load(this.config.readRaw()) as any
            data.configSync = localData.configSync

            if (!data.encrypted) {
                for (const part of OPTIONAL_CONFIG_PARTS) {
                    if (!this.config.store.configSync.parts[part]) {
                        data[part] = localData[part]
                    }
                }
            }
            this.restoreNonSyncedConfigPaths(data, localData)

            await this.writeConfigDataFromSync(data)
            this.lastRemoteChange = this.parseModifiedAt(config.modified_at)
            this.lastSyncedLocalFingerprint = await this.readLocalSyncFingerprint()
            this.logger.debug('Config downloaded')
        } catch (error) {
            this.logger.error('Download failed:', error)
            throw error
        }
    }

    async delete (config: Config): Promise<void> {
        try {
            await this.deleteConfig(config.id)
            this.logger.debug('Config deleted')
        } catch (error) {
            this.logger.error('Delete failed:', error)
            throw error
        }
    }

    private async readConfigDataForSync (): Promise<any> {
        const yaml = await this.getYaml()
        const data = yaml.load(await this.platform.loadConfig()) as any
        delete data.configSync
        this.removeNonSyncedConfigPaths(data)
        return data
    }

    private async writeConfigDataFromSync (data: any) {
        this.internalConfigWriteInProgress = true
        try {
            const yaml = await this.getYaml()
            await this.platform.saveConfig(yaml.dump(data))
            await this.config.load()
            await this.config.save()
        } finally {
            this.internalConfigWriteInProgress = false
        }
    }

    private async request (method: 'GET'|'POST'|'PATCH'|'DELETE', url: string, params = {}) {
        const host = this.getNormalizedHost()
        const token = this.getToken()
        const axiosModule = await this.getAxios()
        const axios = axiosModule.default ?? axiosModule

        url = host + url
        this.logger.debug(`${method} ${url}`, params)
        try {
            const response = await axios.request({
                url,
                method,
                headers: {
                    Authorization: `Bearer ${token}`,
                },
                ...params,
            })
            this.logger.debug('Config sync request completed', {
                method,
                url,
                status: response.status,
            })
            return response.data
        } catch (error) {
            this.logger.error('Config sync request failed', this.describeRequestError(error))
            throw error
        }
    }

    private async getYaml (): Promise<any> {
        this.yamlModulePromise ??= import('js-yaml')
        return this.yamlModulePromise
    }

    private async getAxios (): Promise<any> {
        this.axiosModulePromise ??= import('axios')
        return this.axiosModulePromise
    }

    private describeRequestError (error: unknown): Record<string, unknown> {
        const anyError = error as any
        return {
            message: anyError?.message,
            status: anyError?.response?.status,
            statusText: anyError?.response?.statusText,
            url: anyError?.config?.url,
            method: anyError?.config?.method,
        }
    }

    private getNormalizedHost (): string {
        const host = this.config.store.configSync.host
        if (typeof host !== 'string') {
            throw new Error('Config sync host is not configured')
        }

        const normalizedHost = host.trim().replace(/\/+$/, '')
        if (!normalizedHost) {
            throw new Error('Config sync host is not configured')
        }

        return normalizedHost
    }

    private getToken (): string {
        const token = this.config.store.configSync.token
        if (typeof token !== 'string') {
            throw new Error('Config sync token is not configured')
        }

        const normalizedToken = token.trim()
        if (!normalizedToken) {
            throw new Error('Config sync token is not configured')
        }

        return normalizedToken
    }

    private async autoSync () {
        while (!this.destroyed) {
            try {
                if (this.isEnabled() && this.isAutoSyncEnabled() && !this.autoSyncLocalChangeInProgress) {
                    const cfg = await this.getConfig(this.config.store.configSync.configID)
                    if (this.parseModifiedAt(cfg.modified_at) > this.lastRemoteChange) {
                        this.logger.info('Remote config changed, downloading')
                        await this.download(cfg)
                    }
                }
            } catch (error) {
                this.logger.debug('Recovering from autoSync network error')
            }
            await this.sleepAutoSync(60000)
        }
    }

    private sleepAutoSync (ms: number): Promise<void> {
        if (this.destroyed) {
            return Promise.resolve()
        }
        return new Promise(resolve => {
            this.autoSyncSleepHandle = setTimeout(() => {
                this.autoSyncSleepHandle = null
                resolve()
            }, ms)
        })
    }

    private async handleLocalConfigChanged (): Promise<void> {
        if (this.autoSyncLocalChangeInProgress) {
            return
        }
        this.autoSyncLocalChangeInProgress = true
        try {
            const localData = await this.readConfigDataForSync()
            const localFingerprint = this.serializeForSyncFingerprint(localData)
            if (localFingerprint === this.lastSyncedLocalFingerprint) {
                this.logger.debug('Local config changed event does not affect sync payload, skipping auto-sync upload')
                return
            }
            const cfg = await this.getConfig(this.config.store.configSync.configID)
            const remoteModifiedAt = this.parseModifiedAt(cfg.modified_at)
            if (remoteModifiedAt > this.lastRemoteChange) {
                this.logger.info('Remote config is newer than local sync checkpoint, downloading instead of uploading')
                await this.download(cfg)
                return
            }
            this.logger.debug('Local config changed, uploading (auto sync)')
            await this.upload(cfg, {
                expectedRemoteModifiedAt: this.lastRemoteChange,
                onConflict: 'download',
                localData,
                localFingerprint,
            })
        } catch (error) {
            this.logger.debug('Recovering from local autoSync trigger error')
        } finally {
            this.autoSyncLocalChangeInProgress = false
        }
    }

    private parseModifiedAt (value: Date|string): Date {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
            return new Date(0)
        }
        return date
    }

    private async readLocalSyncFingerprint (): Promise<string> {
        const data = await this.readConfigDataForSync()
        return this.serializeForSyncFingerprint(data)
    }

    private serializeForSyncFingerprint (value: any): string {
        if (value === null) {
            return 'null'
        }
        if (typeof value !== 'object') {
            return JSON.stringify(value)
        }
        if (value instanceof Date) {
            return `date:${value.toISOString()}`
        }
        if (value instanceof Array) {
            return `[${value.map(x => this.serializeForSyncFingerprint(x)).join(',')}]`
        }
        const keys = Object.keys(value).sort()
        return `{${keys.map(key => `${JSON.stringify(key)}:${this.serializeForSyncFingerprint(value[key])}`).join(',')}}`
    }

    private removeNonSyncedConfigPaths (data: any): void {
        for (const configPath of NON_SYNCED_CONFIG_PATHS) {
            this.deleteConfigPathValue(data, configPath)
        }
    }

    private restoreNonSyncedConfigPaths (target: any, localSource: any): void {
        for (const configPath of NON_SYNCED_CONFIG_PATHS) {
            const localValue = this.getConfigPathValue(localSource, configPath)
            if (localValue === MISSING_CONFIG_VALUE) {
                this.deleteConfigPathValue(target, configPath)
                continue
            }
            this.setConfigPathValue(target, configPath, localValue)
        }
    }

    private getConfigPathValue (root: any, configPath: string): any {
        let current = root
        for (const segment of configPath.split('.')) {
            if (!current || typeof current !== 'object' || !(segment in current)) {
                return MISSING_CONFIG_VALUE
            }
            current = current[segment]
        }
        return current
    }

    private setConfigPathValue (root: any, configPath: string, value: any): void {
        const segments = configPath.split('.')
        let current = root
        for (const segment of segments.slice(0, -1)) {
            if (!current[segment] || typeof current[segment] !== 'object' || current[segment] instanceof Array) {
                current[segment] = {}
            }
            current = current[segment]
        }
        current[segments.at(-1)!] = this.cloneConfigValue(value)
    }

    private deleteConfigPathValue (root: any, configPath: string): void {
        const segments = configPath.split('.')
        let current = root
        for (const segment of segments.slice(0, -1)) {
            if (!current || typeof current !== 'object' || !(segment in current)) {
                return
            }
            current = current[segment]
        }
        if (current && typeof current === 'object') {
            // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
            delete current[segments.at(-1)!]
        }
    }

    private cloneConfigValue (value: any): any {
        if (value === null || typeof value !== 'object') {
            return value
        }
        if (value instanceof Array) {
            return value.map(item => this.cloneConfigValue(item))
        }
        const result: Record<string, any> = {}
        for (const [key, nestedValue] of Object.entries(value)) {
            result[key] = this.cloneConfigValue(nestedValue)
        }
        return result
    }
}
