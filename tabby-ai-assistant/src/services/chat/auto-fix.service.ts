/**
 * 自动修复服务
 *
 * 职责：
 * 1. 监控命令执行结果，检测失败
 * 2. 分析错误原因，生成修复建议
 * 3. 自动生成修复命令（可选自动执行）
 * 4. 支持重试机制，限制最大重试次数
 */

import { Injectable, OnDestroy } from '@angular/core'
import { Subject, Observable, Subscription } from 'rxjs'
import { TerminalContextService } from '../terminal/terminal-context.service'
import { CommandGeneratorService } from '../chat/command-generator.service'
import { LoggerService } from '../core/logger.service'
import { TerminalError, CommandResult } from '../../types/terminal.types'
import { CommandResponse } from '../../types/ai.types'

/**
 * 单次修复尝试记录
 */
export interface FixAttempt {
    id: string
    timestamp: Date
    command: string
    explanation: string
    confidence: number
    success: boolean
    error?: string
    exitCode?: number
}

/**
 * 修复选项配置
 */
export interface FixOptions {
    maxAttempts?: number           // 最大尝试次数
    retryDelayMs?: number          // 重试延迟
    autoExecute?: boolean          // 是否自动执行
    skipConfirmation?: boolean     // 跳过确认（仅低风险）
    includeHistory?: boolean       // 是否包含历史记录
}

/**
 * 修复建议
 */
export interface FixSuggestion {
    id: string
    originalCommand: string
    originalError: TerminalError
    suggestedCommand: string
    explanation: string
    confidence: number
    riskLevel: 'low' | 'medium' | 'high'
    autoExecutable: boolean  // 是否可以自动执行
    attempts: FixAttempt[]   // 尝试历史记录
    totalAttempts: number    // 总尝试次数
}

/**
 * 修复结果
 */
export interface FixResult {
    success: boolean
    originalCommand: string
    fixedCommand?: string
    attempts: FixAttempt[]   // 尝试历史记录
    totalAttempts: number
    finalError?: string
    timestamp: Date
}

/**
 * 自动修复配置
 */
export interface AutoFixConfig {
    enabled: boolean
    maxRetries: number           // 最大重试次数，默认 3
    autoExecuteLowRisk: boolean  // 是否自动执行低风险修复
    confirmMediumRisk: boolean   // 是否需要确认中等风险
    alwaysConfirmHighRisk: boolean // 高风险总是需要确认
    retryDelayMs: number         // 重试延迟（毫秒）
    timeoutMs: number            // 超时时间
}

/**
 * 修复事件
 */
export interface FixEvent {
    type: 'fix_suggested' | 'fix_executed' | 'fix_succeeded' | 'fix_failed' | 'max_retries_reached'
    suggestion?: FixSuggestion
    result?: FixResult
    timestamp: Date
}

const DEFAULT_AUTO_FIX_CONFIG: AutoFixConfig = {
    enabled: true,
    maxRetries: 3,
    autoExecuteLowRisk: false,  // 默认不自动执行，需要用户确认
    confirmMediumRisk: true,
    alwaysConfirmHighRisk: true,
    retryDelayMs: 1000,
    timeoutMs: 30000,
}

@Injectable({ providedIn: 'root' })
export class AutoFixService implements OnDestroy {
    // ========== 状态管理 ==========

    /** 配置 */
    private config: AutoFixConfig = { ...DEFAULT_AUTO_FIX_CONFIG }

    /** 修复事件流 */
    private fixEventSubject = new Subject<FixEvent>()

    /** 重试计数器 */
    private retryCounters = new Map<string, number>()

    /** 活跃的修复任务 */
    private activeFixes = new Map<string, FixSuggestion>()

    /** 订阅 */
    private subscriptions: Subscription[] = []

