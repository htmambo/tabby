import { TestBed } from '@angular/core/testing'
import { AutoFixService, FixSuggestion, AutoFixConfig } from './auto-fix.service'
import { TerminalContextService } from '../terminal/terminal-context.service'
import { CommandGeneratorService } from './command-generator.service'
import { LoggerService } from '../core/logger.service'
import { TerminalError } from '../../types/terminal.types'
import { CommandResponse } from '../../types/ai.types'
import { Subject, Observable } from 'rxjs'

// Mock LoggerService
class MockLoggerService {
    info = jest.fn()
    error = jest.fn()
    warn = jest.fn()
    debug = jest.fn()
}

// Mock TerminalContextService
class MockTerminalContextService {
    private errorSubject = new Subject<TerminalError>()
    private commandSubject = new Subject<any>()

    onError(): Observable<TerminalError> {
        return this.errorSubject.asObservable()
    }

    onCommandExecuted(): Observable<any> {
        return this.commandSubject.asObservable()
    }

    getCurrentContext(): any {
        return {
            session: { cwd: '/home/user', shell: 'bash' },
            systemInfo: { platform: 'linux' },
        }
    }

    getLastError(): TerminalError | null {
        return null
    }

    // Test helpers
    emitError(error: TerminalError): void {
        this.errorSubject.next(error)
    }

    emitCommandResult(result: any): void {
        this.commandSubject.next(result)
    }
}

// Mock CommandGeneratorService
class MockCommandGeneratorService {
    generateFixForError = jest.fn()
}

