/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { formatDate } from '@angular/common'
import { Component, HostBinding } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, ConfigService, PromptModalComponent, HostAppService, PlatformService, NotificationsService, TranslateService, LocaleService } from 'tabby-core'
import { Config, ConfigSyncService } from '../services/configSync.service'


/** @hidden */
@Component({
    selector: 'config-sync-settings-tab',
    templateUrl: './configSyncSettingsTab.component.pug',
})
export class ConfigSyncSettingsTabComponent extends BaseComponent {
    connectionSuccessful: boolean|null = null
    connectionError: Error|null = null
    configs: Config[]|null = null

    @HostBinding('class.content-box') true

    constructor (
        public config: ConfigService,
        public platform: PlatformService,
        private configSync: ConfigSyncService,
        private hostApp: HostAppService,
        private ngbModal: NgbModal,
        private notifications: NotificationsService,
        private translate: TranslateService,
        private locale: LocaleService,
    ) {
        super()
    }

    async ngOnInit () {
        await this.testConnection()
        this.loadConfigs()
    }

    async testConnection () {
        if (!this.config.store.configSync.host || !this.config.store.configSync.token) {
            return
        }
        this.connectionSuccessful = null
        try {
            await this.configSync.getUser()
            this.connectionSuccessful = true
            this.loadConfigs()
        } catch (e) {
            this.connectionSuccessful = false
            this.connectionError = e
            this.configs = null
        }
    }

    async loadConfigs () {
        this.configs = await this.configSync.getConfigs()
    }

    async uploadAsNew () {
        let name = this.translate.instant('New config on {platform}', this.hostApp)
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = this.translate.instant('Name for the new config')
        modal.componentInstance.value = name
        name = (await modal.result.catch(() => null))?.value
        if (!name) {
            return
        }
        const cfg = await this.configSync.createNewConfig(name)
        this.loadConfigs()
        this.configSync.setConfig(cfg)
        this.uploadAndSync(cfg)
    }

    async uploadAndSync (cfg: Config) {
        if (this.config.store.configSync.configID !== cfg.id) {
            if ((await this.platform.showMessageBox({
                type: 'warning',
                message: this.translate.instant('Overwrite the config on the remote side and start syncing?'),
                buttons: [
                    this.translate.instant('Overwrite remote and sync'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 1,
                cancelId: 1,
            })).response === 1) {
                return
            }
        }
        this.configSync.setConfig(cfg)
        try {
            await this.configSync.upload()
            this.loadConfigs()
            this.notifications.info(this.translate.instant('Config uploaded'))
        } catch (error) {
            if (this.configSync.isSyncConflictError(error)) {
                const remoteModifiedAt = this.formatConflictDate(error.actualRemoteModifiedAt)
                const localCheckpointAt = this.formatConflictDate(error.expectedRemoteModifiedAt)
                const response = (await this.platform.showMessageBox({
                    type: 'warning',
                    message: this.translate.instant('Sync conflict detected'),
                    detail: this.translate.instant('Remote config "{name}" (ID: {id}) was modified on {remoteDate}.\nLocal sync checkpoint: {localDate}.\n\nChoose how to proceed:\n- Overwrite remote and sync local config\n- Download remote and sync local config\n- Cancel', {
                        name: error.remoteConfig.name || this.translate.instant('Unnamed config'),
                        id: error.remoteConfig.id,
                        remoteDate: remoteModifiedAt,
                        localDate: localCheckpointAt,
                    }),
                    buttons: [
                        this.translate.instant('Overwrite remote and sync'),
                        this.translate.instant('Download remote and sync'),
                        this.translate.instant('Cancel'),
                    ],
                    defaultId: 2,
                    cancelId: 2,
                })).response
                if (response === 0) {
                    await this.configSync.upload(error.remoteConfig, {
                        expectedRemoteModifiedAt: error.actualRemoteModifiedAt,
                    })
                    this.loadConfigs()
                    this.notifications.info(this.translate.instant('Config uploaded'))
                    return
                }
                if (response === 1) {
                    await this.configSync.download(error.remoteConfig)
                    this.loadConfigs()
                    this.notifications.info(this.translate.instant('Config downloaded'))
                    return
                }
                this.loadConfigs()
                return
            }
            const details = error instanceof Error ? error.message : undefined
            this.notifications.error(this.translate.instant('Config upload failed'), details)
        }
    }

    private formatConflictDate (value: Date|string): string {
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) {
            return this.translate.instant('Unknown date')
        }
        return formatDate(date, 'medium', this.locale.getLocale())
    }

    async downloadAndSync (cfg: Config) {
        if ((await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Overwrite the local config and start syncing?'),
            buttons: [
                this.translate.instant('Overwrite local and sync'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 1) {
            return
        }
        this.configSync.setConfig(cfg)
        await this.configSync.download()
        this.notifications.info(this.translate.instant('Config downloaded'))
    }

    async delete (cfg: Config) {
        if ((await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Delete the config on the remote side?'),
            buttons: [
                this.translate.instant('Delete'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })).response === 1) {
            return
        }
        await this.configSync.delete(cfg)
        this.loadConfigs()
        this.notifications.info(this.translate.instant('Config deleted'))
    }

    hasMatchingRemoteConfig () {
        return !!this.configs?.find(c => this.isActiveConfig(c))
    }

    isActiveConfig (c: Config) {
        return c.id === this.config.store.configSync.configID
    }

    openSyncHost () {
        if (this.config.store.configSync.host === 'https://api.tabby.sh') {
            this.platform.openExternal('https://app.tabby.sh')
        } else {
            this.platform.openExternal(this.config.store.configSync.host)
        }
    }

    openTabbyWebInfo () {
        this.platform.openExternal('https://github.com/Eugeny/tabby-web')
    }

}
