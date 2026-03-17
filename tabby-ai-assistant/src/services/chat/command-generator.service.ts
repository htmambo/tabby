import { Injectable } from '@angular/core'
import { CommandRequest, CommandResponse, ChatRequest, MessageRole } from '../../types/ai.types'
import { TerminalContext, TerminalError } from '../../types/terminal.types'
import { AiAssistantService } from '../core/ai-assistant.service'
import { TerminalContextService } from '../terminal/terminal-context.service'
import { SecurityValidatorService } from '../security/security-validator.service'
import { LoggerService } from '../core/logger.service'
import { TranslateService } from 'tabby-core'
import { CommandCacheService, ContextFingerprint } from './command-cache.service'
import { ConfigProviderService } from '../core/config-provider.service'

@Injectable({ providedIn: 'root' })
export class CommandGeneratorService {
    constructor(
        private aiService: AiAssistantService,
        private terminalContext: TerminalContextService,
        private securityValidator: SecurityValidatorService,
        private logger: LoggerService,
        private translate: TranslateService,
        private commandCache: CommandCacheService,
        private config: ConfigProviderService,
    ) {}

    /**
     * 生成命令（基于终端上下文）
     */
    async generateCommand(request: CommandRequest): Promise<CommandResponse> {
        this.logger.info('Generating command', { request })

        try {
            // 获取终端上下文
            const context = this.terminalContext.getCurrentContext()
            const error = this.terminalContext.getLastError()

            // 构建上下文指纹用于缓存
            const providerStatus = this.aiService.getProviderStatus()
            const providerName = providerStatus?.active?.name ?? 'unknown'
            const providerConfig = this.config.getProviderConfig(providerName)

            const fingerprint: ContextFingerprint = {
                os: context?.systemInfo.platform,
                shell: context?.session.shell,
                provider: providerName,
                model: providerConfig?.model ?? 'unknown',
                temperature: 0.3,
                maxTokens: 500,
            }

            // 1. 尝试从缓存获取
            const cachedEntry = this.commandCache.get(request.naturalLanguage, fingerprint)
            if (cachedEntry) {
                this.logger.info('Command cache hit', {
                    naturalLanguage: request.naturalLanguage,
                    command: cachedEntry.command,
                })

                // 安全验证（即使是缓存命令也需要验证）
                const validation = await this.securityValidator.validateAndConfirm(
                    cachedEntry.command,
                    cachedEntry.explanation,
                    context,
                )

                if (!validation.approved) {
                    this.logger.warn('Cached command blocked by security validator', {
                        reason: validation.reason,
                    })
                    // 缓存命令被阻止，继续正常流程
                } else {
                    // 返回缓存的命令
                    return {
                        command: cachedEntry.command,
                        explanation: cachedEntry.explanation,
                        confidence: cachedEntry.confidence,
                        alternatives: cachedEntry.alternatives,
                        fromCache: true,
                    }
                }
            }

            // 2. 缓存未命中，构建增强的提示词
            const enhancedPrompt = this.buildEnhancedPrompt(request, context, error)

            // 构建聊天请求
            const chatRequest: ChatRequest = {
                messages: [
                    {
                        id: this.generateId(),
                        role: MessageRole.SYSTEM,
                        content: this.getSystemPrompt(),
                        timestamp: new Date(),
                    },
                    {
                        id: this.generateId(),
                        role: MessageRole.USER,
                        content: enhancedPrompt,
                        timestamp: new Date(),
                    },
                ],
                maxTokens: 500,
                temperature: 0.3, // 使用较低温度确保命令的准确性
            }

            // 3. 调用AI提供商
            const response = await this.aiService.chat(chatRequest)

            // 4. 解析AI响应
            const commandResponse = this.parseAiResponse(response.message.content)

            // 5. 安全验证
            const validation = await this.securityValidator.validateAndConfirm(
                commandResponse.command,
                commandResponse.explanation,
                context,
            )

            if (!validation.approved) {
                throw new Error(`Command blocked by security validator: ${validation.reason}`)
            }

            // 6. 写入缓存（仅在解析成功时）
            if (commandResponse._parseSuccess) {
                this.commandCache.set(
                    request.naturalLanguage,
                    fingerprint,
                    commandResponse.command,
                    commandResponse.explanation,
                    commandResponse.confidence,
                    commandResponse.alternatives,
                )
                this.logger.debug('Command cached due to successful parsing')
            } else {
                this.logger.warn('Command not cached due to parsing issues', {
                    command: commandResponse.command,
                    confidence: commandResponse.confidence,
                })
            }

            this.logger.info('Command generated successfully', { commandResponse })
            return {
                ...commandResponse,
                fromCache: false,
            }

        } catch (error) {
            this.logger.error('Failed to generate command', error)
            throw error
        }
    }

