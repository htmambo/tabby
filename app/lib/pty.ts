import * as nodePTY from 'node-pty'
import { execFile } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { ipcMain } from 'electron'
import { getWorkingDirectoryFromPID } from 'native-process-working-directory'
import { Application } from './app'
import { UTF8Splitter } from '../../tabby-core/src/utfSplitter'
import { Subject, debounceTime } from 'rxjs'

interface PTYChildProcess {
    pid: number
    ppid: number
    command: string
}

interface MacOSNativeProcessEntry {
    pid: number
    ppid: number
    name: string
}

interface MacOSNativeProcessListModule {
    getProcessList: () => Promise<MacOSNativeProcessEntry[]>
}

interface WindowsProcessTreeNode {
    pid: number
    name: string
    children: WindowsProcessTreeNode[]
}

interface WindowsProcessTreeModule {
    getProcessTree: (pid: number, callback: (tree: WindowsProcessTreeNode | null) => void) => void
}

interface TabbyPTYSpawnOptions extends nodePTY.IPtyForkOptions {
    tabbyProfileEnv?: Record<string, string>
    tabbyTerminalEnv?: Record<string, string>
    tabbySetComSpec?: boolean
    tabbyExecutable?: string
}

let macOSNativeProcessList: MacOSNativeProcessListModule | null = null
try {
    macOSNativeProcessList = require('macos-native-processlist') as MacOSNativeProcessListModule // eslint-disable-line @typescript-eslint/no-var-requires
} catch { }

let windowsProcessTree: WindowsProcessTreeModule | null = null
try {
    windowsProcessTree = require('@tabby-gang/windows-process-tree') as WindowsProcessTreeModule // eslint-disable-line @typescript-eslint/no-var-requires
} catch { }

function mergeEnv (...envs: Array<Record<string, string | undefined> | undefined>): Record<string, string> {
    const result: Record<string, string> = {}
    const keyMap: Record<string, string> = {}
    for (const env of envs) {
        if (!env) {
            continue
        }
        for (const [key, value] of Object.entries(env)) {
            if (value === undefined) {
                continue
            }
            const lookup = key.toLowerCase()
            keyMap[lookup] ??= key
            result[keyMap[lookup]] = value
        }
    }
    return result
}

function substituteEnv (
    env: Record<string, string> | undefined,
    platform: NodeJS.Platform,
    baseEnv: NodeJS.ProcessEnv,
): Record<string, string> {
    const resolvedEnv = { ...(env ?? {}) }
    const pattern = platform === 'win32' ? /%(\w+)%/g : /\$(\w+)\b/g
    for (const [key, value] of Object.entries(resolvedEnv)) {
        resolvedEnv[key] = value.replace(pattern, (_substring, envName: string) => {
            if (platform === 'win32') {
                return Object.entries(baseEnv).find(([entryKey]) => entryKey.toLowerCase() === envName.toLowerCase())?.[1] ?? ''
            }
            return baseEnv[envName] ?? ''
        })
    }
    return resolvedEnv
}

function normalizeSpawnOptions (options: TabbyPTYSpawnOptions): nodePTY.IPtyForkOptions {
    const {
        tabbyProfileEnv,
        tabbyTerminalEnv,
        tabbySetComSpec,
        tabbyExecutable,
        ...ptyOptions
    } = options

    let env = mergeEnv(
        process.env,
        ptyOptions.env as Record<string, string | undefined> | undefined,
        substituteEnv(tabbyProfileEnv, process.platform, process.env),
        tabbyTerminalEnv,
    )

    if (process.platform === 'win32' && tabbySetComSpec && tabbyExecutable) {
        env = mergeEnv(env, { COMSPEC: tabbyExecutable })
    }

    if (process.platform === 'darwin' && !process.env.LC_ALL) {
        const locale = process.env.LC_CTYPE ?? 'en_US.UTF-8'
        env = mergeEnv(env, {
            LANG: locale,
            LC_ALL: locale,
            LC_MESSAGES: locale,
            LC_NUMERIC: locale,
            LC_COLLATE: locale,
            LC_MONETARY: locale,
        })
    }

    delete env['']

    return {
        ...ptyOptions,
        env,
    }
}

