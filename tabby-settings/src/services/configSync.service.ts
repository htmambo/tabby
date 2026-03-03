import * as yaml from 'js-yaml'
import axios from 'axios'
import { Injectable } from '@angular/core'
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

@Injectable({ providedIn: 'root' })
export class ConfigSyncService {
    private logger: Logger
    private lastRemoteChange = new Date(0)
    private lastSyncedLocalFingerprint: string|null = null
    private internalConfigWriteInProgress = false
    private autoSyncLocalChangeInProgress = false

    constructor (
        log: LogService,
        private platform: PlatformService,
        private hostApp: HostAppService,
        private config: ConfigService,
    ) {
        this.logger = log.create('configSync')
        config.ready$.toPromise().then(async () => {
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
        const data = yaml.load(await this.platform.loadConfig()) as any
        delete data.configSync
        return data
    }

    private async writeConfigDataFromSync (data: any) {
        this.internalConfigWriteInProgress = true
        try {
            await this.platform.saveConfig(yaml.dump(data))
            await this.config.load()
            await this.config.save()
        } finally {
            this.internalConfigWriteInProgress = false
        }
    }

    private async request (method: 'GET'|'POST'|'PATCH'|'DELETE', url: string, params = {}) {
        if (this.config.store.configSync.host.endsWith('/')) {
            this.config.store.configSync.host = this.config.store.configSync.host.slice(0, -1)
        }
        url = this.config.store.configSync.host + url
        this.logger.debug(`${method} ${url}`, params)
        try {
            const response = await axios.request({
                url,
                method,
                headers: {
                    Authorization: `Bearer ${this.config.store.configSync.token}`,
                },
                ...params,
            })
            this.logger.debug(response)
            return response.data
        } catch (error) {
            this.logger.error(error)
            throw error
        }
    }

    private async autoSync () {
        while (true) {
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
            await new Promise(resolve => setTimeout(resolve, 60000))
        }
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
}
