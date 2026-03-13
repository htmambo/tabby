import { Component, Output, EventEmitter, Input, ViewChild, ElementRef, OnInit, OnDestroy, ViewEncapsulation } from '@angular/core'
import { Subject } from 'rxjs'
import { debounceTime, takeUntil } from 'rxjs/operators'
import { ConfigProviderService } from '../../services/core/config-provider.service'
import { AiAssistantService } from '../../services/core/ai-assistant.service'
import { TranslateService } from 'tabby-core'

@Component({
    selector: 'app-chat-input',
    standalone: false,
    templateUrl: './chat-input.component.html',
    styleUrls: ['./chat-input.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class ChatInputComponent implements OnInit, OnDestroy {
    @Input() disabled = false
    @Input() placeholder = ''
    @Output() send = new EventEmitter<string>()

    @ViewChild('textInput', { 'static': false }) textInput!: ElementRef<HTMLTextAreaElement>

    inputValue = ''
    private inputSubject = new Subject<string>()
    private destroy$ = new Subject<void>()
    isComposing = false // 用于处理中文输入法
    enterToSend = true // Enter键发送

    // 输入历史相关
    private inputHistory: string[] = []
    private historyIndex = -1
    private tempInput = ''
    private readonly maxHistory = 50

    // 智能建议相关
    suggestions: string[] = []
    showSuggestions = false

    constructor(
        private config: ConfigProviderService,
        private aiService: AiAssistantService,
        private translate: TranslateService,
    ) {
        this.placeholder = this.translate.instant('Enter your question or describe the command you want to execute...')
    }

    ngOnInit(): void {
        // 读取 Enter 发送设置
        this.enterToSend = this.config.get<boolean>('ui.enterToSend', true) ?? true

        // 监听输入变化，实现防抖
        this.inputSubject.pipe(
            debounceTime(300),
            takeUntil(this.destroy$),
        ).subscribe(value => {
            this.onInputChange(value)
        })
    }

    ngOnDestroy(): void {
        this.destroy$.next()
        this.destroy$.complete()
    }

    /**
     * 处理输入变化
     * 实现智能建议功能
     */
    async onInputChange(value: string): Promise<void> {
        if (value.length < 2) {
            this.suggestions = []
            this.showSuggestions = false
            return
        }

        // 调用已实现的智能建议服务
        this.suggestions = await this.aiService.getSuggestedCommands(value)
        this.showSuggestions = this.suggestions.length > 0
    }

    /**
     * 选择建议
     */
    selectSuggestion(suggestion: string): void {
        this.inputValue = suggestion
        this.showSuggestions = false
        this.focus()
    }

    /**
     * 关闭建议
     */
    dismissSuggestions(): void {
        this.showSuggestions = false
    }

    /**
     * 处理键盘事件
     */
    onKeydown(event: KeyboardEvent): void {
        if (this.isComposing) {
            return
        }

        // Enter 发送（根据配置决定）
        if (event.key === 'Enter' && !event.shiftKey) {
            if (this.enterToSend) {
                event.preventDefault()
                this.submit()
            }
            return
        }

        // ArrowUp / ArrowDown 切换输入历史
        if (this.inputHistory.length === 0) {
            return
        }
        if (event.key === 'ArrowUp' && this.isCursorOnFirstLine()) {
            event.preventDefault()
            this.navigateHistory(-1)
        } else if (event.key === 'ArrowDown' && this.isCursorOnLastLine()) {
            event.preventDefault()
            this.navigateHistory(1)
        }
    }

    /**
     * 处理输入事件
     */
    onInput(event: Event): void {
        const target = event.target as HTMLTextAreaElement
        this.inputValue = target.value
        this.inputSubject.next(this.inputValue)
        this.autoResize()
    }

    /**
     * 处理composition开始（输入法）
     */
    onCompositionStart(): void {
        this.isComposing = true
    }

    /**
     * 处理composition结束（输入法）
     */
    onCompositionEnd(): void {
        this.isComposing = false
        this.autoResize()
    }

    /**
     * 提交消息
     */
    submit(): void {
        const message = this.inputValue.trim()
        if (message && !this.disabled) {
            // 记录到输入历史（避免连续重复）
            if (this.inputHistory[0] !== message) {
                this.inputHistory.unshift(message)
                if (this.inputHistory.length > this.maxHistory) {
                    this.inputHistory.pop()
                }
            }
            this.historyIndex = -1
            this.tempInput = ''

            this.send.emit(message)
            this.inputValue = ''
            setTimeout(() => this.autoResize(), 0)
            this.textInput?.nativeElement.focus()
        }
    }

    /**
     * 清空输入
     */
    clear(): void {
        this.inputValue = ''
        this.autoResize()
        this.textInput?.nativeElement.focus()
    }

    /**
     * 自动调整高度
     */
    private autoResize(): void {
        if (this.textInput?.nativeElement) {
            const textarea = this.textInput.nativeElement
            textarea.style.height = 'auto'
            textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
        }
    }

    /**
     * 获取字符计数
     */
    getCharCount(): number {
        return this.inputValue.length
    }

    /**
     * 获取字符限制
     */
    getCharLimit(): number {
        return 4000 // 4K字符限制
    }

    /**
     * 检查是否接近限制
     */
    isNearLimit(): boolean {
        return this.getCharCount() > this.getCharLimit() * 0.8
    }

    /**
     * 检查是否超过限制
     */
    isOverLimit(): boolean {
        return this.getCharCount() > this.getCharLimit()
    }

    /**
     * 判断光标是否在第一行
     */
    private isCursorOnFirstLine(): boolean {
        const textarea = this.textInput?.nativeElement
        if (!textarea) {
            return true
        }
        const pos = textarea.selectionStart
        return !textarea.value.substring(0, pos).includes('\n')
    }

    /**
     * 判断光标是否在最后一行
     */
    private isCursorOnLastLine(): boolean {
        const textarea = this.textInput?.nativeElement
        if (!textarea) {
            return true
        }
        const pos = textarea.selectionStart
        return !textarea.value.substring(pos).includes('\n')
    }

    /**
     * 在输入历史中导航
     * direction: -1 表示向上翻（更早的记录），1 表示向下翻（更近的记录）
     */
    private navigateHistory(direction: number): void {
        const newIndex = this.historyIndex + (direction === -1 ? 1 : -1)

        // 向上翻到顶
        if (newIndex >= this.inputHistory.length) {
            return
        }

        // 首次进入历史时，暂存当前输入
        if (this.historyIndex === -1 && direction === -1) {
            this.tempInput = this.inputValue
        }

        this.historyIndex = newIndex

        if (this.historyIndex < 0) {
            this.historyIndex = -1
            this.inputValue = this.tempInput
        } else {
            this.inputValue = this.inputHistory[this.historyIndex]
        }

        // 同步 textarea 原生值并将光标移至末尾
        const textarea = this.textInput?.nativeElement
        if (textarea) {
            textarea.value = this.inputValue
            setTimeout(() => {
                textarea.selectionStart = textarea.selectionEnd = this.inputValue.length
                this.autoResize()
            }, 0)
        }
    }

    /**
     * 聚焦输入框
     */
    focus(): void {
        this.textInput?.nativeElement.focus()
    }
}