class PTYDataQueue {
    private buffers: Buffer[] = []
    private delta = 0
    private maxChunk = 1024 * 100
    private maxDelta = this.maxChunk * 5
    private flowPaused = false
    private decoder = new UTF8Splitter()
    private output$ = new Subject<Buffer>()

    constructor (private pty: nodePTY.IPty, private onData: (data: Buffer) => void) {
        this.output$.pipe(debounceTime(500)).subscribe(() => {
            const remainder = this.decoder.flush()
            if (remainder.length) {
                this.onData(remainder)
            }
        })
    }

    push (data: Buffer) {
        this.buffers.push(data)
        this.maybeEmit()
    }

    ack (length: number) {
        this.delta -= length
        this.maybeEmit()
    }

    private maybeEmit () {
        if (this.delta <= this.maxDelta && this.flowPaused) {
            this.resume()
            return
        }
        if (this.buffers.length > 0) {
            if (this.delta > this.maxDelta && !this.flowPaused) {
                this.pause()
                return
            }

            const buffersToSend = []
            let totalLength = 0
            while (totalLength < this.maxChunk && this.buffers.length) {
                totalLength += this.buffers[0].length
                buffersToSend.push(this.buffers.shift())
            }

            if (buffersToSend.length === 0) {
                return
            }

            let toSend = Buffer.concat(buffersToSend)
            if (toSend.length > this.maxChunk) {
                this.buffers.unshift(toSend.slice(this.maxChunk))
                toSend = toSend.slice(0, this.maxChunk)
            }
            this.emitData(toSend)
            this.delta += toSend.length

            if (this.buffers.length) {
                const emitHandle = setImmediate(() => this.maybeEmit())
                if (typeof (emitHandle as any)?.unref === 'function') {
                    (emitHandle as any).unref()
                }
            }
        }
    }

    private emitData (data: Buffer) {
        const validChunk = this.decoder.write(data)
        this.onData(validChunk)
        this.output$.next(validChunk)
    }

    private pause () {
        this.pty.pause()
        this.flowPaused = true
    }

    private resume () {
        this.pty.resume()
        this.flowPaused = false
        this.maybeEmit()
    }
}

export class PTY {
    private pty: nodePTY.IPty
    private outputQueue: PTYDataQueue
    exited = false

    constructor (private id: string, private app: Application, ...args: any[]) {
        const normalizedArgs = [...args]
        if (normalizedArgs[2] && typeof normalizedArgs[2] === 'object') {
            normalizedArgs[2] = normalizeSpawnOptions(normalizedArgs[2] as TabbyPTYSpawnOptions)
        }
        this.pty = (nodePTY as any).spawn(...normalizedArgs)
        for (const key of ['close', 'exit']) {
            (this.pty as any).on(key, (...eventArgs) => this.emit(key, ...eventArgs))
        }

        this.outputQueue = new PTYDataQueue(this.pty, data => {
            const dataHandle = setImmediate(() => this.emit('data', data))
            if (typeof (dataHandle as any)?.unref === 'function') {
                (dataHandle as any).unref()
            }
        })

        this.pty.onData(data => this.outputQueue.push(Buffer.from(data)))
        this.pty.onExit(() => {
            this.exited = true
        })
    }

    getPID (): number {
        return this.pty.pid
    }

    resize (columns: number, rows: number): void {
        if ((this.pty as any)._writable) {
            this.pty.resize(columns, rows)
        }
    }

    write (buffer: Buffer): void {
        if ((this.pty as any)._writable) {
            this.pty.write(buffer as any)
        }
    }

    ackData (length: number): void {
        this.outputQueue.ack(length)
    }

    kill (signal?: string): void {
        this.pty.kill(signal)
    }

    private emit (event: string, ...args: any[]) {
        this.app.broadcast(`pty:${this.id}:${event}`, ...args)
    }
}

export class PTYManager {
    private ptys: Record<string, PTY|undefined> = {}
    private truePIDCache: Record<string, Promise<number>|undefined> = {}