describe('AutoFixService', () => {
    let service: AutoFixService
    let mockLogger: MockLoggerService
    let mockTerminalContext: MockTerminalContextService
    let mockCommandGenerator: MockCommandGeneratorService

    const createTestError = (type: TerminalError['type'] = 'command_not_found'): TerminalError => ({
        type,
        message: 'Command not found: foo',
        command: 'foo',
        exitCode: 127,
        timestamp: new Date(),
    })

    const createTestResponse = (): CommandResponse => ({
        command: 'sudo foo',
        explanation: 'Run with elevated privileges',
        confidence: 0.85,
    })

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                AutoFixService,
                { provide: LoggerService, useClass: MockLoggerService },
                { provide: TerminalContextService, useClass: MockTerminalContextService },
                { provide: CommandGeneratorService, useClass: MockCommandGeneratorService },
            ],
        })

        service = TestBed.inject(AutoFixService)
        mockLogger = TestBed.inject(LoggerService) as any
        mockTerminalContext = TestBed.inject(TerminalContextService) as any
        mockCommandGenerator = TestBed.inject(CommandGeneratorService) as any
    })

    afterEach(() => {
        service.clearAllRetryCounts()
    })

    it('should be created', () => {
        expect(service).toBeTruthy()
    })

    describe('Configuration', () => {
        it('should have default config', () => {
            const config = service.getConfig()

            expect(config.enabled).toBe(true)
            expect(config.maxRetries).toBe(3)
            expect(config.autoExecuteLowRisk).toBe(false)
        })

        it('should update config', () => {
            service.updateConfig({ maxRetries: 5 })

            const config = service.getConfig()
            expect(config.maxRetries).toBe(5)
        })
    })

    describe('generateFixSuggestion', () => {
        it('should generate fix suggestion for error', async () => {
            const error = createTestError()
            const response = createTestResponse()

            mockCommandGenerator.generateFixForError.mockResolvedValue(response)

            const suggestion = await service.generateFixSuggestion(error)

            expect(suggestion).toBeDefined()
            expect(suggestion!.originalCommand).toBe('foo')
            expect(suggestion!.suggestedCommand).toBe('sudo foo')
            expect(suggestion!.confidence).toBe(0.85)
        })

        it('should return null when disabled', async () => {
            service.updateConfig({ enabled: false })

            const suggestion = await service.generateFixSuggestion(createTestError())

            expect(suggestion).toBeNull()
        })

        it('should handle generation errors', async () => {
            mockCommandGenerator.generateFixForError.mockRejectedValue(new Error('API error'))

            const suggestion = await service.generateFixSuggestion(createTestError())

            expect(suggestion).toBeNull()
        })
    })

    describe('analyzeError', () => {
        it('should categorize command_not_found', () => {
            const error = createTestError('command_not_found')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('missing_command')
            expect(analysis.severity).toBe('low')
            expect(analysis.autoFixable).toBe(true)
            expect(analysis.hints.length).toBeGreaterThan(0)
        })

        it('should categorize permission_denied', () => {
            const error = createTestError('permission_denied')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('permission')
            expect(analysis.severity).toBe('medium')
            expect(analysis.autoFixable).toBe(true)
        })

        it('should categorize file_not_found', () => {
            const error = createTestError('file_not_found')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('missing_file')
            expect(analysis.severity).toBe('low')
            expect(analysis.autoFixable).toBe(true)
        })

        it('should categorize syntax_error', () => {
            const error = createTestError('syntax_error')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('syntax')
            expect(analysis.severity).toBe('low')
            expect(analysis.autoFixable).toBe(true)
        })

        it('should categorize network_error as not auto-fixable', () => {
            const error = createTestError('network_error')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('network')
            expect(analysis.severity).toBe('medium')
            expect(analysis.autoFixable).toBe(false)
        })

        it('should categorize runtime_error as high severity', () => {
            const error = createTestError('runtime_error')
            const analysis = service.analyzeError(error)

            expect(analysis.category).toBe('runtime')
            expect(analysis.severity).toBe('high')
            expect(analysis.autoFixable).toBe(false)
        })
    })

    describe('Retry Mechanism', () => {
        it('should track retry counts', () => {
            expect(service.canRetry('test-cmd')).toBe(true)

            service.recordRetry('test-cmd')
            service.recordRetry('test-cmd')
            service.recordRetry('test-cmd')

            expect(service.canRetry('test-cmd')).toBe(false)
        })

        it('should return remaining retries', () => {
            expect(service.getRemainingRetries('test-cmd')).toBe(3)

            service.recordRetry('test-cmd')
            expect(service.getRemainingRetries('test-cmd')).toBe(2)

            service.recordRetry('test-cmd')
            service.recordRetry('test-cmd')
            expect(service.getRemainingRetries('test-cmd')).toBe(0)
        })

        it('should reset retry count', () => {
            service.recordRetry('test-cmd')
            service.recordRetry('test-cmd')

            service.resetRetryCount('test-cmd')

            expect(service.getRemainingRetries('test-cmd')).toBe(3)
        })

        it('should clear all retry counts', () => {
            service.recordRetry('cmd1')
            service.recordRetry('cmd2')

            service.clearAllRetryCounts()

            expect(service.getRemainingRetries('cmd1')).toBe(3)
            expect(service.getRemainingRetries('cmd2')).toBe(3)
        })
    })

    describe('Fix Events', () => {
        it('should emit fix_suggested event', async () => {
            const response = createTestResponse()
            mockCommandGenerator.generateFixForError.mockResolvedValue(response)

            let emittedEvent: any = null
            service.fixEvents$.subscribe(event => {
                emittedEvent = event
            })

            await service.generateFixSuggestion(createTestError())

            expect(emittedEvent).not.toBeNull()
            expect(emittedEvent.type).toBe('fix_suggested')
            expect(emittedEvent.suggestion).toBeDefined()
        })
    })

    describe('Risk Level Determination', () => {
        it('should set low risk for high confidence + low severity', async () => {
            const error = createTestError('command_not_found')
            const response: CommandResponse = {
                command: 'apt install foo',
                explanation: 'Install missing command',
                confidence: 0.95,
            }

            mockCommandGenerator.generateFixForError.mockResolvedValue(response)

            const suggestion = await service.generateFixSuggestion(error)

            expect(suggestion!.riskLevel).toBe('low')
        })

        it('should set high risk for low confidence', async () => {
            const error = createTestError('runtime_error')
            const response: CommandResponse = {
                command: 'complex fix',
                explanation: 'Uncertain fix',
                confidence: 0.4,
            }

            mockCommandGenerator.generateFixForError.mockResolvedValue(response)

            const suggestion = await service.generateFixSuggestion(error)

            expect(suggestion!.riskLevel).toBe('high')
        })
    })

    describe('executeFix', () => {
        it('should record fix execution', async () => {
            const suggestion: FixSuggestion = {
                id: 'fix-1',
                originalCommand: 'foo',
                originalError: createTestError(),
                suggestedCommand: 'sudo foo',
                explanation: 'Run with sudo',
                confidence: 0.85,
                riskLevel: 'medium',
                autoExecutable: false,
            }

            const result = await service.executeFix(suggestion)

            expect(result.originalCommand).toBe('foo')
            expect(result.fixedCommand).toBe('sudo foo')
        })
    })

    describe('Max Retries Event', () => {
        it('should emit max_retries_reached event', (done) => {
            service.updateConfig({ maxRetries: 2 })

            service.fixEvents$.subscribe(event => {
                if (event.type === 'max_retries_reached') {
                    expect(event.result!.attempts).toBe(2)
                    done()
                }
            })

            // Simulate failed commands
            mockTerminalContext.emitCommandResult({
                command: 'test-cmd',
                success: false,
                exitCode: 1,
            })
            mockTerminalContext.emitCommandResult({
                command: 'test-cmd',
                success: false,
                exitCode: 1,
            })
        })
    })
})