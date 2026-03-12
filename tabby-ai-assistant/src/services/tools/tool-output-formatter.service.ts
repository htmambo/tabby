import { Injectable } from '@angular/core'
import { ToolOutputDisplay, ToolCategory, TOOL_CATEGORY_ICONS } from './types/ui-stream-event.types'

/**
 * 工具输出格式化服务
 *
 * 职责：
 * 1. 将原始工具输出转换为安全的、UI 友好的格式
 * 2. 过滤危险内容（HTML/ANSI/XML工具调用）
 * 3. 提供工具元数据（名称、图标、分类）
 *
 * 设计原则：
 * - 所有输出都经过转义，前端可直接渲染
 * - 自动检测输出格式并适配
 * - 支持截断和摘要生成
 */
@Injectable({ providedIn: 'root' })
export class ToolOutputFormatterService {

    // ========================================================================
    // 配置常量
    // ========================================================================

    /** 最大输出长度 */
    private readonly MAX_OUTPUT_LENGTH = 500

    /** 最大保留行数（终端输出） */
    private readonly MAX_TERMINAL_LINES = 30

    /** 工具名称到分类的映射 */
    private readonly TOOL_CATEGORIES: Record<string, ToolCategory> = {
        // 终端工具
        write_to_terminal: 'terminal',
        read_terminal_output: 'terminal',
        get_terminal_list: 'terminal',
        get_terminal_cwd: 'terminal',
        get_terminal_selection: 'terminal',
        focus_terminal: 'terminal',
        // 系统工具
        task_complete: 'system',
    }

    /** 工具友好名称映射 */
    private readonly TOOL_DISPLAY_NAMES: Record<string, string> = {
        write_to_terminal: '执行命令',
        read_terminal_output: '读取终端',
        get_terminal_list: '获取终端列表',
        get_terminal_cwd: '获取工作目录',
        get_terminal_selection: '获取选中文本',
        focus_terminal: '切换终端',
        task_complete: '任务完成',
    }

    // ========================================================================
    // 公共方法
    // ========================================================================

    /**
     * 格式化工具输出
     * 核心方法：将原始输出转换为安全的显示格式
     */
    formatOutput(toolName: string, rawOutput: string, isError = false): ToolOutputDisplay {
        const category = this.getToolCategory(toolName)

        // 1. 清理和过滤输出
        let cleanOutput = this.sanitizeOutput(rawOutput, category)

        // 2. 确定输出格式
        const format = this.detectOutputFormat(cleanOutput, category)

        // 3. 截断处理
        const originalLength = cleanOutput.length
        const truncated = originalLength > this.MAX_OUTPUT_LENGTH
        if (truncated) {
            cleanOutput = this.truncateOutput(cleanOutput, this.MAX_OUTPUT_LENGTH)
        }

        // 4. 生成摘要
        const summary = this.generateSummary(rawOutput, category, isError)

        return {
            format,
            content: cleanOutput,
            language: format === 'code' ? this.detectLanguage(cleanOutput) : undefined,
            truncated,
            originalLength,
            summary,
        }
    }

    /**
     * 获取工具分类
     */
    getToolCategory(toolName: string): ToolCategory {
        // 内置工具
        if (this.TOOL_CATEGORIES[toolName]) {
            return this.TOOL_CATEGORIES[toolName]
        }

        // MCP 工具 - 根据名称推断分类
        if (toolName.startsWith('mcp_')) {
            return this.inferMCPToolCategory(toolName)
        }

        return 'other'
    }

    /**
     * 获取工具显示名称
     */
    getToolDisplayName(toolName: string): string {
        // 内置工具
        if (this.TOOL_DISPLAY_NAMES[toolName]) {
            return this.TOOL_DISPLAY_NAMES[toolName]
        }

        // MCP 工具 - 提取可读名称
        if (toolName.startsWith('mcp_')) {
            return this.extractMCPToolDisplayName(toolName)
        }

        return toolName
    }

    /**
     * 获取工具图标
     */
    getToolIcon(toolName: string): string {
        const category = this.getToolCategory(toolName)
        return TOOL_CATEGORY_ICONS[category] || '🔧'
    }

    // ========================================================================
    // 核心过滤方法
    // ========================================================================