    private async getChildProcessesByPID (parentPID: number): Promise<PTYChildProcess[]> {
        if (!parentPID) {
            return []
        }

        if (process.platform === 'darwin' && macOSNativeProcessList) {
            const processes = await macOSNativeProcessList.getProcessList()
            return processes
                .filter(processInfo => processInfo.ppid === parentPID)
                .map(processInfo => ({
                    pid: processInfo.pid,
                    ppid: processInfo.ppid,
                    command: processInfo.name,
                }))
        }

        if (process.platform === 'win32' && windowsProcessTree) {
            return new Promise<PTYChildProcess[]>(resolve => {
                windowsProcessTree!.getProcessTree(parentPID, tree => {
                    resolve(tree ? tree.children.map(child => ({
                        pid: child.pid,
                        ppid: tree.pid,
                        command: child.name,
                    })) : [])
                })
            })
        }

        return new Promise<PTYChildProcess[]>((resolve, reject) => {
            execFile('ps', ['-o', 'pid=,ppid=,comm=', '-ax'], (error, stdout) => {
                if (error) {
                    reject(error)
                    return
                }

                const processes = stdout
                    .split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                        const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
                        if (!match) {
                            return null
                        }
                        return {
                            pid: Number(match[1]),
                            ppid: Number(match[2]),
                            command: match[3],
                        } satisfies PTYChildProcess
                    })
                    .filter((processInfo): processInfo is PTYChildProcess => !!processInfo)
                    .filter(processInfo => processInfo.ppid === parentPID)

                resolve(processes)
            })
        })
    }

    private async resolveTruePID (id: string): Promise<number> {
        if (this.truePIDCache[id]) {
            return this.truePIDCache[id]!
        }

        this.truePIDCache[id] = (async () => {
            let pid = this.ptys[id]?.getPID()
            if (!pid) {
                throw new Error(`PTY ${id} is not available`)
            }

            await new Promise(resolve => {
                const timer = setTimeout(resolve, 2000)
                if (typeof timer === 'object' && typeof timer.unref === 'function') {
                    timer.unref()
                }
            })

            let processes = await this.getChildProcessesByPID(pid)
            while (pid && processes.length === 1) {
                const childPID = processes[0]?.pid
                if (!childPID) {
                    break
                }
                pid = childPID
                processes = await this.getChildProcessesByPID(pid)
            }

            return pid
        })()

        this.truePIDCache[id] = this.truePIDCache[id]!.catch(error => {
            delete this.truePIDCache[id]
            throw error
        })

        return this.truePIDCache[id]!
    }

    init (app: Application): void {
        ipcMain.on('pty:spawn', (event, ...options) => {
            const id = uuidv4().toString()
            event.returnValue = id
            delete this.truePIDCache[id]
            this.ptys[id] = new PTY(id, app, ...options)
        })

        ipcMain.on('pty:exists', (event, id) => {
            event.returnValue = !!this.ptys[id] && !this.ptys[id]!.exited
        })

        ipcMain.on('pty:get-pid', (event, id) => {
            event.returnValue = this.ptys[id]?.getPID()
        })

        ipcMain.on('pty:resize', (_event, id, columns, rows) => {
            this.ptys[id]?.resize(columns, rows)
        })

        ipcMain.on('pty:write', (_event, id, data) => {
            this.ptys[id]?.write(Buffer.from(data))
        })

        ipcMain.on('pty:kill', (_event, id, signal) => {
            this.ptys[id]?.kill(signal)
        })

        ipcMain.on('pty:ack-data', (_event, id, length) => {
            this.ptys[id]?.ackData(length)
        })

        ipcMain.handle('pty:get-true-pid', async (_event, id) => {
            return this.resolveTruePID(id)
        })

        ipcMain.handle('pty:get-child-processes', async (_event, id) => {
            const truePID = await this.resolveTruePID(id)
            return this.getChildProcessesByPID(truePID)
        })

        ipcMain.handle('pty:get-working-directory', async (_event, id) => {
            const truePID = await this.resolveTruePID(id)
            return getWorkingDirectoryFromPID(truePID)
        })
    }
}
