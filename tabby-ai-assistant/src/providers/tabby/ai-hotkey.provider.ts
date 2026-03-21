import { Injectable } from '@angular/core'
import { HotkeyProvider, HotkeyDescription } from 'tabby-core'

/**
 * Tabby热键提供者
 * 为Tabby添加AI助手热键支持
 *
 * 注意：热键 ID 必须与 AiConfigProvider.defaults.hotkeys 中定义的一致
 */
@Injectable()
export class AiHotkeyProvider extends HotkeyProvider {
    hotkeys: HotkeyDescription[] = [
        {
            id: 'ai-assistant-toggle',
            name: '打开AI助手',
        },
        {
            id: 'ai-command-generation',
            name: '生成命令',
        },
        {
            id: 'ai-explain-command',
            name: '解释命令',
        },
    ]

    async provide(): Promise<HotkeyDescription[]> {
        return this.hotkeys
    }
}
