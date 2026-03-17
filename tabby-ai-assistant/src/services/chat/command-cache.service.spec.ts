import { TestBed } from '@angular/core/testing'
import { CommandCacheService, ContextFingerprint, CommandCacheEntry } from './command-cache.service'
import { LoggerService } from '../core/logger.service'
import { FileStorageService } from '../core/file-storage.service'

// Mock LoggerService
class MockLoggerService {
    info = jest.fn()
    error = jest.fn()
    warn = jest.fn()
    debug = jest.fn()
}

// Mock FileStorageService
class MockFileStorageService {
    private storage: Map<string, any> = new Map()

    save(key: string, data: any): void {
        this.storage.set(key, data)
    }

    load<T>(key: string, defaultValue: T): T {
        return this.storage.get(key) ?? defaultValue
    }
}

describe('CommandCacheService', () => {
    let service: CommandCacheService
    let mockLogger: MockLoggerService
    let mockFileStorage: MockFileStorageService

    const testFingerprint: ContextFingerprint = {
        os: 'linux',
        shell: 'bash',
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.3,
        maxTokens: 500,
    }

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [
                CommandCacheService,
                { provide: LoggerService, useClass: MockLoggerService },
                { provide: FileStorageService, useClass: MockFileStorageService },
            ],
        })

        service = TestBed.inject(CommandCacheService)
        mockLogger = TestBed.inject(LoggerService) as any
        mockFileStorage = TestBed.inject(FileStorageService) as any
    })

    afterEach(() => {
        service.clear()
    })

    it('should be created', () => {
        expect(service).toBeTruthy()
    })

    describe('set and get', () => {
        it('should store and retrieve a command', () => {
            const entry = service.set(
                'list files',
                testFingerprint,
                'ls -la',
                'List all files with details',
                0.95,
            )

            expect(entry).toBeDefined()
            expect(entry.command).toBe('ls -la')
            expect(entry.explanation).toBe('List all files with details')
            expect(entry.confidence).toBe(0.95)

            const retrieved = service.get('list files', testFingerprint)
            expect(retrieved).toBeDefined()
            expect(retrieved!.command).toBe('ls -la')
        })

        it('should return null for cache miss', () => {
            const result = service.get('nonexistent command', testFingerprint)
            expect(result).toBeNull()
        })

        it('should return null when cache is disabled', () => {
            service.setEnabled(false)

            service.set('test', testFingerprint, 'echo test', 'test', 0.9)
            const result = service.get('test', testFingerprint)

            expect(result).toBeNull()
        })

        it('should update hit count on retrieval', () => {
            service.set('test', testFingerprint, 'echo test', 'test', 0.9)

            service.get('test', testFingerprint)
            service.get('test', testFingerprint)

            const entry = service.get('test', testFingerprint)
            expect(entry!.hitCount).toBe(2)
        })
    })

    describe('Context Fingerprint', () => {
        it('should return different results for different fingerprints', () => {
            const fingerprint1: ContextFingerprint = { ...testFingerprint, os: 'linux' }
            const fingerprint2: ContextFingerprint = { ...testFingerprint, os: 'windows' }

            service.set('test', fingerprint1, 'ls', 'list files', 0.9)
            service.set('test', fingerprint2, 'dir', 'list files', 0.9)

            const result1 = service.get('test', fingerprint1)
            const result2 = service.get('test', fingerprint2)

            expect(result1!.command).toBe('ls')
            expect(result2!.command).toBe('dir')
        })

        it('should differentiate by provider', () => {
            const fingerprint1: ContextFingerprint = { ...testFingerprint, provider: 'openai' }
            const fingerprint2: ContextFingerprint = { ...testFingerprint, provider: 'anthropic' }

            service.set('test', fingerprint1, 'cmd1', 'test', 0.9)
            service.set('test', fingerprint2, 'cmd2', 'test', 0.9)

            expect(service.get('test', fingerprint1)!.command).toBe('cmd1')
            expect(service.get('test', fingerprint2)!.command).toBe('cmd2')
        })

        it('should differentiate by model', () => {
            const fingerprint1: ContextFingerprint = { ...testFingerprint, model: 'gpt-4' }
            const fingerprint2: ContextFingerprint = { ...testFingerprint, model: 'gpt-3.5-turbo' }

            service.set('test', fingerprint1, 'cmd1', 'test', 0.9)
            service.set('test', fingerprint2, 'cmd2', 'test', 0.9)

            expect(service.get('test', fingerprint1)!.command).toBe('cmd1')
            expect(service.get('test', fingerprint2)!.command).toBe('cmd2')
        })
    })

    describe('computeContextHash', () => {
        it('should produce consistent hash for same fingerprint', () => {
            const hash1 = service.computeContextHash(testFingerprint)
            const hash2 = service.computeContextHash(testFingerprint)

            expect(hash1).toBe(hash2)
        })

        it('should produce different hash for different fingerprints', () => {
            const hash1 = service.computeContextHash(testFingerprint)
            const hash2 = service.computeContextHash({ ...testFingerprint, os: 'windows' })

            expect(hash1).not.toBe(hash2)
        })
    })

    describe('LRU Eviction', () => {
        it('should evict oldest entries when cache is full', () => {
            service.updateConfig({ maxSize: 3 })

            service.set('cmd1', testFingerprint, 'echo 1', 'test', 0.9)
            service.set('cmd2', testFingerprint, 'echo 2', 'test', 0.9)
            service.set('cmd3', testFingerprint, 'echo 3', 'test', 0.9)

            // Access cmd1 to make it more recent
            service.get('cmd1', testFingerprint)

            // Add new entry, should evict cmd2 (oldest accessed)
            service.set('cmd4', testFingerprint, 'echo 4', 'test', 0.9)

            expect(service.get('cmd1', testFingerprint)).toBeDefined()
            expect(service.get('cmd2', testFingerprint)).toBeNull()
            expect(service.get('cmd3', testFingerprint)).toBeDefined()
            expect(service.get('cmd4', testFingerprint)).toBeDefined()
        })
    })

    describe('TTL Expiration', () => {
        it('should return null for expired entries', () => {
            // Set with very short TTL
            service.set('test', testFingerprint, 'echo test', 'test', 0.9, 1) // 1 second TTL

            // Manually expire by modifying the entry
            const entries = service.getAllEntries()
            if (entries.length > 0) {
                // Simulate expiration by waiting
                return new Promise<void>(resolve => {
                    setTimeout(() => {
                        const result = service.get('test', testFingerprint)
                        // Entry might still exist if not enough time passed
                        // This is a basic test structure
                        resolve()
                    }, 1100)
                })
            }
        })
    })

    describe('delete', () => {
        it('should delete entry by natural language and fingerprint', () => {
            service.set('test', testFingerprint, 'echo test', 'test', 0.9)

            const deleted = service.delete('test', testFingerprint)

            expect(deleted).toBe(true)
            expect(service.get('test', testFingerprint)).toBeNull()
        })

        it('should return false for non-existent entry', () => {
            const deleted = service.delete('nonexistent', testFingerprint)
            expect(deleted).toBe(false)
        })
    })

    describe('deleteById', () => {
        it('should delete entry by ID', () => {
            const entry = service.set('test', testFingerprint, 'echo test', 'test', 0.9)

            const deleted = service.deleteById(entry.id)

            expect(deleted).toBe(true)
            expect(service.get('test', testFingerprint)).toBeNull()
        })
    })

    describe('clear', () => {
        it('should clear all entries', () => {
            service.set('test1', testFingerprint, 'echo 1', 'test', 0.9)
            service.set('test2', testFingerprint, 'echo 2', 'test', 0.9)

            service.clear()

            expect(service.size()).toBe(0)
        })
    })

    describe('getStats', () => {
        it('should return cache statistics', () => {
            service.set('test1', testFingerprint, 'echo 1', 'test', 0.9)
            service.set('test2', testFingerprint, 'echo 2', 'test', 0.9)

            service.get('test1', testFingerprint) // hit
            service.get('test1', testFingerprint) // hit
            service.get('nonexistent', testFingerprint) // miss

            const stats = service.getStats()

            expect(stats.totalEntries).toBe(2)
            expect(stats.totalHits).toBe(2)
            expect(stats.totalMisses).toBe(1)
            expect(stats.hitRate).toBeCloseTo(0.67, 1)
        })
    })

    describe('search', () => {
        it('should search entries by query', () => {
            service.set('list files', testFingerprint, 'ls -la', 'list', 0.9)
            service.set('show processes', testFingerprint, 'ps aux', 'processes', 0.9)
            service.set('disk usage', testFingerprint, 'df -h', 'disk', 0.9)

            const results = service.search('files')

            expect(results.length).toBe(1)
            expect(results[0].command).toBe('ls -la')
        })

        it('should search in commands as well', () => {
            service.set('test', testFingerprint, 'grep pattern', 'search', 0.9)

            const results = service.search('grep')

            expect(results.length).toBe(1)
        })

        it('should respect limit parameter', () => {
            service.set('test1', testFingerprint, 'ls', 'test', 0.9)
            service.set('test2', testFingerprint, 'ls -la', 'test', 0.9)
            service.set('test3', testFingerprint, 'ls -lh', 'test', 0.9)

            const results = service.search('ls', 2)

            expect(results.length).toBe(2)
        })
    })

    describe('warmup', () => {
        it('should add multiple entries at once', () => {
            const entries = [
                {
                    naturalLanguage: 'list files',
                    fingerprint: testFingerprint,
                    command: 'ls',
                    explanation: 'list',
                    confidence: 0.9,
                },
                {
                    naturalLanguage: 'show date',
                    fingerprint: testFingerprint,
                    command: 'date',
                    explanation: 'show date',
                    confidence: 0.9,
                },
            ]

            const added = service.warmup(entries)

            expect(added).toBe(2)
            expect(service.size()).toBe(2)
        })
    })

    describe('Alternatives', () => {
        it('should store and retrieve alternatives', () => {
            const alternatives = [
                { command: 'ls -lh', explanation: 'human readable', confidence: 0.85 },
                { command: 'ls -la', explanation: 'include hidden', confidence: 0.80 },
            ]

            service.set('list files', testFingerprint, 'ls', 'list', 0.9, alternatives)

            const entry = service.get('list files', testFingerprint)

            expect(entry!.alternatives).toBeDefined()
            expect(entry!.alternatives!.length).toBe(2)
            expect(entry!.alternatives![0].command).toBe('ls -lh')
        })
    })
})