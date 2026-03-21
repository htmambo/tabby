/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { debounce } from 'utils-decorators/dist/esm/debounce/debounce'
import { Component, Inject, Input, HostBinding, Injector, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core'
import {
    ConfigService,
    BaseTabComponent,
    HostAppService,
    Platform,
    HomeBaseService,
    UpdaterService,
    PlatformService,
    HostWindowService,
    AppService,
    LocaleService,
    TranslateService,
} from 'tabby-core'

import { SettingsTabProvider } from '../api'
import { ReleaseNotesComponent } from './releaseNotesTab.component'

/** @hidden */
@Component({
    standalone: false,
    selector: 'settings-tab',
    templateUrl: './settingsTab.component.pug',
    styleUrls: [
        './settingsTab.component.scss',
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsTabComponent extends BaseTabComponent {
    @Input() activeTab: string
    Platform = Platform
    configDefaults = ''
    configFile: string
    /** 缓存的配置文件有效性，避免模板每次调用时重新解析 YAML */
    configFileValid = true
    configFileValidationPending = false
    isShellIntegrationInstalled = false
    checkingForUpdate = false
    updateAvailable = false
    showConfigDefaults = false
    allLanguages = LocaleService.allLanguages
    @HostBinding('class.pad-window-controls') padWindowControls = false
    private yamlModulePromise: Promise<any> | null = null
    private configFileValidationToken = 0

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        public hostWindow: HostWindowService,
        public homeBase: HomeBaseService,
        public platform: PlatformService,
        public locale: LocaleService,
        public updater: UpdaterService,
        private app: AppService,
        @Inject(SettingsTabProvider) public settingsProviders: SettingsTabProvider[],
        translate: TranslateService,
        injector: Injector,
        private cdr: ChangeDetectorRef,
    ) {
        super(injector)
        this.setTitle(translate.instant(_('Settings')))
        this.settingsProviders = config.enabledServices(this.settingsProviders)
        this.settingsProviders = this.settingsProviders.filter(x => !!x.getComponentType())
        this.settingsProviders.sort((a, b) => a.weight - b.weight + a.title.localeCompare(b.title))

        // 只在需要时更新 configFile（例如查看 Config file 标签页时）
        // 避免每次配置变更都进行全量序列化
        this.subscribeUntilDestroyed(config.changed$, () => {
            // 只在当前显示 Config file 标签页时才重新读取
            if (this.activeTab === 'config-file') {
                this.configFile = config.readRaw()
                this.configFileValid = true // 外部变更后的配置文件一定是有效的
                this.configFileValidationPending = false
                if (this.showConfigDefaults) {
                    void this.ensureConfigDefaultsLoaded()
                }
            }
        })

        const onConfigChange = () => {
            this.padWindowControls = hostApp.platform === Platform.macOS
                && config.store.appearance.tabsLocation !== 'top'
        }

        this.subscribeUntilDestroyed(config.changed$, onConfigChange)
        // 初始化时读取一次
        this.configFile = config.readRaw()
        onConfigChange()
    }

    async ngOnInit () {
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
        if (this.activeTab === 'config-file') {
            await this.activateConfigFileTab()
        }
    }

    async toggleShellIntegration () {
        if (!this.isShellIntegrationInstalled) {
            await this.platform.installShellIntegration()
        } else {
            await this.platform.uninstallShellIntegration()
        }
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
    }

    ngOnDestroy () {
        this.config.save()
    }

    restartApp () {
        this.hostApp.relaunch()
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }

    saveConfigFile () {
        if (!this.configFileValidationPending && this.isConfigFileValid()) {
            this.config.writeRaw(this.configFile)
        }
    }

    showConfigFile () {
        this.platform.showItemInFolder(this.platform.getConfigPath()!)
    }

    /**
     * 更新配置文件有效性缓存
     * 在 configFile 变化时调用，避免模板热路径重复解析 YAML
     */
    onConfigFileChange () {
        void this.validateConfigFile()
    }

    onActiveTabChange (activeTab: string): void {
        this.activeTab = activeTab
        if (activeTab === 'config-file') {
            void this.activateConfigFileTab()
        }
    }

    toggleConfigDefaults (): void {
        this.showConfigDefaults = !this.showConfigDefaults
        if (this.showConfigDefaults) {
            void this.ensureConfigDefaultsLoaded()
        }
    }

    private async activateConfigFileTab (): Promise<void> {
        await this.validateConfigFile()
    }

    private async validateConfigFile (): Promise<void> {
        const validationToken = ++this.configFileValidationToken
        this.configFileValidationPending = true
        this.cdr.markForCheck()
        const content = this.configFile
        try {
            const yaml = await this.getYaml()
            if (validationToken !== this.configFileValidationToken) {
                return
            }
            yaml.load(content)
            this.configFileValid = true
        } catch {
            if (validationToken !== this.configFileValidationToken) {
                return
            }
            this.configFileValid = false
        } finally {
            if (validationToken === this.configFileValidationToken) {
                this.configFileValidationPending = false
                this.cdr.markForCheck()
            }
        }
    }

    private async ensureConfigDefaultsLoaded (): Promise<void> {
        if (this.configDefaults) {
            return
        }
        const yaml = await this.getYaml()
        this.configDefaults = yaml.dump(this.config.getDefaults())
        this.cdr.markForCheck()
    }

    private async getYaml (): Promise<any> {
        this.yamlModulePromise ??= import('js-yaml')
        return this.yamlModulePromise
    }

    /**
     * @deprecated 使用 configFileValid 属性代替
     * 保留此方法以兼容可能的外部调用
     */
    isConfigFileValid () {
        return this.configFileValid
    }

    async checkForUpdates () {
        this.checkingForUpdate = true
        try {
            this.updateAvailable = await this.updater.check()
        } catch {
            this.updateAvailable = false
        }
        this.checkingForUpdate = false
    }

    showReleaseNotes () {
        this.app.openNewTabRaw({
            type: ReleaseNotesComponent,
        })
    }
}