    /**
     * 从选择文本生成命令
     */
    async generateFromSelection(selection: string): Promise<CommandResponse> {
        const request: CommandRequest = {
            naturalLanguage: selection,
            context: this.buildTerminalContext(),
        }

        return this.generateCommand(request)
    }

    /**
     * 从错误生成修复命令
     */
    async generateFixForError(error: TerminalError): Promise<CommandResponse> {
        const context = this.terminalContext.getCurrentContext()

        const request: CommandRequest = {
            naturalLanguage: `修复错误：${error.message}`,
            context: {
                currentDirectory: context?.session.cwd,
                operatingSystem: context?.systemInfo.platform,
                shell: context?.session.shell,
                environment: context?.session.environment,
            },
            constraints: {
                forbiddenCommands: ['rm -rf /', 'sudo rm -rf /', 'format'],
            },
        }

        return this.generateCommand(request)
    }

    /**
     * 生成智能建议
     */
    async generateSuggestions(input: string): Promise<string[]> {
        const context = this.terminalContext.getCurrentContext()

        const prompt = `
基于当前终端状态，为输入"${input}"生成3-5个可能的命令建议。

当前上下文：
- 目录：${context?.session.cwd}
- Shell：${context?.session.shell}
- 系统：${context?.systemInfo.platform}
- 最近命令：${context?.recentCommands.slice(0, 5).join(', ')}

请直接返回命令列表，每行一个，不要解释。
        `

        try {
            const response = await this.aiService.chat({
                messages: [
                    {
                        id: this.generateId(),
                        role: MessageRole.USER,
                        content: prompt,
                        timestamp: new Date(),
                    },
                ],
                maxTokens: 200,
                temperature: 0.5,
            })

            const suggestions = response.message.content
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .slice(0, 5)

            return suggestions

        } catch (error) {
            this.logger.error('Failed to generate suggestions', error)
            return []
        }
    }

