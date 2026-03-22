import { Injectable } from '@angular/core'
import { SettingsTabProvider, TranslateService } from 'tabby-core'

@Injectable()
export class HotkeyMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'hotkeys'
    icon = 'keyboard'
    title = this.translate.instant('Hotkeys')

    constructor (private translate: TranslateService) { super() }
}

@Injectable()
export class WindowMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'window'
    icon = 'window-maximize'
    title = this.translate.instant('Window')

    constructor (private translate: TranslateService) { super() }
}

@Injectable()
export class VaultMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'vault'
    icon = 'key'
    title = 'Vault'
}

@Injectable()
export class ProfilesMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'profiles'
    icon = 'window-restore'
    title = this.translate.instant('Profiles & connections')
    prioritized = true

    constructor (private translate: TranslateService) { super() }
}

@Injectable()
export class ConfigSyncMinimalSettingsTabProvider extends SettingsTabProvider {
    id = 'config-sync'
    icon = 'cloud'
    title = this.translate.instant('Config sync')

    constructor (private translate: TranslateService) { super() }
}