    /**
     * 清理和过滤输出
     * 核心：移除可能导致嵌套渲染的内容
     */
    private sanitizeOutput(output: string, category: ToolCategory): string {
        if (!output) {return ''}

        let cleaned = output

        // 1. 移除 HTML 标签（防止嵌套工具卡片）
        cleaned = this.removeHtmlTags(cleaned)

        // 2. 移除 ANSI 转义序列
        cleaned = this.removeAnsiCodes(cleaned)

        // 3. 移除 XML 格式的工具调用文本
        cleaned = this.removeXmlToolCalls(cleaned)

        // 4. 对于终端输出，提取实际命令结果
        if (category === 'terminal') {
            cleaned = this.extractTerminalResult(cleaned)
        }

        // 5. 移除连续空行
        cleaned = cleaned.replace(/\n{3,}/g, '\n\n')

        // 6. 转义特殊字符（用于 HTML 渲染）
        cleaned = this.escapeHtml(cleaned)

        return cleaned.trim()
    }

    /**
     * 移除 HTML 标签
     */
    private removeHtmlTags(text: string): string {
        // 移除所有 HTML 标签
        return text.replace(/<[^>]*>/g, '')
    }

    /**
     * 移除 ANSI 转义序列
     */
    private removeAnsiCodes(text: string): string {
        // ANSI 转义序列正则
        // eslint-disable-next-line no-control-regex
        return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
    }

    /**
     * 移除 XML 格式的工具调用文本
     * 防止 AI 输出的 <invoke> 等文本被当作实际内容
     */
    private removeXmlToolCalls(text: string): string {
        let cleaned = text

        // 移除 <invoke>...</invoke> 块
        cleaned = cleaned.replace(/<invoke[^>]*>[\s\S]*?<\/invoke>/gi, '[工具调用]')

        // 移除 <function_calls>...</function_calls> 块
        cleaned = cleaned.replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, '')

        // 移除 <tool_use>...</tool_use> 相关内容
        cleaned = cleaned.replace(/<tool_use[^>]*>[\s\S]*?<\/tool_use>/gi, '')

        // 移除 <parameter name="...">...</parameter>
        cleaned = cleaned.replace(/<parameter[^>]*>[\s\S]*?<\/parameter>/gi, '')