    /**
     * 构建增强提示词
     */
    private buildEnhancedPrompt(
        request: CommandRequest,
        context: TerminalContext | null,
        error: TerminalError | null,
    ): string {
        let prompt = `请将以下自然语言描述转换为准确的命令：\n\n"${request.naturalLanguage}"\n\n`

        // 添加终端上下文
        if (context) {
            prompt += `\n当前终端状态：\n`
            prompt += `- 当前目录：${context.session.cwd}\n`
            prompt += `- Shell类型：${context.session.shell}\n`
            prompt += `- 操作系统：${context.systemInfo.platform}\n`
            prompt += `- 用户：${context.session.user}\n`

            if (context.recentCommands.length > 0) {
                prompt += `- 最近执行的命令：${context.recentCommands.slice(0, 3).join(', ')}\n`
            }

            if (context.projectInfo) {
                prompt += `- 检测到项目类型：${context.projectInfo.type}\n`
                prompt += `- 项目根目录：${context.projectInfo.root}\n`
            }
        }

        // 添加错误信息（如果有）
        if (error) {
            prompt += `\n当前错误信息：\n`
            prompt += `- 错误类型：${error.type}\n`
            prompt += `- 错误消息：${error.message}\n`
            prompt += `- 失败命令：${error.command}\n`
            prompt += `- 退出码：${error.exitCode}\n`
        }

        // 添加环境变量
        if (context?.session.environment) {
            const importantEnvVars = ['PATH', 'HOME', 'USER', 'PWD', 'SHELL']
            const envInfo = importantEnvVars
                .filter(key => context.session.environment[key])
                .map(key => `${key}=${context.session.environment[key]}`)
                .join(', ')

            if (envInfo) {
                prompt += `\n重要环境变量：${envInfo}\n`
            }
        }

        // 添加约束
        if (request.constraints) {
            prompt += `\n约束条件：\n`
            if (request.constraints.maxLength) {
                prompt += `- 命令最大长度：${request.constraints.maxLength}字符\n`
            }
            if (request.constraints.allowedCommands?.length) {
                prompt += `- 允许使用的命令：${request.constraints.allowedCommands.join(', ')}\n`
            }
            if (request.constraints.forbiddenCommands?.length) {
                prompt += `- 禁止使用的命令：${request.constraints.forbiddenCommands.join(', ')}\n`
            }
        }

        prompt += `\n请按照以下JSON格式返回：\n`
        prompt += `{\n`
        prompt += `  "command": "最推荐的命令",\n`
        prompt += `  "explanation": "命令的解释说明",\n`
        prompt += `  "confidence": 0.95,\n`
        prompt += `  "alternatives": [\n`
        prompt += `    {\n`
        prompt += `      "command": "备选命令1",\n`
        prompt += `      "explanation": "备选命令解释",\n`
        prompt += `      "confidence": 0.85\n`
        prompt += `    }\n`
        prompt += `  ]\n`
        prompt += `}\n`
        prompt += `\n注意：请提供2-4个不同的备选命令，特别是当用户需求存在多种实现方式时。每个备选命令应有不同的特点（如简洁性、安全性、兼容性等）。\n`

        return prompt
    }

    /**
     * 获取系统提示词
     */
    private getSystemPrompt(): string {
        return this.translate.instant('systemPrompts.commandGeneratorRole')
    }

    /**
     * 解析AI响应
     * 返回解析结果，包含是否使用了备选解析的标记
     */
    private parseAiResponse(content: string): CommandResponse & { _parseSuccess: boolean } {
        try {
            // 尝试解析JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0])
                const command = parsed.command || ''
                const explanation = parsed.explanation || ''
                const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0.5

                // 处理备选命令：验证、去重、排序
                const alternatives = this.processAlternatives(
                    parsed.alternatives || [],
                    command,
                )

                // 验证解析结果质量
                const parseSuccess = this.validateParseResult(command, confidence)

                return {
                    command,
                    explanation,
                    confidence,
                    alternatives,
                    _parseSuccess: parseSuccess,
                }
            }
        } catch (error) {
            this.logger.warn('Failed to parse JSON response, fallback to text parsing', error)
        }

        // 备用解析：提取命令和解释
        const lines = content.split('\n').map(l => l.trim()).filter(l => l)
        const command = lines[0] || ''
        const explanation = lines.slice(1).join(' ') || this.translate.instant('systemPrompts.defaultCommandExplanation')

