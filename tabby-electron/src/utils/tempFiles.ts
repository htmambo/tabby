import { mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

export interface TemporaryPath {
    path: string
    cleanup: () => Promise<void>
}

export async function createTemporaryDirectory (prefix: string): Promise<TemporaryPath> {
    const dirPath = await mkdtemp(path.join(tmpdir(), prefix))
    return {
        path: dirPath,
        cleanup: () => rm(dirPath, { recursive: true, force: true }),
    }
}
