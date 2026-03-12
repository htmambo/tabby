import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewChecked, ViewEncapsulation } from '@angular/core'
import { Subject } from 'rxjs'
import { takeUntil } from 'rxjs/operators'
import { ChatMessage, MessageRole } from '../../types/ai.types'
import { AiAssistantService } from '../../services/core/ai-assistant.service'
import { ConfigProviderService } from '../../services/core/config-provider.service'
import { LoggerService } from '../../services/core/logger.service'
import { ChatHistoryService } from '../../services/chat/chat-history.service'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { TranslateService } from '../../i18n'
import { ToolStreamProcessorService } from '../../services/tools/tool-stream-processor.service'
import { AnyUIStreamEvent } from '../../services/tools/types/ui-stream-event.types'

@Component({
    selector: 'app-chat-interface',
    standalone: false,
    templateUrl: './chat-interface.component.html',
    styleUrls: ['./chat-interface.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class ChatInterfaceComponent implements OnInit, OnDestroy, AfterViewChecked {
    @ViewChild('chatContainer') chatContainerRef!: ElementRef

    messages: ChatMessage[] = []
    isLoading = false
    currentProvider = ''
    currentSessionId = ''
    showScrollTop = false
    showScrollBottom = false

    // UI 设置（从配置加载）
    showTimestamps = true
    showAvatars = true
    soundEnabled = false
    compactMode = false
    fontSize = 14

    // 翻译对象
    t: any

    private destroy$ = new Subject<void>()
    private shouldScrollToBottom = false
    private activeAiMessageId: string | null = null
    private aiStartScrollPending = false
    private userScrolledDuringResponse = false
    private isUserNearBottom = true
    private readonly AUTO_SCROLL_THRESHOLD = 80
    private scrollRefreshPending = false
    private notificationSound: HTMLAudioElement | null = null

    constructor(
        private aiService: AiAssistantService,
        private config: ConfigProviderService,
        private logger: LoggerService,
        private modal: NgbModal,
        private chatHistory: ChatHistoryService,
        private translate: TranslateService,
        private toolStreamProcessor: ToolStreamProcessorService,
    ) {
        this.t = this.translate.t
    }

    ngOnInit(): void {
        // 监听语言变化
        this.translate.translation$.pipe(
            takeUntil(this.destroy$),
        ).subscribe(translation => {
            this.t = translation
            // 如果有欢迎消息，重新发送以更新语言
            if (this.messages.length > 0 && this.messages[0].role === MessageRole.ASSISTANT) {
                this.sendWelcomeMessage()
            }
        })

        // 生成或加载会话 ID
        this.currentSessionId = this.generateSessionId()

        // 加载 UI 设置
        this.loadUISettings()

        // 加载当前提供商信息
        this.loadCurrentProvider()

        // 加载聊天历史
        this.loadChatHistory()

        // 发送欢迎消息（仅在没有历史记录时）
        if (this.messages.length === 0) {
            this.sendWelcomeMessage()
        }

        // 延迟检查滚动状态（等待 DOM 渲染）
        setTimeout(() => this.checkScrollState(), 100)
    }

    /**
     * 加载 UI 设置
     */
    private loadUISettings(): void {
        this.showTimestamps = this.config.get<boolean>('ui.showTimestamps', true) ?? true
        this.showAvatars = this.config.get<boolean>('ui.showAvatars', true) ?? true
        this.soundEnabled = this.config.get<boolean>('ui.soundEnabled', false) ?? false
        this.compactMode = this.config.get<boolean>('ui.compactMode', false) ?? false
        this.fontSize = this.config.get<number>('ui.fontSize', 14) ?? 14

        // 应用设置
        this.applyStoredSettings()
    }

    /**
     * 应用存储的 UI 设置
     */
    private applyStoredSettings(): void {
        // 应用字体大小
        document.documentElement.style.setProperty('--chat-font-size', `${this.fontSize}px`)

        // 应用紧凑模式
        const container = document.querySelector('.ai-chat-container')
        if (container) {
            if (this.compactMode) {
                container.classList.add('compact-mode')
            } else {
                container.classList.remove('compact-mode')
            }
        }
    }

    ngOnDestroy(): void {
        // 保存当前会话
        this.saveChatHistory()
        this.destroy$.next()
        this.destroy$.complete()
    }

    ngAfterViewChecked(): void {
        if (this.shouldScrollToBottom) {
            this.performScrollToBottom()
            this.shouldScrollToBottom = false
        }
    }

    /**
     * 加载当前提供商信息
     */
    private loadCurrentProvider(): void {
        const defaultProvider = this.config.getDefaultProvider()
        if (defaultProvider) {
            const providerConfig = this.config.getProviderConfig(defaultProvider)
            this.currentProvider = providerConfig?.displayName ?? defaultProvider
        } else {
            // 尝试获取第一个已配置的提供商
            const allConfigs = this.config.getAllProviderConfigs()
            const configuredProviders = Object.keys(allConfigs).filter(k => allConfigs[k]?.apiKey)
            if (configuredProviders.length > 0) {
                const firstProvider = configuredProviders[0]
                const providerConfig = allConfigs[firstProvider]
                this.currentProvider = providerConfig?.displayName ?? firstProvider
                this.config.setDefaultProvider(firstProvider)
            } else {
                this.currentProvider = '未配置'
            }
        }
    }

    /**
     * 加载聊天历史
     */
    private loadChatHistory(): void {
        try {
            // 尝试加载最近的会话
            const recentSessions = this.chatHistory.getRecentSessions(1)
            if (recentSessions.length > 0) {
                const lastSession = recentSessions[0]
                this.currentSessionId = lastSession.sessionId
                this.messages = lastSession.messages.map(msg => ({
                    ...msg,
                    timestamp: new Date(msg.timestamp),
                }))
                this.logger.info('Loaded chat history', {
                    sessionId: this.currentSessionId,
                    messageCount: this.messages.length,
                })
            }
        } catch (error) {
            this.logger.error('Failed to load chat history', error)
            this.messages = []
        }
    }

    /**
     * 发送欢迎消息
     */
    private sendWelcomeMessage(): void {
        const welcomeMessage: ChatMessage = {
            id: this.generateId(),
            role: MessageRole.ASSISTANT,
            content: `${this.t.chatInterface.welcomeMessage}\n\n${this.t.chatInterface.tipCommand}\n\n${this.t.chatInterface.tipShortcut}`,
            timestamp: new Date(),
        }
        this.messages.push(welcomeMessage)
    }

    /**
     * 处理发送消息（使用 Agent 循环模式）
     * 使用 ToolStreamProcessorService 处理所有工具事件
     */
    async onSendMessageWithAgent(content: string): Promise<void> {
        if (!content.trim() || this.isLoading) {
            return
        }

        // 添加用户消息
        const userMessage: ChatMessage = {
            id: this.generateId(),
            role: MessageRole.USER,
            content: content.trim(),
            timestamp: new Date(),
        }
        this.messages.push(userMessage)

        // 滚动到底部
        setTimeout(() => this.scrollToBottom(), 0)

        // 清空输入框
        content = ''

        // 显示加载状态
        this.isLoading = true

        // 创建一个临时的 AI 消息用于流式更新
        const aiMessage: ChatMessage = {
            id: this.generateId(),
            role: MessageRole.ASSISTANT,
            content: '',
            uiBlocks: [],
            timestamp: new Date(),
        }
        this.messages.push(aiMessage)
        this.activeAiMessageId = aiMessage.id
        this.userScrolledDuringResponse = false

        try {
            // 使用 ToolStreamProcessorService 处理流式事件
            this.toolStreamProcessor.startAgentStream({
                messages: this.messages.slice(0, -1),
                maxTokens: 2000,
                temperature: 0.7,
            }, {
                maxRounds: 5,
            }).pipe(
                takeUntil(this.destroy$),
            ).subscribe({
                next: (event: AnyUIStreamEvent) => this.renderUIEvent(event, aiMessage),
                error: (error) => this.handleStreamError(error, aiMessage),
                complete: () => this.handleStreamComplete(),
            })

        } catch (error) {
            this.logger.error('Failed to send message with agent', error)
            aiMessage.content = `${this.t.chatInterface.errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}\n\n${this.t.chatInterface.tipShortcut}`
            this.isLoading = false
            setTimeout(() => this.scrollToBottom(), 0)
        }
    }

    /**
     * 渲染 UI 事件 - 纯渲染逻辑
     */
    private renderUIEvent(event: AnyUIStreamEvent, message: ChatMessage): void {
        if (!message.uiBlocks) {
            message.uiBlocks = []
        }

        switch (event.type) {
            case 'text':
                message.content += event.content
                break

            case 'tool_start':
                message.uiBlocks.push({
                    type: 'tool',
                    id: event.toolId,
                    name: event.toolDisplayName,
                    icon: event.toolIcon,
                    status: 'executing',
                })
                break

            case 'tool_complete':
                const block = message.uiBlocks.find(b => b.id === event.toolId)
                if (block) {
                    block.status = event.success ? 'success' : 'error'
                    block.duration = event.duration
                    block.output = event.output
                }
                break

            case 'tool_error':
                const errorBlock = message.uiBlocks.find(b => b.id === event.toolId)
                if (errorBlock) {
                    errorBlock.status = 'error'
                    errorBlock.errorMessage = event.errorMessage
                }
                break

            case 'round_divider':
                message.uiBlocks.push({
                    type: 'divider',
                    round: event.roundNumber,
                })
                break

            case 'round_end':
                // 轮次结束，无需新增内容
                this.scheduleScrollRefresh()
                break

            case 'agent_done':
                message.uiBlocks.push({
                    type: 'status',
                    icon: event.reasonIcon,
                    text: event.reasonText,
                    rounds: event.totalRounds,
                })
                this.scheduleScrollToAiMessageStart()
                this.scheduleScrollRefresh()
                break

            case 'task_summary':
            case 'async_task':
                break

            case 'error':
                message.content += `\n\n❌ ${this.t.chatInterface.errorPrefix}: ${event.error}`
                break
        }

        const shouldForceScroll = event.type !== 'round_end'
        if (shouldForceScroll) {
            this.shouldScrollToBottom = true
        }
    }

    /**
     * 处理流错误
     */
    private handleStreamError(error: any, message: ChatMessage): void {
        this.logger.error('Agent stream error', error)
        message.content += `\n\n❌ ${this.t.chatInterface.errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}`
        this.isLoading = false
        this.shouldScrollToBottom = true
        this.scheduleScrollToAiMessageStart()
        this.saveChatHistory()
    }

    /**
     * 处理流完成
     */
    private handleStreamComplete(): void {
        this.isLoading = false
        this.saveChatHistory()
        this.shouldScrollToBottom = true
        this.scheduleScrollToAiMessageStart()
    }

    /**
     * 处理发送消息（原有方法，保留兼容性）
     */
    async onSendMessage(content: string): Promise<void> {
        if (!content.trim() || this.isLoading) {
            return
        }

        // 添加用户消息
        const userMessage: ChatMessage = {
            id: this.generateId(),
            role: MessageRole.USER,
            content: content.trim(),
            timestamp: new Date(),
        }
        this.messages.push(userMessage)

        // 滚动到底部
        setTimeout(() => this.scrollToBottom(), 0)

        // 清空输入框
        content = ''

        // 显示加载状态
        this.isLoading = true

        // 创建一个临时的 AI 消息用于流式更新
        const aiMessage: ChatMessage = {
            id: this.generateId(),
            role: MessageRole.ASSISTANT,
            content: '',  // 初始为空
            uiBlocks: [],
            timestamp: new Date(),
        }
        this.messages.push(aiMessage)
        this.activeAiMessageId = aiMessage.id
        this.userScrolledDuringResponse = false

        // 工具调用状态跟踪
        const pendingToolCalls: Map<string, { name: string; startTime: number }> = new Map()

        try {
            // 使用流式 API
            this.aiService.chatStream({
                messages: this.messages.slice(0, -1),  // 排除刚添加的空 AI 消息
                maxTokens: 1000,
                temperature: 0.7,
            }).pipe(
                takeUntil(this.destroy$),
            ).subscribe({
                next: (event) => {
                    // 文本增量 - 逐字显示
                    if (event.type === 'text_delta' && event.textDelta) {
                        aiMessage.content += event.textDelta
                        this.shouldScrollToBottom = true
                    } else if (event.type === 'tool_use_start') {
                        // 工具调用开始 - 显示提示
                        const toolName = event.toolCall?.name ? ` (${event.toolCall.name})` : ''
                        aiMessage.content += `\n\n🔧 ${this.t.chatInterface.executingTool}${toolName}...`

                        // 记录待执行的工具
                        if (event.toolCall?.id) {
                            pendingToolCalls.set(event.toolCall.id, {
                                name: event.toolCall.name ?? 'unknown',
                                startTime: Date.now(),
                            })
                        }
                        this.shouldScrollToBottom = true
                    } else if (event.type === 'tool_use_end') {
                        // 工具调用完成 - 更新状态
                        if (event.toolCall) {
                            const toolInfo = pendingToolCalls.get(event.toolCall.id)
                            const toolName = toolInfo?.name ?? event.toolCall.name ?? 'unknown'

                            // 替换等待提示为完成状态
                            aiMessage.content = aiMessage.content.replace(
                                /🔧 正在执行工具.*?\.\.\./g,
                                `✅ ${toolName} 完成`,
                            )

                            pendingToolCalls.delete(event.toolCall.id)
                        }
                        this.shouldScrollToBottom = true
                    } else if (event.type === 'tool_result' && event.result) {
                        // 工具结果 - 追加到消息
                        const isError = event.result.is_error
                        const icon = isError ? '❌' : '📋'
                        const header = isError ? '**工具执行失败**' : '**工具输出**'

                        // 截断过长的结果
                        const maxPreviewLength = 800
                        let resultPreview = event.result.content
                        const isTruncated = resultPreview.length > maxPreviewLength
                        if (isTruncated) {
                            resultPreview = resultPreview.substring(0, maxPreviewLength) + '\n...(已截断)'
                        }

                        // 格式化工具结果
                        const formattedResult = `\n\n${icon} ${header}:\n\`\`\`\n${resultPreview}\n\`\`\``
                        aiMessage.content += formattedResult
                        this.shouldScrollToBottom = true
                    } else if (event.type === 'tool_error' && event.error) {
                        // 工具错误
                        aiMessage.content = aiMessage.content.replace(
                            /🔧 正在执行工具.*?\.\.\./g,
                            `❌ 工具执行失败: ${event.error}`,
                        )
                        this.shouldScrollToBottom = true
                    } else if (event.type === 'message_end') {
                        // 消息结束
                        this.logger.info('Stream completed')
                        this.playNotificationSound()
                        this.shouldScrollToBottom = true
                        this.scheduleScrollRefresh()
                    }
                },
                error: (error) => {
                    this.logger.error('Stream error', error)
                    aiMessage.content += `\n\n${this.t.chatInterface.errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}`
                    this.isLoading = false
                    this.shouldScrollToBottom = true
                    this.scheduleScrollRefresh()
                    this.saveChatHistory()
                },
                complete: () => {
                    this.isLoading = false
                    this.saveChatHistory()
                    this.shouldScrollToBottom = true
                    this.scheduleScrollRefresh()
                },
            })

        } catch (error) {
            this.logger.error('Failed to send message', error)

            // 添加错误消息
            const errorMessage: ChatMessage = {
                id: this.generateId(),
                role: MessageRole.ASSISTANT,
                content: `${this.t.chatInterface.errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}\n\n${this.t.chatInterface.tipShortcut}`,
                timestamp: new Date(),
            }
            this.messages.push(errorMessage)
            this.isLoading = false
            setTimeout(() => this.scrollToBottom(), 0)
        }
    }

    /**
     * 清空聊天记录
     */
    clearChat(): void {
        if (confirm(this.t.chatInterface.clearChatConfirm)) {
            // 删除当前会话
            if (this.currentSessionId) {
                this.chatHistory.deleteSession(this.currentSessionId)
            }
            // 创建新会话
            this.currentSessionId = this.generateSessionId()
            this.messages = []
            this.sendWelcomeMessage()

            // 确保重置加载状态
            this.isLoading = false

            // 延迟滚动和恢复焦点，确保DOM已更新
            setTimeout(() => {
                this.scrollToBottom()
                // 尝试恢复输入框焦点
                const inputElement = document.querySelector<HTMLTextAreaElement>('.chat-textarea')
                inputElement?.focus()
            }, 100)

            this.logger.info('Chat cleared, new session created', { sessionId: this.currentSessionId })
        }
    }

    /**
     * 导出聊天记录
     */
    exportChat(): void {
        const chatData = {
            provider: this.currentProvider,
            exportTime: new Date().toISOString(),
            messages: this.messages,
        }

        const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' })
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `ai-chat-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        window.URL.revokeObjectURL(url)
    }

    /**
     * 切换提供商
     */
    async switchProvider(): Promise<void> {
        // 从配置服务获取已配置的提供商
        const allConfigs = this.config.getAllProviderConfigs()
        const configuredProviders = Object.keys(allConfigs)
            .filter(key => allConfigs[key] && allConfigs[key].enabled !== false)
            .map(key => ({
                name: key,
                displayName: allConfigs[key].displayName || key,
            }))

        if (configuredProviders.length === 0) {
            alert(this.t.providers.testError)
            return
        }

        // 构建提供商列表
        const providerList = configuredProviders.map((p, i) =>
            `${i + 1}. ${p.displayName}`,
        ).join('\n')

        const choice = prompt(
            `${this.t.chatInterface.providerBadge}: ${this.currentProvider}\n\n${this.t.chatInterface.switchProvider}:\n${providerList}\n\n${this.t.chatInterface.inputPlaceholder}`,
            '1',
        )

        if (choice) {
            const index = parseInt(choice, 10) - 1
            if (index >= 0 && index < configuredProviders.length) {
                const selectedProvider = configuredProviders[index]
                this.config.setDefaultProvider(selectedProvider.name)
                this.currentProvider = selectedProvider.displayName
                this.logger.info('Provider switched', { provider: selectedProvider.name })

                // 添加系统消息
                const systemMessage: ChatMessage = {
                    id: this.generateId(),
                    role: MessageRole.SYSTEM,
                    content: `${this.t.chatInterface.providerBadge}: ${this.currentProvider}`,
                    timestamp: new Date(),
                }
                this.messages.push(systemMessage)
            } else {
                alert(this.t.chatInterface.errorPrefix)
            }
        }
    }

    /**
     * 滚动到底部（公开方法）
     */
    scrollToBottom(): void {
        this.shouldScrollToBottom = true
    }

    /**
     * 滚动到顶部
     */
    scrollToTop(): void {
        const chatContainer = this.chatContainerRef?.nativeElement || document.querySelector('.ai-chat-container')
        if (chatContainer) {
            chatContainer.scrollTo({ top: 0, behavior: 'smooth' })
        }
    }

    /**
     * 实际执行滚动到底部
     */
    private performScrollToBottom(): void {
        const chatContainer = this.chatContainerRef?.nativeElement || document.querySelector('.ai-chat-container')
        if (chatContainer) {
            chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' })
        }
    }

    /**
     * 调度滚动刷新（先上移再到底部，触发渲染）
     */
    private scheduleScrollRefresh(): void {
        if (this.scrollRefreshPending) {
            return
        }
        this.scrollRefreshPending = true
        window.setTimeout(() => {
            this.scrollRefreshPending = false
            this.triggerScrollRefresh()
        }, 50)
    }

    private triggerScrollRefresh(): void {
        const chatContainer = this.chatContainerRef?.nativeElement || document.querySelector('.ai-chat-container')
        if (!chatContainer) {
            return
        }
        const container = chatContainer as HTMLElement
        const max = Math.max(container.scrollHeight - container.clientHeight, 0)
        const delta = 12
        const up = Math.max(container.scrollTop - delta, 0)
        container.scrollTop = up
        this.logger.info('[Chat Interface] Scroll refresh (up)', {
            delta,
            up,
            max,
            height: container.scrollHeight,
            clientHeight: container.clientHeight,
        })
        window.setTimeout(() => {
            container.scrollTop = max
            this.logger.info('[Chat Interface] Scroll refresh (down)', {
                delta,
                up,
                max,
                height: container.scrollHeight,
                clientHeight: container.clientHeight,
            })
        }, 30)
    }

    /**
     * 调度滚动到当前 AI 回复起始位置（仅在本轮输出超过可见区域时触发）
     */
    private scheduleScrollToAiMessageStart(): void {
        if (this.userScrolledDuringResponse) {
            return
        }
        if (this.aiStartScrollPending) {
            return
        }
        this.aiStartScrollPending = true
        window.setTimeout(() => {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.aiStartScrollPending = false
                    this.scrollToAiMessageStartIfNeeded()
                })
            })
        }, 0)
    }

    private scrollToAiMessageStartIfNeeded(): void {
        const chatContainer = this.chatContainerRef?.nativeElement || document.querySelector('.ai-chat-container')
        if (!chatContainer || !this.activeAiMessageId) {
            return
        }
        const selector = `[data-message-id="${this.activeAiMessageId}"]`
        const messageEl = (chatContainer as HTMLElement).querySelector(selector) as HTMLElement | null
        if (!messageEl) {
            return
        }

        const messageHeight = messageEl.offsetHeight
        const visibleHeight = (chatContainer as HTMLElement).clientHeight
        if (messageHeight <= visibleHeight) {
            return
        }

        const targetTop = messageEl.offsetTop;
        (chatContainer as HTMLElement).scrollTo({ top: targetTop, behavior: 'smooth' })
    }

    /**
     * 处理滚动事件
     */
    onScroll(event: Event): void {
        const target = event.target as HTMLElement
        if (!target) {return}
        this.updateScrollButtons(target)
    }

    /**
     * 检查滚动状态（初始化时调用）
     */
    private checkScrollState(): void {
        const chatContainer = this.chatContainerRef?.nativeElement || document.querySelector('.ai-chat-container')
        if (chatContainer) {
            this.updateScrollButtons(chatContainer)
        }
    }

    /**
     * 更新滚动按钮显示状态
     */
    private updateScrollButtons(container: HTMLElement): void {
        const scrollTop = container.scrollTop
        const scrollHeight = container.scrollHeight
        const clientHeight = container.clientHeight
        const distanceFromBottom = Math.max(scrollHeight - (scrollTop + clientHeight), 0)
        this.isUserNearBottom = distanceFromBottom <= this.AUTO_SCROLL_THRESHOLD
        if (this.isLoading && !this.isUserNearBottom) {
            this.userScrolledDuringResponse = true
        }

        // 判断是否显示滚动按钮
        this.showScrollTop = scrollTop > 50
        this.showScrollBottom = scrollHeight > clientHeight && scrollTop < scrollHeight - clientHeight - 50
    }

    /**
     * 保存聊天历史
     */
    private saveChatHistory(): void {
        try {
            if (this.messages.length > 0 && this.currentSessionId) {
                this.chatHistory.saveSession(this.currentSessionId, this.messages)
                this.logger.info('Chat history saved', {
                    sessionId: this.currentSessionId,
                    messageCount: this.messages.length,
                })
            }
        } catch (error) {
            this.logger.error('Failed to save chat history', error)
        }
    }

    /**
     * 生成会话 ID
     */
    private generateSessionId(): string {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    /**
     * 生成唯一ID
     */
    private generateId(): string {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    /**
     * 获取消息时间格式
     */
    formatTimestamp(timestamp: Date): string {
        return timestamp.toLocaleTimeString('zh-CN', {
            hour: '2-digit',
            minute: '2-digit',
        })
    }

    /**
     * 播放提示音
     */
    private playNotificationSound(): void {
        if (!this.soundEnabled) {return}

        try {
            // 使用系统提示音
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
            const oscillator = audioContext.createOscillator()
            const gainNode = audioContext.createGain()

            oscillator.connect(gainNode)
            gainNode.connect(audioContext.destination)

            oscillator.frequency.value = 800
            oscillator.type = 'sine'
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime)
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2)

            oscillator.start(audioContext.currentTime)
            oscillator.stop(audioContext.currentTime + 0.2)
        } catch (error) {
            // 忽略音频播放错误
        }
    }

    /**
     * 检查是否为今天的消息
     */
    isToday(date: Date): boolean {
        const today = new Date()
        return date.toDateString() === today.toDateString()
    }

    /**
     * 检查是否为同一天的消息
     */
    isSameDay(date1: Date, date2: Date): boolean {
        return date1.toDateString() === date2.toDateString()
    }
}