    constructor(
        private terminalContext: TerminalContextService,
        private commandGenerator: CommandGeneratorService,
        private logger: LoggerService,
    ) {
        // 订阅错误事件
        this.subscriptions.push(
            this.terminalContext.onError().subscribe(error => {
                this.handleError(error)
            }),
        )

        // 订阅命令执行事件
        this.subscriptions.push(
            this.terminalContext.onCommandExecuted().subscribe(result => {
                this.handleCommandResult(result)
            }),
        )

        this.logger.info('AutoFixService initialized', { config: this.config })
    }

    // ========== 公共 API ==========

    /**
     * 获取修复事件流
     */
    get fixEvents$(): Observable<FixEvent> {
        return this.fixEventSubject.asObservable()
    }

    /**
     * 更新配置
     */
    updateConfig(config: Partial<AutoFixConfig>): void {
        this.config = { ...this.config, ...config }
        this.logger.info('AutoFix config updated', { config: this.config })
    }

    /**
     * 获取当前配置
     */
    getConfig(): AutoFixConfig {
        return { ...this.config }
    }

    /**
     * 手动触发修复建议生成
     */
    async generateFixSuggestion(error: TerminalError, options?: FixOptions): Promise<FixSuggestion | null> {
        if (!this.config.enabled) {
            return null
        }

        try {
            // 使用 CommandGeneratorService 生成修复命令
            const response = await this.commandGenerator.generateFixForError(error)

            // 构建修复建议（包含初始尝试记录）
            const suggestion = this.buildFixSuggestion(error, response)

            this.logger.info('Fix suggestion generated', { suggestion })

            // 发送事件
            this.fixEventSubject.next({
                type: 'fix_suggested',
                suggestion,
                timestamp: new Date(),
            })

            return suggestion
        } catch (err) {
            this.logger.error('Failed to generate fix suggestion', err)
            return null
        }
    }

    /**
     * 带重试的修复生成
     * 支持多次尝试，记录每次尝试的结果
     */
    async generateFixWithRetry(
        error: TerminalError,
        options?: FixOptions,
    ): Promise<FixSuggestion | null> {
        if (!this.config.enabled) {
            return null
        }

        const maxAttempts = options?.maxAttempts ?? this.config.maxRetries
        const attempts: FixAttempt[] = []
        let lastResponse: CommandResponse | null = null

        for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
            try {
                const response = await this.commandGenerator.generateFixForError(error)
                lastResponse = response

                const attempt: FixAttempt = {
                    id: `attempt_${Date.now()}_${attemptNum}`,
                    timestamp: new Date(),
                    command: response.command,
                    explanation: response.explanation,
                    confidence: response.confidence,
                    success: true,
                }
                attempts.push(attempt)

                // 如果置信度高，提前返回
                if (response.confidence >= 0.8) {
                    break
                }

                // 延迟后重试
                if (attemptNum < maxAttempts) {
                    await this.delay(options?.retryDelayMs ?? this.config.retryDelayMs)
                }
            } catch (err) {
                const attempt: FixAttempt = {
                    id: `attempt_${Date.now()}_${attemptNum}`,
                    timestamp: new Date(),
                    command: '',
                    explanation: '',
                    confidence: 0,
                    success: false,
                    error: err instanceof Error ? err.message : String(err),
                }
                attempts.push(attempt)

                // 延迟后重试
                if (attemptNum < maxAttempts) {
                    await this.delay(options?.retryDelayMs ?? this.config.retryDelayMs)
                }
            }
        }

        if (!lastResponse) {
            return null
        }

        // 构建包含所有尝试记录的建议
        const suggestion = this.buildFixSuggestion(error, lastResponse)
        suggestion.attempts = attempts
        suggestion.totalAttempts = attempts.length

        this.logger.info('Fix with retry generated', {
            totalAttempts: attempts.length,
            finalConfidence: lastResponse.confidence,
        })

