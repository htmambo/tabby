import { Injector, NgModule } from '@angular/core'
import { PlatformService, LogService, UpdaterService, DockingService, HostAppService, ThemesService, Platform, AppService, ConfigService, WIN_BUILD_FLUENT_BG_SUPPORTED, isWindowsBuild, HostWindowService, HotkeyProvider, ConfigProvider, FileProvider, TabbyPluginManifest } from 'tabby-core'
import { TerminalColorSchemeProvider, TerminalDecorator } from 'tabby-terminal'
import { SFTPContextMenuItemProvider, SSHProfileImporter, AutoPrivateKeyLocator } from 'tabby-ssh'
import { PTYInterface, ShellProvider, UACService } from 'tabby-local'
import { auditTime, lastValueFrom } from 'rxjs'

import { HyperColorSchemes } from './colorSchemes'
import { ElectronPlatformService } from './services/platform.service'
import { ElectronLogService } from './services/log.service'
import { ElectronUpdaterService } from './services/updater.service'
import { TouchbarService } from './services/touchbar.service'
import { ElectronDockingService } from './services/docking.service'
import { ElectronHostWindow } from './services/hostWindow.service'
import { ElectronFileProvider } from './services/fileProvider.service'
import { ElectronHostAppService } from './services/hostApp.service'
import { ElectronService } from './services/electron.service'
import { DockMenuService } from './services/dockMenu.service'
import { ElectronUACService } from './services/uac.service'

import { ElectronHotkeyProvider } from './hotkeys'
import { ElectronConfigProvider } from './config'
import { EditSFTPContextMenu } from './sftpContextMenu'
import { OpenSSHImporter, PrivateKeyLocator, StaticFileImporter } from './sshImporters'
import { ElectronPTYInterface } from './pty'
import { PathDropDecorator } from './pathDrop'

import { CmderShellProvider } from './shells/cmder'
import { Cygwin32ShellProvider } from './shells/cygwin32'
import { Cygwin64ShellProvider } from './shells/cygwin64'
import { GitBashShellProvider } from './shells/gitBash'
import { LinuxDefaultShellProvider } from './shells/linuxDefault'
import { MacOSDefaultShellProvider } from './shells/macDefault'
import { MSYS2ShellProvider } from './shells/msys2'
import { POSIXShellsProvider } from './shells/posix'
import { PowerShellCoreShellProvider } from './shells/powershellCore'
import { WindowsDefaultShellProvider } from './shells/winDefault'
import { WindowsStockShellsProvider } from './shells/windowsStock'
import { WSLShellProvider } from './shells/wsl'
import { VSDevToolsProvider } from './shells/vs'

const PROVIDERS = [
    { provide: TerminalColorSchemeProvider, useClass: HyperColorSchemes, multi: true },
    { provide: PlatformService, useExisting: ElectronPlatformService },
    { provide: HostWindowService, useExisting: ElectronHostWindow },
    { provide: HostAppService, useExisting: ElectronHostAppService },
    { provide: LogService, useClass: ElectronLogService },
    { provide: UpdaterService, useClass: ElectronUpdaterService },
    { provide: DockingService, useClass: ElectronDockingService },
    { provide: HotkeyProvider, useClass: ElectronHotkeyProvider, multi: true },
    { provide: ConfigProvider, useClass: ElectronConfigProvider, multi: true },
    { provide: FileProvider, useClass: ElectronFileProvider, multi: true },
    { provide: SFTPContextMenuItemProvider, useClass: EditSFTPContextMenu, multi: true },
    { provide: SSHProfileImporter, useExisting: OpenSSHImporter, multi: true },
    { provide: SSHProfileImporter, useExisting: StaticFileImporter, multi: true },
    { provide: AutoPrivateKeyLocator, useExisting: PrivateKeyLocator, multi: true },

    { provide: ShellProvider, useClass: WindowsDefaultShellProvider, multi: true },
    { provide: ShellProvider, useClass: MacOSDefaultShellProvider, multi: true },
    { provide: ShellProvider, useClass: LinuxDefaultShellProvider, multi: true },
    { provide: ShellProvider, useClass: WindowsStockShellsProvider, multi: true },
    { provide: ShellProvider, useClass: PowerShellCoreShellProvider, multi: true },
    { provide: ShellProvider, useClass: CmderShellProvider, multi: true },
    { provide: ShellProvider, useClass: Cygwin32ShellProvider, multi: true },
    { provide: ShellProvider, useClass: Cygwin64ShellProvider, multi: true },
    { provide: ShellProvider, useClass: GitBashShellProvider, multi: true },
    { provide: ShellProvider, useClass: POSIXShellsProvider, multi: true },
    { provide: ShellProvider, useClass: MSYS2ShellProvider, multi: true },
    { provide: ShellProvider, useClass: WSLShellProvider, multi: true },
    { provide: ShellProvider, useClass: VSDevToolsProvider, multi: true },

    { provide: UACService, useClass: ElectronUACService },

    { provide: PTYInterface, useClass: ElectronPTYInterface },

    { provide: TerminalDecorator, useClass: PathDropDecorator, multi: true },

    // For WindowsDefaultShellProvider
    PowerShellCoreShellProvider,
    WSLShellProvider,
    WindowsStockShellsProvider,
]

