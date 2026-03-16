import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'

export interface TemporaryPath {
    path: string
    cleanup: () => Promise<void>
}

export async function createTemporaryFile (prefix: string, fileName = 'tempfile'): Promise<TemporaryPath> {
    const dirPath = await mkdtemp(path.join(tmpdir(), prefix))
    const filePath = path.join(dirPath, fileName)
    await writeFile(filePath, '')
    return {
        path: filePath,
        cleanup: () => rm(dirPath, { recursive: true, force: true }),
    }
}
