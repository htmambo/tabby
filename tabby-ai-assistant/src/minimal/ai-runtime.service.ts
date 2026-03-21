import { Injectable } from '@angular/core'
import { Subscription, lastValueFrom } from 'rxjs'
import { AppService, ConfigService, HotkeysService } from 'tabby-core'
import { AiAssistantLazyLoaderService } from './ai-lazy-loader.service'

@Injectable({ providedIn: 'root' })
export class AiAssistantMinimalRuntimeService {
    private initialized = false
    private readySubscription: Subscription | null = null
    private hotkeySubscription: Subscription | null = null

    constructor (
        private app: AppService,
        private config: ConfigService,
        private hotkeys: HotkeysService,
        private lazyLoader: AiAssistantLazyLoaderService,
    ) { }

    init (): void {
        if (this.initialized) {
            return
        }
        this.initialized = true

        this.readySubscription = this.app.ready$.subscribe(() => {
            void this.restoreSidebarIfNeeded()
        })

        this.hotkeySubscription = this.hotkeys.hotkey$.subscribe(hotkey => {
            void this.handleHotkey(hotkey)
        })
    }

    private async restoreSidebarIfNeeded (): Promise<void> {
        try {
            await lastValueFrom(this.config.ready$)
            if (this.config.store.pluginConfig?.['ai-assistant']?.sidebarVisible !== true) {
                return
            }
            const sidebarService = await this.lazyLoader.getSidebarService()
            sidebarService.initialize()
        } catch (error) {
            console.error('Failed to restore deferred AI Assistant sidebar', error)
        }
    }

    private async handleHotkey (hotkey: string): Promise<void> {
        try {
            switch (hotkey) {
                case 'ai-assistant-toggle':
                    (await this.lazyLoader.getSidebarService()).toggle()
                    return
                case 'ai-command-generation':
                    await this.handleCommandGeneration()
                    return
                case 'ai-explain-command':
                    await this.handleExplainCommand()
                    return
            }
        } catch (error) {
            console.error(`Failed to handle deferred AI Assistant hotkey: ${hotkey}`, error)
        }
    }

    private async handleCommandGeneration (): Promise<void> {
        const [sidebarService, terminalManager] = await Promise.all([
            this.lazyLoader.getSidebarService(),
            this.lazyLoader.getTerminalManagerService(),
        ])

        const selectedText = terminalManager.getSelectedText()
        const lastCommand = terminalManager.getLastCommand()
        const context = terminalManager.getRecentContext()

        let prompt = ''
        if (selectedText) {
            prompt = `请帮我优化或改进这个命令：\n\`\`\`\n${selectedText}\n\`\`\``
        } else if (lastCommand) {
            prompt = `基于当前终端状态，请帮我生成下一步需要的命令。\n\n最近执行的命令: ${lastCommand}\n\n终端上下文:\n\`\`\`\n${context}\n\`\`\``
        } else {
            prompt = `请根据当前终端状态帮我生成需要的命令。\n\n终端上下文:\n\`\`\`\n${context}\n\`\`\``
        }

        sidebarService.sendPresetMessage(prompt, true)
    }

    private async handleExplainCommand (): Promise<void> {
        const [sidebarService, terminalManager] = await Promise.all([
            this.lazyLoader.getSidebarService(),
            this.lazyLoader.getTerminalManagerService(),
        ])

        const selectedText = terminalManager.getSelectedText()
        const lastCommand = terminalManager.getLastCommand()

        let prompt = ''
        if (selectedText) {
            prompt = `请详细解释这个命令的作用和每个参数的含义：\n\`\`\`\n${selectedText}\n\`\`\``
        } else if (lastCommand) {
            prompt = `请详细解释这个命令的作用和每个参数的含义：\n\`\`\`\n${lastCommand}\n\`\`\``
        } else {
            const context = terminalManager.getRecentContext()
            prompt = `请解释最近的终端输出内容：\n\`\`\`\n${context}\n\`\`\``
        }

        sidebarService.sendPresetMessage(prompt, true)
    }
}