        return cleaned
    }

    /**
     * 从终端输出中提取实际结果
     * 移除 AI 之前输出的内容，只保留命令执行结果
     */
    private extractTerminalResult(output: string): string {
        const lines = output.split('\n')

        // 如果没有标记，返回最后 N 行（过滤掉历史内容）
        const recentLines = lines.slice(-this.MAX_TERMINAL_LINES)

        // 检查是否包含标记
        const hasStartMarker = lines.some(l => l.includes('=== 终端输出 ==='))
        const hasEndMarker = lines.some(l => l.includes('=== 输出结束 ==='))

        if (hasStartMarker && hasEndMarker) {
            // 提取标记之间的内容
            let inSection = false
            const result: string[] = []

            for (const line of lines) {
                if (line.includes('=== 终端输出 ===')) {
                    inSection = true
                    continue
                }
                if (line.includes('=== 输出结束 ===')) {
                    break
                }
                if (inSection) {
                    result.push(line)
                }
            }

            // 限制行数
            return result.slice(-this.MAX_TERMINAL_LINES).join('\n')
        }

        // 如果没有标记，尝试识别并跳过 AI 之前生成的格式化内容
        const filteredLines = this.filterAITerminalOutput(recentLines)
        return filteredLines.join('\n')
    }

    /**
     * 过滤掉 AI 之前生成的终端输出内容
     * AI 之前可能会输出工具卡片等内容，需要过滤
     */
    private filterAITerminalOutput(lines: string[]): string[] {
        const aiPatterns = [
            /^🔧 正在执行工具/,
            /^✅ .* \(.*ms\)$/,
            /^📋 \*\*输出\*\*/,
            /^📋 \*\*工具输出\*\*/,
            /^❌ .* 工具执行失败/,
            /^---$/,
            /^\*\*.*\*\*/,
            /^```/,
        ]

        const result: string[] = []

        for (const line of lines) {
            // 跳过 AI 生成的格式化内容行
            const isAILine = aiPatterns.some(pattern => pattern.test(line))
            if (isAILine) {continue}

            // 跳过空行
            if (line.trim() === '') {continue}

            result.push(line)
        }

        return result
    }

    /**
     * 截断输出
     */
    private truncateOutput(text: string, maxLength: number): string {
        if (text.length <= maxLength) {return text}
        return text.substring(0, maxLength)
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;')
    }

    // ========================================================================
    // 格式检测方法
    // ========================================================================

    /**
     * 检测输出格式
     */
    private detectOutputFormat(output: string, category: ToolCategory): ToolOutputDisplay['format'] {
        // 终端输出通常是代码/命令格式
        if (category === 'terminal') {
            return 'code'
        }

        const trimmed = output.trim()

        // JSON 检测
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try {
                JSON.parse(trimmed)
                return 'json'
            } catch {
                // 不是有效 JSON，继续检测
            }
        }

        // 表格检测（包含多个 | 分隔符）
        if (output.includes('|') && output.split('|').length > 3) {
            // 检查是否是表格格式
            const lines = output.split('\n')
            if (lines.length >= 2) {
                return 'table'
            }
        }

        return 'text'
    }

    /**
     * 检测代码语言
     */
    private detectLanguage(output: string): string {
        const lower = output.toLowerCase()

        // PowerShell 检测
        if (lower.includes('ps c:\\') || lower.includes('ps>') || lower.includes('powershell')) {
            return 'powershell'
        }

        // CMD 检测
        if (lower.includes('c:\\') && lower.includes('>')) {
            return 'cmd'
        }

        // Bash 检测
        if (lower.includes('$ ') || lower.includes('/') || lower.includes('~')) {
            return 'bash'
        }

        return 'shell'
    }

    /**
     * 生成输出摘要
     */
    private generateSummary(output: string, category: ToolCategory, isError: boolean): string {
        if (isError) {
            return '执行出错'
        }

        const lines = output.split('\n').filter(l => l.trim())

        if (category === 'terminal') {
            // 检查是否成功
            if (output.includes('✅')) {
                return '命令执行成功'
            }
            if (output.includes('命令已执行')) {
                return '命令已执行'
            }
            return `${lines.length} 行输出`
        }

        return `${lines.length} 行`
    }

    // ========================================================================
    // MCP 工具辅助方法
    // ========================================================================

    /**
     * 推断 MCP 工具的分类
     */
    private inferMCPToolCategory(toolName: string): ToolCategory {
        const lower = toolName.toLowerCase()

        // 浏览器相关
        const browserKeywords = ['navigate', 'click', 'screenshot', 'browser', 'page', 'goto', 'scroll', 'type', 'fill']
        if (browserKeywords.some(kw => lower.includes(kw))) {
            return 'browser'
        }

        // 文件相关
        const fileKeywords = ['file', 'read', 'write', 'edit', 'mkdir', 'delete', 'ls', 'dir', 'cat', 'find', 'grep']
        if (fileKeywords.some(kw => lower.includes(kw))) {
            return 'file'
        }

        // 网络相关
        const networkKeywords = ['http', 'https', 'fetch', 'request', 'curl', 'wget', 'api', 'url']
        if (networkKeywords.some(kw => lower.includes(kw))) {
            return 'network'
        }

        return 'other'
    }

    /**
     * 提取 MCP 工具的友好显示名称
     * 例如: mcp_mcp-xxx_navigate_page -> Navigate Page
     */
    private extractMCPToolDisplayName(toolName: string): string {
        // 移除 mcp_ 前缀
        const withoutPrefix = toolName.replace(/^mcp_/, '')

        // 提取操作名称部分（在最后一个下划线之后）
        // 例如: mcp-xxx-navigate_page -> navigate_page -> Navigate Page
        const parts = withoutPrefix.split(/[-_]/)

        if (parts.length >= 2) {
            // 取最后两部分作为操作名称
            const actionParts = parts.slice(-2)
            return actionParts
                .map(p => p.charAt(0).toUpperCase() + p.slice(1))
                .join(' ')
        }

        // 如果只有一部分，转驼峰
        return withoutPrefix
            .split(/[-_]/)
            .map(p => p.charAt(0).toUpperCase() + p.slice(1))
            .join(' ')
    }
}