        return {
            command,
            explanation,
            confidence: 0.5,
            _parseSuccess: false, // 备选解析标记为失败
        }
    }

    /**
     * 验证解析结果质量
     * 用于决定是否缓存
     */
    private validateParseResult(command: string, confidence: number): boolean {
        // 空命令不缓存
        if (!command || command.trim().length === 0) {
            return false
        }

        // 置信度过低不缓存
        if (confidence < 0.3) {
            return false
        }

        // 命令包含明显错误标记不缓存
        const invalidPatterns = [
            /error/i,
            /failed/i,
            /unknown command/i,
            /invalid/i,
            /^\s*$/,
        ]

        if (invalidPatterns.some(p => p.test(command))) {
            return false
        }

        return true
    }

    /**
     * 处理备选命令列表
     * 验证、去重、按置信度排序
     */
    private processAlternatives(
        alternatives: Array<{ command: string; explanation: string; confidence: number; tags?: string[] }>,
        primaryCommand: string,
    ): Array<{ command: string; explanation: string; confidence: number; tags?: string[] }> {
        if (!alternatives || !Array.isArray(alternatives)) {
            return []
        }

        const seen = new Set<string>()
        seen.add(primaryCommand.trim().toLowerCase()) // 排除主命令

        const validAlternatives: Array<{ command: string; explanation: string; confidence: number; tags?: string[] }> = []

        for (const alt of alternatives) {
            // 验证必要字段
            if (!alt.command || typeof alt.command !== 'string') {
                continue
            }

            const trimmedCommand = alt.command.trim()
            const lowerCommand = trimmedCommand.toLowerCase()

            // 跳过空命令和重复命令
            if (!trimmedCommand || seen.has(lowerCommand)) {
                continue
            }

            // 跳过危险的命令（基本检查）
            if (this.isDangerousCommand(trimmedCommand)) {
                this.logger.warn('Skipping dangerous alternative command', { command: trimmedCommand })
                continue
            }

            seen.add(lowerCommand)

            // 自动生成标签（如果未提供）
            const tags = alt.tags ?? this.generateTags(trimmedCommand)

            validAlternatives.push({
                command: trimmedCommand,
                explanation: alt.explanation || '',
                confidence: typeof alt.confidence === 'number' ? alt.confidence : 0.5,
                tags,
            })
        }

        // 按置信度降序排序
        validAlternatives.sort((a, b) => b.confidence - a.confidence)

        // 最多保留4个备选
        return validAlternatives.slice(0, 4)
    }

    /**
     * 自动生成命令标签
     */
    private generateTags(command: string): string[] {
        const tags: string[] = []

        // 安全相关标签
        if (/^sudo/.test(command)) {
            tags.push('elevated')
        } else if (!/\brm\b|\bdd\b|\bformat\b|\bmkfs\b/.test(command)) {
            tags.push('safe')
        }

        // 性能相关标签
        if (/\|/.test(command)) {
            tags.push('pipelined')
        }
        if (/&&|\|\|/.test(command)) {
            tags.push('chained')
        }
        if (!/&&|\|\||\|/.test(command)) {
            tags.push('simple')
        }

        // 兼容性标签
        if (/\b(ls|cat|grep|find|sed|awk)\b/.test(command)) {
            tags.push('unix')
        }
        if (/\b(dir|type|findstr)\b/.test(command)) {
            tags.push('windows')
        }
        if (/^git\s/.test(command)) {
            tags.push('git')
        }
        if (/^(npm|yarn|pnpm)\s/.test(command)) {
            tags.push('node')
        }
        if (/^(pip|python|python3)\s/.test(command)) {
            tags.push('python')
        }

        return tags.length > 0 ? tags : ['general']
    }

    /**
     * 检查是否为危险命令（快速检查）
     */
    private isDangerousCommand(command: string): boolean {
        const dangerousPatterns = [
            /^rm\s+-rf\s+\//,           // 删除根目录
            />\s*\/dev\/sda/,           // 覆盖磁盘
            /:\(\)\{\s*:\|:&\s*\};:/,   // Fork 炸弹
            /^mkfs/,                    // 格式化
            /^dd\s+if=.*of=\/dev/,      // dd 写设备
        ]

        return dangerousPatterns.some(pattern => pattern.test(command))
    }

    /**
     * 构建终端上下文
     */
    private buildTerminalContext(): CommandRequest['context'] {
        const context = this.terminalContext.getCurrentContext()
        return {
            currentDirectory: context?.session.cwd,
            operatingSystem: context?.systemInfo.platform,
            shell: context?.session.shell,
            environment: context?.session.environment,
        }
    }

    /**
     * 生成唯一ID
     */
    private generateId(): string {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }
}
