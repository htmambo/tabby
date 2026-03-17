import { Injectable } from '@angular/core'
import {
    RiskLevel,
    RiskAssessment,
    InjectionPattern,
    MatchedInjectionPattern,
    InjectionCategory,
} from '../../types/security.types'
import { LoggerService } from '../core/logger.service'

/**
 * 风险评估服务
 * 负责评估终端命令的安全风险级别
 */
@Injectable({ providedIn: 'root' })
export class RiskAssessmentService {
    // 注入检测模式（扩展的 PIZ 风格检测规则）
    private readonly INJECTION_PATTERNS: InjectionPattern[] = [
        // 命令替换检测
        {
            pattern: /\$\([^)]*\)/,
            description: '命令替换 $(...)',
            severity: RiskLevel.CRITICAL,
            category: 'command-substitution',
        },
        {
            pattern: /`[^`]*`/,
            description: '反引号命令替换',
            severity: RiskLevel.CRITICAL,
            category: 'command-substitution',
        },
        {
            pattern: /\$\([^)]*\)[^)]*\)/,
            description: '嵌套命令替换',
            severity: RiskLevel.CRITICAL,
            category: 'command-substitution',
        },

        // 编码绕过检测
        {
            pattern: /\bbase64\b.*\|.*\b(base64|bash|sh|zsh|python|perl|ruby)\b/,
            description: 'base64 编码绕过',
            severity: RiskLevel.CRITICAL,
            category: 'encoding-bypass',
        },
        {
            pattern: /\bxxd\b.*-r.*\|/,
            description: 'xxd 十六进制解码绕过',
            severity: RiskLevel.CRITICAL,
            category: 'encoding-bypass',
        },
        {
            pattern: /printf\s+['"]?\\x[0-9a-fA-F]+/,
            description: 'printf 十六进制编码',
            severity: RiskLevel.HIGH,
            category: 'encoding-bypass',
        },
        {
            pattern: /\$'\\x[0-9a-fA-F]+/,
            description: 'ANSI-C 引用十六进制编码',
            severity: RiskLevel.HIGH,
            category: 'encoding-bypass',
        },
        {
            pattern: /eval\s+['"]\$?\(/,
            description: 'eval 动态执行',
            severity: RiskLevel.CRITICAL,
            category: 'encoding-bypass',
        },

        // 远程执行检测
        {
            pattern: /\b(curl|wget)\b.*\|\s*(bash|sh|zsh|python|perl|ruby)\b/,
            description: '远程脚本执行 (curl/wget 管道)',
            severity: RiskLevel.CRITICAL,
            category: 'remote-execution',
        },
        {
            pattern: /\b(curl|wget)\b.*>\s*\/tmp\/.*&&.*\b(bash|sh|zsh)\b/,
            description: '远程脚本下载并执行',
            severity: RiskLevel.CRITICAL,
            category: 'remote-execution',
        },
        {
            pattern: /<(?:\(|\s*\()/,
            description: '进程替换输入',
            severity: RiskLevel.HIGH,
            category: 'remote-execution',
        },
        {
            pattern: /\b(scp|rsync)\b.*@\S+:/,
            description: '远程文件复制',
            severity: RiskLevel.MEDIUM,
            category: 'remote-execution',
        },

        // 反向 shell 检测
        {
            pattern: /\/dev\/tcp\//,
            description: 'Bash /dev/tcp 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\/dev\/udp\//,
            description: 'Bash /dev/udp 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\bnc\b.*-\s*[elp]/,
            description: 'Netcat 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\bsocat\b.*TCP.*EXEC/,
            description: 'Socat 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\bpython\b.*-c.*socket.*connect/,
            description: 'Python 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\bperl\b.*-e.*socket/,
            description: 'Perl 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: /\bruby\b.*-e.*TCPSocket/,
            description: 'Ruby 反向 shell',
            severity: RiskLevel.CRITICAL,
            category: 'reverse-shell',
        },
        {
            pattern: />&\s*\d+.*<>&\d+/,
            description: '文件描述符重定向 (反向 shell 特征)',
            severity: RiskLevel.HIGH,
            category: 'reverse-shell',
        },

        // 权限提升检测
        {
            pattern: /\bsudo\b.*-i\b/,
            description: 'sudo 交互式 root shell',
            severity: RiskLevel.HIGH,
            category: 'privilege-escalation',
        },
        {
            pattern: /\bsudo\b.*-s\b/,
            description: 'sudo shell 模式',
            severity: RiskLevel.HIGH,
            category: 'privilege-escalation',
        },
        {
            pattern: /\bsu\b\s+(-|$)/,
            description: 'su 切换用户',
            severity: RiskLevel.HIGH,
            category: 'privilege-escalation',
        },
        {
            pattern: /\bpkexec\b/,
            description: 'PolKit 权限提升',
            severity: RiskLevel.HIGH,
            category: 'privilege-escalation',
        },
        {
            pattern: /\bdoas\b/,
            description: 'doas 权限提升',
            severity: RiskLevel.HIGH,
            category: 'privilege-escalation',
        },

        // 环境变量注入检测
        {
            pattern: /\bexport\s+\w+=\$/,
            description: '环境变量动态赋值',
            severity: RiskLevel.MEDIUM,
            category: 'environment-injection',
        },
        {
            pattern: /\$\{[^}]*\}/,
            description: '变量扩展 ${...}',
            severity: RiskLevel.MEDIUM,
            category: 'environment-injection',
        },
        {
            pattern: /LD_PRELOAD\s*=/,
            description: 'LD_PRELOAD 库注入',
            severity: RiskLevel.CRITICAL,
            category: 'environment-injection',
        },
        {
            pattern: /LD_LIBRARY_PATH\s*=/,
            description: 'LD_LIBRARY_PATH 库路径注入',
            severity: RiskLevel.HIGH,
            category: 'environment-injection',
        },
        {
            pattern: /PATH\s*=.*:\.:/,
            description: 'PATH 当前目录注入',
            severity: RiskLevel.HIGH,
            category: 'environment-injection',
        },
        {
            pattern: /\benv\s+-[iu]\s+\w+\s+\w+/,
            description: 'env 命令环境变量操作',
            severity: RiskLevel.MEDIUM,
            category: 'environment-injection',
        },
    ]

    // 危险模式匹配规则（原有规则保留）
    private readonly DANGEROUS_PATTERNS = [
        {
            pattern: /rm\s+-rf\s+\//,
            description: '删除根目录',
            severity: RiskLevel.CRITICAL,
        },
        {
            pattern: /sudo\s+rm/,
            description: 'sudo删除命令',
            severity: RiskLevel.CRITICAL,
        },
        {
            pattern: />\s*\/dev\/null/,
            description: '输出重定向到黑洞',
            severity: RiskLevel.HIGH,
        },
        {
            pattern: /chmod\s+777/,
            description: '危险权限修改',
            severity: RiskLevel.HIGH,
        },
        {
            pattern: /mv\s+.*\s+\//,
            description: '移动到根目录',
            severity: RiskLevel.HIGH,
        },
        {
            pattern: /fork\s*\(/,
            description: 'fork炸弹',
            severity: RiskLevel.CRITICAL,
        },
        {
            pattern: /dd\s+if=/,
            description: 'dd命令（可能危险）',
            severity: RiskLevel.HIGH,
        },
        {
            pattern: /format\s+/,
            description: '格式化命令',
            severity: RiskLevel.CRITICAL,
        },
        {
            pattern: /del\s+\/s\s+/i,
            description: 'Windows删除命令',
            severity: RiskLevel.HIGH,
        },
        {
            pattern: /rd\s+\/s\s+/i,
            description: 'Windows删除目录命令',
            severity: RiskLevel.HIGH,
        },
    ]

    // 系统修改命令
    private readonly SYSTEM_COMMANDS = [
        'rm', 'del', 'rd', 'mv', 'cp', 'chmod', 'chown', 'dd', 'fdisk',
        'mkfs', 'format', 'mount', 'umount', 'sysctl', 'echo', 'tee',
    ]

    // 网络命令（可能需要额外检查）
    private readonly NETWORK_COMMANDS = [
        'curl', 'wget', 'ssh', 'scp', 'ftp', 'telnet', 'nc', 'netcat',
    ]

    // 只读安全命令
    private readonly READONLY_COMMANDS = [
        'ls', 'cat', 'grep', 'find', 'ps', 'df', 'du', 'top', 'htop',
        'pwd', 'whoami', 'which', 'whereis', 'type', 'file', 'stat',
        'head', 'tail', 'less', 'more', 'sort', 'uniq', 'wc', 'echo',
    ]

    constructor(private logger: LoggerService) {}

    /**
     * 评估命令风险
     */
    async assessRisk(command: string): Promise<RiskLevel> {
        const assessment = await this.performAssessment(command)
        return assessment.level
    }

    /**
     * 执行详细的风险评估
     */
    async performAssessment(command: string): Promise<RiskAssessment> {
        this.logger.debug('Assessing risk for command', { command })

        const matchedPatterns: {
            pattern: string;
            match: string;
            severity: RiskLevel;
        }[] = []
        const matchedInjectionPatterns: MatchedInjectionPattern[] = []
        let maxSeverity = RiskLevel.LOW
        const reasons: string[] = []

        // 0. 检查注入模式（优先级最高）
        for (const rule of this.INJECTION_PATTERNS) {
            if (rule.pattern.test(command)) {
                const match = command.match(rule.pattern)?.[0] ?? ''
                matchedInjectionPatterns.push({
                    pattern: rule.pattern.source,
                    match,
                    severity: rule.severity,
                    category: rule.category,
                    description: rule.description,
                })
                reasons.push(`检测到注入风险 [${rule.category}]：${rule.description}`)

                if (this.getSeverityLevel(rule.severity) > this.getSeverityLevel(maxSeverity)) {
                    maxSeverity = rule.severity
                }
            }
        }

        // 1. 检查危险模式
        for (const rule of this.DANGEROUS_PATTERNS) {
            if (rule.pattern.test(command)) {
                matchedPatterns.push({
                    pattern: rule.pattern.source,
                    match: command.match(rule.pattern)?.[0] ?? '',
                    severity: rule.severity,
                })
                reasons.push(`检测到危险模式：${rule.description}`)

                if (this.getSeverityLevel(rule.severity) > this.getSeverityLevel(maxSeverity)) {
                    maxSeverity = rule.severity
                }
            }
        }

        // 2. 检查系统修改命令
        const hasSystemCommand = this.hasCommand(command, this.SYSTEM_COMMANDS)
        if (hasSystemCommand && maxSeverity < RiskLevel.MEDIUM) {
            maxSeverity = RiskLevel.MEDIUM
            reasons.push('包含系统修改命令')
        }

        // 3. 检查网络命令
        const hasNetworkCommand = this.hasCommand(command, this.NETWORK_COMMANDS)
        if (hasNetworkCommand && maxSeverity < RiskLevel.MEDIUM) {
            maxSeverity = RiskLevel.MEDIUM
            reasons.push('包含网络命令，可能涉及外部请求')
        }

        // 4. 检查是否主要是只读命令
        const hasOnlyReadonly = this.hasOnlyReadonlyCommands(command, this.READONLY_COMMANDS)
        if (hasOnlyReadonly && maxSeverity < RiskLevel.MEDIUM) {
            maxSeverity = RiskLevel.LOW
            reasons.push('仅包含只读安全命令')
        }

        // 5. 计算风险分数
        const score = this.calculateRiskScore(command, maxSeverity, matchedPatterns, matchedInjectionPatterns)

        // 6. 生成建议
        const suggestions = this.generateSuggestions(command, maxSeverity, reasons, matchedInjectionPatterns)

        const assessment: RiskAssessment = {
            level: maxSeverity,
            score,
            reasons,
            patterns: matchedPatterns,
            injectionPatterns: matchedInjectionPatterns.length > 0 ? matchedInjectionPatterns : undefined,
            suggestions,
        }

        this.logger.info('Risk assessment completed', { assessment })
        return assessment
    }

    /**
     * 检查命令中是否包含指定命令
     */
    private hasCommand(command: string, cmdList: string[]): boolean {
        const lowerCommand = command.toLowerCase()
        return cmdList.some(cmd => new RegExp(`\\b${cmd}\\b`).test(lowerCommand))
    }

    /**
     * 检查是否仅包含只读命令
     */
    private hasOnlyReadonlyCommands(command: string, readonlyCmds: string[]): boolean {
        const lowerCommand = command.toLowerCase()

        // 提取所有命令词
        const words = lowerCommand.split(/\s+/)
        const cmdWords = words.filter(word =>
            !word.startsWith('-') &&
            !word.startsWith('/') &&
            !word.startsWith('.') &&
            !/^\d+$/.test(word),
        )

        // 检查是否所有命令都在只读列表中
        return cmdWords.every(word =>
            readonlyCmds.some(cmd => word === cmd) ||
            this.isArgumentOrPath(word),
        )
    }

    /**
     * 检查是否是参数或路径
     */
    private isArgumentOrPath(word: string): boolean {
        return word.startsWith('-') ||
               word.startsWith('/') ||
               word.startsWith('./') ||
               word.startsWith('../') ||
               word.includes(':') ||
               word.includes('=') ||
               /^\d+$/.test(word)
    }

    /**
     * 计算风险分数
     */
    private calculateRiskScore(
        command: string,
        level: RiskLevel,
        patterns: { pattern: string; match: string; severity: RiskLevel }[],
        injectionPatterns: MatchedInjectionPattern[] = [],
    ): number {
        let score = 0

        // 基础分数
        switch (level) {
            case RiskLevel.CRITICAL:
                score = 90
                break
            case RiskLevel.HIGH:
                score = 70
                break
            case RiskLevel.MEDIUM:
                score = 40
                break
            case RiskLevel.LOW:
                score = 10
                break
        }

        // 根据匹配的模式调整
        score += patterns.length * 10

        // 注入模式额外加权
        score += injectionPatterns.length * 15

        // 根据注入类别严重程度调整
        const criticalCategories = new Set(['command-substitution', 'reverse-shell', 'encoding-bypass'])
        const hasCriticalInjection = injectionPatterns.some(p => criticalCategories.has(p.category))
        if (hasCriticalInjection) {
            score += 20
        }

        // 根据命令长度调整（长命令可能更复杂）
        if (command.length > 200) {
            score += 10
        }

        return Math.min(score, 100)
    }

    /**
     * 生成安全建议
     */
    private generateSuggestions(
        _command: string,
        level: RiskLevel,
        reasons: string[],
        injectionPatterns: MatchedInjectionPattern[] = [],
    ): string[] {
        const suggestions: string[] = []

        if (level === RiskLevel.CRITICAL) {
            suggestions.push('此命令非常危险，可能导致数据丢失或系统损坏')
            suggestions.push('强烈建议在执行前备份重要数据')
            suggestions.push('考虑使用更安全的替代方案')
        } else if (level === RiskLevel.HIGH) {
            suggestions.push('此命令可能修改系统或删除文件')
            suggestions.push('请确认您了解命令的作用')
            suggestions.push('建议先在测试环境中验证')
        } else if (level === RiskLevel.MEDIUM) {
            suggestions.push('此命令可能涉及系统操作')
            suggestions.push('请确保您有适当的权限')
        } else {
            suggestions.push('此命令相对安全')
        }

        // 根据具体原因添加建议
        if (reasons.some(r => r.includes('网络命令'))) {
            suggestions.push('注意网络安全，避免访问未知来源')
        }

        if (reasons.some(r => r.includes('权限'))) {
            suggestions.push('检查文件权限，避免给予过高的权限')
        }

        // 根据注入类别添加针对性建议
        const injectionCategories = new Set(injectionPatterns.map(p => p.category))

        if (injectionCategories.has('command-substitution')) {
            suggestions.push('检测到命令替换，请验证命令来源是否可信')
        }
        if (injectionCategories.has('reverse-shell')) {
            suggestions.push('检测到反向 shell 特征，请谨慎执行')
        }
        if (injectionCategories.has('remote-execution')) {
            suggestions.push('检测到远程执行，请确认目标 URL 安全')
        }
        if (injectionCategories.has('encoding-bypass')) {
            suggestions.push('检测到编码绕过，请检查是否有隐藏的恶意代码')
        }
        if (injectionCategories.has('privilege-escalation')) {
            suggestions.push('检测到权限提升操作，请确认是否需要 root 权限')
        }
        if (injectionCategories.has('environment-injection')) {
            suggestions.push('检测到环境变量操作，请确认变量值安全')
        }

        return suggestions
    }

    /**
     * 获取风险级别对应的数值
     */
    private getSeverityLevel(level: RiskLevel): number {
        switch (level) {
            case RiskLevel.LOW:
                return 1
            case RiskLevel.MEDIUM:
                return 2
            case RiskLevel.HIGH:
                return 3
            case RiskLevel.CRITICAL:
                return 4
            default:
                return 0
        }
    }

    /**
     * 检查是否为危险命令
     */
    async isDangerous(command: string): Promise<boolean> {
        const assessment = await this.performAssessment(command)
        return assessment.level === RiskLevel.HIGH || assessment.level === RiskLevel.CRITICAL
    }

    /**
     * 获取风险级别描述
     */
    getRiskLevelDescription(level: RiskLevel): string {
        switch (level) {
            case RiskLevel.LOW:
                return '低风险 - 安全命令'
            case RiskLevel.MEDIUM:
                return '中风险 - 需要注意的命令'
            case RiskLevel.HIGH:
                return '高风险 - 危险命令'
            case RiskLevel.CRITICAL:
                return '极高风险 - 极危险命令'
            default:
                return '未知风险'
        }
    }

    /**
     * 获取风险级别颜色
     */
    getRiskLevelColor(level: RiskLevel): string {
        switch (level) {
            case RiskLevel.LOW:
                return '#28a745' // 绿色
            case RiskLevel.MEDIUM:
                return '#ffc107' // 黄色
            case RiskLevel.HIGH:
                return '#fd7e14' // 橙色
            case RiskLevel.CRITICAL:
                return '#dc3545' // 红色
            default:
                return '#6c757d' // 灰色
        }
    }

    /**
     * 批量评估多个命令
     */
    async assessMultiple(commands: string[]): Promise<{ command: string; level: RiskLevel }[]> {
        const results: { command: string; level: RiskLevel }[] = []
        for (const command of commands) {
            const level = await this.assessRisk(command)
            results.push({ command, level })
        }
        return results
    }
}