@NgModule({
    providers: PROVIDERS,
})
export default class ElectronModule {
    private touchbarServiceInstance: TouchbarService | null = null
    private dockMenuServiceInstance: DockMenuService | null = null
    private themesServiceInstance: ThemesService | null = null

    constructor (
        private injector: Injector,
        private config: ConfigService,
        private hostApp: ElectronHostAppService,
        private electron: ElectronService,
        private hostWindow: ElectronHostWindow,
        docking: DockingService,
        app: AppService,
    ) {
        const isMacOS = hostApp.platform === Platform.macOS
        const supportsDockMenu = hostApp.platform === Platform.macOS || hostApp.platform === Platform.Windows

        void lastValueFrom(config.ready$).then(() => {
            if (isMacOS) {
                this.touchbarService.update()
            }
            docking.dock()
            hostWindow.windowShown$.subscribe(() => {
                docking.dock()
            })
            this.registerGlobalHotkey()
            this.updateVibrancy()
            this.updateWindowControlsColor()
            if (supportsDockMenu) {
                void this.dockMenuService.update()
            }
        })

        config.changed$.subscribe(() => {
            this.registerGlobalHotkey()
        })

        if (isMacOS) {
            this.themesService.themeChanged$.subscribe(theme => {
                hostWindow.setTrafficLightPosition(
                    theme.macOSWindowButtonsInsetX ?? 14,
                    theme.macOSWindowButtonsInsetY ?? 11,
                )
            })
        }

        let lastProgress: number|null = null
        app.tabOpened$.subscribe(tab => {
            tab.progress$.pipe(auditTime(250)).subscribe(progress => {
                if (lastProgress === progress) {
                    return
                }
                if (progress !== null) {
                    hostWindow.setProgressBar(progress / 100.0)
                } else {
                    hostWindow.setProgressBar(-1)
                }
                lastProgress = progress
            })
        })

        config.changed$.subscribe(() => {
            this.updateVibrancy()
            this.updateDarkMode()
        })

        config.changed$.subscribe(() => this.updateWindowControlsColor())
    }

    private get touchbarService (): TouchbarService {
        this.touchbarServiceInstance ??= this.injector.get(TouchbarService)
        return this.touchbarServiceInstance
    }

    private get dockMenuService (): DockMenuService {
        this.dockMenuServiceInstance ??= this.injector.get(DockMenuService)
        return this.dockMenuServiceInstance
    }

    private get themesService (): ThemesService {
        this.themesServiceInstance ??= this.injector.get(ThemesService)
        return this.themesServiceInstance
    }

    private registerGlobalHotkey () {
        let value = this.config.store.hotkeys['toggle-window'] || []
        if (typeof value === 'string') {
            value = [value]
        }
        const specs: string[] = []
        value.forEach((item: string | string[]) => {
            item = typeof item === 'string' ? [item] : item

            try {
                let electronKeySpec = item[0]
                electronKeySpec = electronKeySpec.replaceAll('Meta', 'Super')
                electronKeySpec = electronKeySpec.replaceAll('⌘', 'Command')
                electronKeySpec = electronKeySpec.replaceAll('⌥', 'Alt')
                electronKeySpec = electronKeySpec.replaceAll('-', '+')
                specs.push(electronKeySpec)
            } catch (err) {
                console.error('Could not register the global hotkey:', err)
            }
        })

        this.electron.ipcRenderer.send('app:register-global-hotkey', specs)
    }

    private updateVibrancy () {
        let vibrancyType = this.config.store.appearance.vibrancyType
        if (this.hostApp.platform === Platform.Windows && !isWindowsBuild(WIN_BUILD_FLUENT_BG_SUPPORTED)) {
            vibrancyType = null
        }
        this.electron.ipcRenderer.send('window-set-vibrancy', this.config.store.appearance.vibrancy, vibrancyType)

        this.hostWindow.setOpacity(this.config.store.appearance.opacity)
    }

    private updateDarkMode () {
        const colorSchemeMode = this.config.store.appearance.colorSchemeMode
        this.electron.ipcRenderer.send('window-set-dark-mode', colorSchemeMode)
    }

    private updateWindowControlsColor () {
        // if windows and not using native frame, WCO does not exist, return.
        if (this.hostApp.platform === Platform.Windows && this.config.store.appearance.frame === 'native') {
            return
        }

        this.electron.ipcRenderer.send('window-set-window-controls-color', this.config.store.terminal.colorScheme)
    }
}

export const manifest: TabbyPluginManifest = {
    name: 'electron',
    providers: PROVIDERS,
}

export { ElectronHostWindow, ElectronHostAppService, ElectronService }
