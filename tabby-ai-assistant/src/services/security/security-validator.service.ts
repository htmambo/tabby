import { Injectable } from '@angular/core'
import { RiskLevel, ValidationResult } from '../../types/security.types'
import { RiskAssessmentService } from './risk-assessment.service'
import { ConsentManagerService } from './consent-manager.service'
import { PasswordManagerService } from './password-manager.service'
import { LoggerService } from '../core/logger.service'

@Injectable({ providedIn: 'root' })
export class SecurityValidatorService {
    constructor(
        private riskAssessment: RiskAssessmentService,
        private consentManager: ConsentManagerService,
        private passwordManager: PasswordManagerService,
        private logger: LoggerService,
    ) {}

    /**
     * 验证并确认命令执行
     * @param command 要验证的命令
     * @param explanation 命令说明
     * @param _context 上下文（可选）
     * @param signal 可选的 AbortSignal，用于取消操作
     */
    async validateAndConfirm(
        command: string,
        explanation: string,
        _context?: unknown,
        signal?: AbortSignal,
    ): Promise<ValidationResult> {
        this.logger.info('Validating command', { command })

        // 🔴 检查是否已取消
        if (signal?.aborted) {
            return {
                approved: false,
                riskLevel: RiskLevel.HIGH,
                reason: 'Operation cancelled',
                timestamp: new Date(),
            }
        }

        try {
            // 1. 风险评估
            const assessment = await this.riskAssessment.performAssessment(command)
            const riskLevel = assessment.level

            this.logger.debug('Risk assessment completed', { riskLevel, score: assessment.score })

            // 🔴 风险评估后检查取消
            if (signal?.aborted) {
                return {
                    approved: false,
                    riskLevel,
                    reason: 'Operation cancelled',
                    timestamp: new Date(),
                }
            }

            // 2. 检查用户同意
            const hasConsent = await this.consentManager.hasConsent(command, riskLevel)
            if (hasConsent) {
                this.logger.info('User consent found, skipping confirmation', { command })
                return {
                    approved: true,
                    riskLevel,
                    skipConfirmation: true,
                    timestamp: new Date(),
                }
            }

            // 3. 根据风险级别进行验证
            if (riskLevel === RiskLevel.CRITICAL || riskLevel === RiskLevel.HIGH) {
                // 高风险需要密码确认
                this.logger.warn('High risk command detected, requesting password', { command })

                // 🔴 设置取消监听器
                const passwordValid = await this.withAbortSignal(
                    signal,
                    this.passwordManager.requestPassword(),
                )

                // 🔴 密码验证后检查取消
                if (signal?.aborted) {
                    return {
                        approved: false,
                        riskLevel,
                        reason: 'Operation cancelled',
                        timestamp: new Date(),
                    }
                }

                if (!passwordValid) {
                    return {
                        approved: false,
                        riskLevel,
                        reason: 'Invalid password',
                        timestamp: new Date(),
                    }
                }
            } else if (riskLevel === RiskLevel.MEDIUM) {
                // 中风险需要显式确认
                this.logger.info('Medium risk command, requesting user confirmation', { command })

                // 🔴 设置取消监听器
                const confirmed = await this.withAbortSignal(
                    signal,
                    this.consentManager.requestConsent(command, explanation, riskLevel),
                )

                // 🔴 用户确认后检查取消
                if (signal?.aborted) {
                    return {
                        approved: false,
                        riskLevel,
                        reason: 'Operation cancelled',
                        timestamp: new Date(),
                    }
                }

                if (!confirmed) {
                    return {
                        approved: false,
                        riskLevel,
                        reason: 'User cancelled',
                        timestamp: new Date(),
                    }
                }
            }

            // 4. 存储用户同意
            await this.consentManager.storeConsent(command, riskLevel)

            this.logger.info('Command validation approved', { command, riskLevel })
            return {
                approved: true,
                riskLevel,
                timestamp: new Date(),
            }

        } catch (error) {
            // 如果是取消导致的错误，返回取消结果
            if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
                return {
                    approved: false,
                    riskLevel: RiskLevel.HIGH,
                    reason: 'Operation cancelled',
                    timestamp: new Date(),
                }
            }
            this.logger.error('Command validation failed', error)
            return {
                approved: false,
                riskLevel: RiskLevel.HIGH,
                reason: error instanceof Error ? error.message : 'Validation error',
                timestamp: new Date(),
            }
        }
    }

    /**
     * 辅助方法：为 Promise 添加 AbortSignal 支持
     */
    private async withAbortSignal<T>(signal: AbortSignal | undefined, promise: Promise<T>): Promise<T> {
        if (!signal) {
            return promise
        }

        return new Promise((resolve, reject) => {
            const abortHandler = () => {
                reject(new DOMException('Operation cancelled', 'AbortError'))
            }

            signal.addEventListener('abort', abortHandler)

            promise
                .then(result => {
                    signal.removeEventListener('abort', abortHandler)
                    resolve(result)
                })
                .catch(error => {
                    signal.removeEventListener('abort', abortHandler)
                    reject(error)
                })
        })
    }

    /**
     * 检查命令是否安全
     */
    async isCommandSafe(command: string): Promise<boolean> {
        const assessment = await this.riskAssessment.performAssessment(command)
        return assessment.level === RiskLevel.LOW
    }

    /**
     * 获取风险级别
     */
    async getRiskLevel(command: string): Promise<RiskLevel> {
        return this.riskAssessment.assessRisk(command)
    }

    /**
     * 检查是否需要确认
     */
    async requiresConfirmation(command: string): Promise<boolean> {
        const assessment = await this.riskAssessment.performAssessment(command)
        const hasConsent = await this.consentManager.hasConsent(command, assessment.level)
        return !hasConsent && (assessment.level === RiskLevel.MEDIUM ||
                                assessment.level === RiskLevel.HIGH ||
                                assessment.level === RiskLevel.CRITICAL)
    }

    /**
     * 清除所有用户同意
     */
    async clearAllConsents(): Promise<void> {
        await this.consentManager.clearAllConsents()
        this.logger.info('All user consents cleared')
    }

    /**
     * 获取安全统计
     */
    async getSecurityStats(): Promise<any> {
        return {
            totalValidations: await this.consentManager.getTotalValidations(),
            activeConsents: await this.consentManager.getActiveConsentsCount(),
            passwordAttempts: this.passwordManager.getTotalAttempts(),
            failedAttempts: this.passwordManager.getFailedAttempts(),
        }
    }
}