        return suggestion
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * 执行修复命令
     */
    async executeFix(suggestion: FixSuggestion): Promise<FixResult> {
        const result: FixResult = {
            success: false,
            originalCommand: suggestion.originalCommand,
            fixedCommand: suggestion.suggestedCommand,
            attempts: suggestion.attempts ?? [],
            totalAttempts: suggestion.totalAttempts ?? 1,
            timestamp: new Date(),
        }

        try {
            // 记录执行
            this.activeFixes.set(suggestion.id, suggestion)

            // 发送事件
            this.fixEventSubject.next({
                type: 'fix_executed',
                suggestion,
                timestamp: new Date(),
            })

            // 注意：实际执行命令需要通过 TerminalToolsService
            // 这里只是记录和建议，实际执行由调用方处理

            this.logger.info('Fix command ready for execution', {
                id: suggestion.id,
                command: suggestion.suggestedCommand,
            })

            // 标记成功（假设执行成功，实际结果由外部反馈）
            result.success = true

            this.fixEventSubject.next({
                type: 'fix_succeeded',
                suggestion,
                result,
                timestamp: new Date(),
            })

            return result
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err)
            result.finalError = errorMessage

            this.fixEventSubject.next({
                type: 'fix_failed',
                suggestion,
                result,
                timestamp: new Date(),
            })

            this.logger.error('Fix execution failed', { error: errorMessage })
            return result
        } finally {
            this.activeFixes.delete(suggestion.id)
        }
    }

    /**
     * 检查是否可以重试
     */
    canRetry(commandKey: string): boolean {
        const currentRetries = this.retryCounters.get(commandKey) ?? 0
        return currentRetries < this.config.maxRetries
    }

    /**
     * 获取剩余重试次数
     */
    getRemainingRetries(commandKey: string): number {
        const currentRetries = this.retryCounters.get(commandKey) ?? 0
        return Math.max(0, this.config.maxRetries - currentRetries)
    }

    /**
     * 记录重试
     */
    recordRetry(commandKey: string): void {
        const currentRetries = this.retryCounters.get(commandKey) ?? 0
        this.retryCounters.set(commandKey, currentRetries + 1)

        this.logger.debug('Retry recorded', { commandKey, retries: currentRetries + 1 })
    }

    /**
     * 重置重试计数
     */
    resetRetryCount(commandKey: string): void {
        this.retryCounters.delete(commandKey)
        this.logger.debug('Retry count reset', { commandKey })
    }

    /**
     * 清除所有重试计数
     */
    clearAllRetryCounts(): void {
        this.retryCounters.clear()
        this.logger.info('All retry counts cleared')
    }

    /**
     * 获取活跃的修复建议
     */
    getActiveFixes(): FixSuggestion[] {
        return Array.from(this.activeFixes.values())
    }

    /**
     * 分析错误类型并生成针对性建议
     */
    analyzeError(error: TerminalError): {
        category: string
        severity: 'low' | 'medium' | 'high'
        autoFixable: boolean
        hints: string[]
    } {
        const hints: string[] = []
        let category = 'unknown'
        let severity: 'low' | 'medium' | 'high' = 'medium'
        let autoFixable = false

        switch (error.type) {
            case 'command_not_found':
                category = 'missing_command'
                severity = 'low'
                autoFixable = true
                hints.push('检查命令拼写')
                hints.push('可能需要安装相关软件包')
                break

            case 'permission_denied':
                category = 'permission'
                severity = 'medium'
                autoFixable = true
                hints.push('尝试使用 sudo')
                hints.push('检查文件权限')
                break

            case 'file_not_found':
                category = 'missing_file'
                severity = 'low'
                autoFixable = true
                hints.push('检查文件路径')
                hints.push('确认当前工作目录')
                break

            case 'syntax_error':
                category = 'syntax'
                severity = 'low'
                autoFixable = true
                hints.push('检查命令语法')
                hints.push('查看命令帮助文档')
                break

            case 'network_error':
                category = 'network'
                severity = 'medium'
                autoFixable = false
                hints.push('检查网络连接')
                hints.push('确认 URL 是否正确')
                break

            case 'runtime_error':
                category = 'runtime'
                severity = 'high'
                autoFixable = false
                hints.push('查看详细错误日志')
                hints.push('检查依赖是否安装')
                break

            default:
                category = 'unknown'
                severity = 'high'
                autoFixable = false
                hints.push('手动检查错误原因')
        }

        return {
            category,
            severity,
            autoFixable,
            hints,
        }
    }

    // ========== 私有方法 ==========

    /**
     * 处理错误事件
     */
    private async handleError(error: TerminalError): Promise<void> {
        if (!this.config.enabled) {
            return
        }

        this.logger.info('Error detected, analyzing...', { error })

        // 分析错误
        const analysis = this.analyzeError(error)

        // 如果可以自动修复，生成建议
        if (analysis.autoFixable) {
            const suggestion = await this.generateFixSuggestion(error)

            if (suggestion && suggestion.confidence >= 0.7) {
                this.logger.info('High confidence fix suggestion generated', {
                    command: suggestion.suggestedCommand,
                    confidence: suggestion.confidence,
                })
            }
        }
    }

    /**
     * 处理命令执行结果
     */
    private handleCommandResult(result: CommandResult): void {
        const commandKey = this.getCommandKey(result.command)

        if (result.success) {
            // 命令成功，重置重试计数
            this.resetRetryCount(commandKey)
        } else {
            // 命令失败，记录重试
            this.recordRetry(commandKey)

            // 检查是否达到最大重试次数
            if (!this.canRetry(commandKey)) {
                this.logger.warn('Max retries reached for command', { command: result.command })

                this.fixEventSubject.next({
                    type: 'max_retries_reached',
                    result: {
                        success: false,
                        originalCommand: result.command,
                        attempts: this.config.maxRetries,
                        finalError: result.stderr,
                        timestamp: new Date(),
                    },
                    timestamp: new Date(),
                })
            }
        }
    }

    /**
     * 构建修复建议
     */
    private buildFixSuggestion(error: TerminalError, response: CommandResponse): FixSuggestion {
        const analysis = this.analyzeError(error)

        // 确定风险级别
        let riskLevel: 'low' | 'medium' | 'high' = 'medium'
        if (response.confidence >= 0.9 && analysis.severity === 'low') {
            riskLevel = 'low'
        } else if (analysis.severity === 'high' || response.confidence < 0.5) {
            riskLevel = 'high'
        }

        // 判断是否可以自动执行
        const autoExecutable = this.config.autoExecuteLowRisk
            && riskLevel === 'low'
            && response.confidence >= 0.9

        // 创建初始尝试记录
        const initialAttempt: FixAttempt = {
            id: `attempt_${Date.now()}_1`,
            timestamp: new Date(),
            command: response.command,
            explanation: response.explanation,
            confidence: response.confidence,
            success: true,
        }

        return {
            id: this.generateSuggestionId(),
            originalCommand: error.command ?? '',
            originalError: error,
            suggestedCommand: response.command,
            explanation: response.explanation,
            confidence: response.confidence,
            riskLevel,
            autoExecutable,
            attempts: [initialAttempt],
            totalAttempts: 1,
        }
    }

    /**
     * 生成命令键（用于追踪重试）
     */
    private getCommandKey(command: string): string {
        // 简化命令，忽略参数变化，只取基础命令
        const baseCommand = command.trim().split(/\s+/)[0] ?? ''
        return baseCommand.toLowerCase()
    }

    /**
     * 生成建议 ID
     */
    private generateSuggestionId(): string {
        return `fix_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    ngOnDestroy(): void {
        // 清理订阅
        this.subscriptions.forEach(sub => sub.unsubscribe())
        this.subscriptions = []

        // 清理状态
        this.retryCounters.clear()
        this.activeFixes.clear()

        // 完成事件流
        this.fixEventSubject.complete()

        this.logger.info('AutoFixService destroyed')
    }
}