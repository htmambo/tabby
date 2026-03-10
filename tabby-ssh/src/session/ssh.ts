import * as fs from 'mz/fs'
import * as crypto from 'crypto'
import colors from 'ansi-colors'
import stripAnsi from 'strip-ansi'
import * as shellQuote from 'shell-quote'
import { Injector } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { ConfigService, FileProvidersService, NotificationsService, PromptModalComponent, LogService, Logger, TranslateService, Platform, HostAppService } from 'tabby-core'
import { Socket } from 'net'
import { Subject, Observable } from 'rxjs'
import { HostKeyPromptModalComponent } from '../components/hostKeyPromptModal.component'
import { PasswordStorageService } from '../services/passwordStorage.service'
import { SSHKnownHostsService } from '../services/sshKnownHosts.service'
import { SFTPSession } from './sftp'
import { SSHAlgorithmType, SSHProfile, AutoPrivateKeyLocator, PortForwardType } from '../api'
import { ForwardedPort } from './forwards'
import { X11Socket } from './x11'
import { supportedAlgorithms } from '../algorithms'
import * as russh from 'russh'

const WINDOWS_OPENSSH_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent'
const REMOTE_COMMAND_EXIT_SENTINEL = '__TABBY_REMOTE_EXIT__'
const DEFAULT_READY_TIMEOUT_MS = 20000

function escapePOSIXShellArgument (value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`
}


export interface Prompt {
    prompt: string
    echo?: boolean
}

type AuthMethod = {
    type: 'none'|'prompt-password'|'hostbased'
} | {
    type: 'keyboard-interactive',
    savedPassword?: string
} | {
    type: 'saved-password',
    password: string
} | {
    type: 'publickey'
    name: string
    contents: Buffer
} | ({
    type: 'agent',
    publicKey?: russh.SshPublicKey
} & ({
    kind: 'unix-socket',
    path: string
} | {
    kind: 'named-pipe',
    path: string
} | {
    kind: 'pageant',
}))

function sshAuthTypeForMethod (m: AuthMethod): string {
    switch (m.type) {
        case 'none': return 'none'
        case 'hostbased': return 'hostbased'
        case 'prompt-password': return 'password'
        case 'saved-password': return 'password'
        case 'keyboard-interactive': return 'keyboard-interactive'
        case 'publickey': return 'publickey'
        case 'agent': return 'publickey'
    }
}

export class KeyboardInteractivePrompt {
    readonly responses: string[] = []

    private _resolve: (value: string[]) => void
    private _reject: (reason: any) => void
    readonly promise = new Promise<string[]>((resolve, reject) => {
        this._resolve = resolve
        this._reject = reject
    })

    constructor (
        public name: string,
        public instruction: string,
        public prompts: Prompt[],
    ) {
        this.responses = new Array(this.prompts.length).fill('')
    }

    isAPasswordPrompt (index: number): boolean {
        return this.prompts[index].prompt.toLowerCase().includes('password') && !this.prompts[index].echo
    }

    respond (): void {
        this._resolve(this.responses)
    }

    reject (): void {
        this._reject(new Error('Keyboard-interactive auth rejected'))
    }
}

export class SSHSession {
    shell?: russh.Channel
    ssh: russh.SSHClient|russh.AuthenticatedSSHClient
    sftp?: russh.SFTP
    forwardedPorts: ForwardedPort[] = []
    jumpChannel: russh.NewChannel|null = null
    savedPassword?: string
    get serviceMessage$ (): Observable<string> { return this.serviceMessage }
    get keyboardInteractivePrompt$ (): Observable<KeyboardInteractivePrompt> { return this.keyboardInteractivePrompt }
    get willDestroy$ (): Observable<void> { return this.willDestroy }

    activePrivateKey: russh.KeyPair|null = null
    authUsername: string|null = null

    open = false

    private logger: Logger
    private refCount = 0
    private allAuthMethods: AuthMethod[] = []
    private serviceMessage = new Subject<string>()
    private keyboardInteractivePrompt = new Subject<KeyboardInteractivePrompt>()
    private willDestroy = new Subject<void>()

    private passwordStorage: PasswordStorageService
    private ngbModal: NgbModal
    private hostApp: HostAppService
    private notifications: NotificationsService
    private fileProviders: FileProvidersService
    private config: ConfigService
    private translate: TranslateService
    private knownHosts: SSHKnownHostsService
    private privateKeyImporters: AutoPrivateKeyLocator[]
    private previouslyDisconnected = false
    private destroying = false

    constructor (
        private injector: Injector,
        public profile: SSHProfile,
    ) {
        this.logger = injector.get(LogService).create(`ssh-${profile.options.host}-${profile.options.port}`)

        this.passwordStorage = injector.get(PasswordStorageService)
        this.ngbModal = injector.get(NgbModal)
        this.hostApp = injector.get(HostAppService)
        this.notifications = injector.get(NotificationsService)
        this.fileProviders = injector.get(FileProvidersService)
        this.config = injector.get(ConfigService)
        this.translate = injector.get(TranslateService)
        this.knownHosts = injector.get(SSHKnownHostsService)
        this.privateKeyImporters = injector.get(AutoPrivateKeyLocator, [])

        this.willDestroy$.subscribe(() => {
            for (const port of this.forwardedPorts) {
                port.stopLocalListener()
            }
        })
    }

    private addPublicKeyAuthMethod (name: string, contents: Buffer) {
        this.allAuthMethods.push({
            type: 'publickey',
            name,
            contents,
        })
    }

    async init (): Promise<void> {
        this.allAuthMethods = [{ type: 'none' }]
        if (!this.profile.options.auth || this.profile.options.auth === 'publicKey') {
            if (this.profile.options.privateKeys.length) {
                for (let pk of this.profile.options.privateKeys) {
                    // eslint-disable-next-line @typescript-eslint/init-declarations
                    let contents: Buffer
                    pk = pk.replace('%h', this.profile.options.host)
                    pk = pk.replace('%r', this.profile.options.user)
                    try {
                        contents = await this.fileProviders.retrieveFile(pk)
                    } catch (error) {
                        this.emitServiceMessage(colors.bgYellow.yellow.black(' ! ') + this.translate.instant('Could not load private key {name}: {error}', {
                            name: pk,
                            error: `${error}`,
                        }))
                        continue
                    }

                    // If the file parses as a public key, it was likely a .pub file
                    // mistakenly configured in the privateKeys list. In that case,
                    // skip it here and warn the user instead of treating it as a
                    // private key.
                    try {
                        russh.parsePublicKey(contents.toString('utf-8'))
                        this.emitServiceMessage(
                            colors.bgYellow.yellow.black(' ! ') +
                            this.translate.instant('Expected a private key, but {path} appears to be a public key. Skipping it for private key authentication.', {
                                path: pk,
                            }),
                        )
                        continue
                    } catch {
                        // Not a valid public key; treat the file contents as a private key below.
                    }

                    this.addPublicKeyAuthMethod(pk, contents)
                }
            } else {
                for (const importer of this.privateKeyImporters) {
                    for (const [name, contents] of await importer.getKeys()) {
                        this.addPublicKeyAuthMethod(name, contents)
                    }
                }
            }
        }

        if (!this.profile.options.auth || this.profile.options.auth === 'agent') {
            const spec = await this.getAgentConnectionSpec()
            if (!spec) {
                this.emitServiceMessage(colors.bgYellow.yellow.black(' ! ') + this.translate.instant('Agent auth selected, but no running Agent process is found'))
            } else {
                // If user configured specific private keys, try to load their corresponding
                // .pub files and use them first for agent-identity authentication
                if (this.profile.options.privateKeys.length) {
                    for (let pk of this.profile.options.privateKeys) {
                        pk = pk.replace('%h', this.profile.options.host)
                        pk = pk.replace('%r', this.profile.options.user)

                        // Try to load as public key file
                        let pubKeyPath = pk
                        if (!pk.endsWith('.pub')) {
                            pubKeyPath = pk + '.pub'
                        }

                        try {
                            const pubKeyContent = await this.fileProviders.retrieveFile(pubKeyPath)
                            const publicKey = russh.parsePublicKey(pubKeyContent.toString('utf-8'))
                            this.allAuthMethods.push({
                                type: 'agent',
                                ...spec,
                                publicKey,
                            } as AuthMethod)
                            this.emitServiceMessage(this.translate.instant('Loaded public key for agent auth: {path}', { path: pubKeyPath }))
                        } catch (error) {
                            // Not a public key file or doesn't exist, skip
                            this.emitServiceMessage(
                                this.translate.instant('Could not load public key for agent auth from {path}: {error}. Agent-identity authentication will not be attempted for this key.', {
                                    path: pubKeyPath,
                                    error: `${error}`,
                                }),
                            )
                        }
                    }
                }

                // Always add fallback agent auth that tries all keys
                this.allAuthMethods.push({
                    type: 'agent',
                    ...spec,
                })
            }
        }
        if (!this.profile.options.auth || this.profile.options.auth === 'password') {
            if (this.profile.options.password) {
                this.allAuthMethods.push({ type: 'saved-password', password: this.profile.options.password })
            }
        }
        if (!this.profile.options.auth || this.profile.options.auth === 'keyboardInteractive') {
            if (this.profile.options.password) {
                this.allAuthMethods.push({ type: 'keyboard-interactive', savedPassword: this.profile.options.password })
            }
            this.allAuthMethods.push({ type: 'keyboard-interactive' })
        }
        if (!this.profile.options.auth || this.profile.options.auth === 'password') {
            this.allAuthMethods.push({ type: 'prompt-password' })
        }
        this.allAuthMethods.push({ type: 'hostbased' })
    }

    private async populateStoredPasswordsForResolvedUsername (): Promise<void> {
        if (!this.authUsername) {
            return
        }

        const storedPassword = await this.passwordStorage.loadPassword(this.profile, this.authUsername)
        if (!storedPassword) {
            return
        }

        if (!this.profile.options.auth || this.profile.options.auth === 'password') {
            const hasSavedPassword = this.allAuthMethods.some(method => method.type === 'saved-password' && method.password === storedPassword)
            if (!hasSavedPassword) {
                const promptIndex = this.allAuthMethods.findIndex(method => method.type === 'prompt-password')
                const insertIndex = promptIndex >= 0 ? promptIndex : this.allAuthMethods.length
                this.allAuthMethods.splice(insertIndex, 0, { type: 'saved-password', password: storedPassword })
            }
        }

        if (!this.profile.options.auth || this.profile.options.auth === 'keyboardInteractive') {
            const existingSaved = this.allAuthMethods.find(method => method.type === 'keyboard-interactive' && method.savedPassword === storedPassword)
            if (!existingSaved) {
                const updatable = this.allAuthMethods.find(method => method.type === 'keyboard-interactive' && method.savedPassword === undefined)
                if (updatable && updatable.type === 'keyboard-interactive') {
                    updatable.savedPassword = storedPassword
                } else {
                    this.allAuthMethods.push({ type: 'keyboard-interactive', savedPassword: storedPassword })
                }
            }
        }
    }

    private async getAgentConnectionSpec (): Promise<russh.AgentConnectionSpec|null> {
        if (this.hostApp.platform === Platform.Windows) {
            if (this.config.store.ssh.agentType === 'auto') {
                let pipeExists = false
                try {
                    await fs.stat(WINDOWS_OPENSSH_AGENT_PIPE)
                    pipeExists = true
                } catch (e) {
                    if (e.code === 'EBUSY') {
                        pipeExists = true
                    }
                }

                if (pipeExists) {
                    return {
                        kind: 'named-pipe',
                        path: WINDOWS_OPENSSH_AGENT_PIPE,
                    }
                } else if (russh.isPageantRunning()) {
                    return {
                        kind: 'pageant',
                    }
                } else {
                    this.emitServiceMessage(colors.bgYellow.yellow.black(' ! ') + this.translate.instant('Agent auth selected, but no running Agent process is found'))
                }
            } else if (this.config.store.ssh.agentType === 'pageant') {
                return {
                    kind: 'pageant',
                }
            } else {
                return {
                    kind: 'named-pipe',
                    path: this.config.store.ssh.agentPath || WINDOWS_OPENSSH_AGENT_PIPE,
                }
            }
        } else {
            return {
                kind: 'unix-socket',
                path: process.env.SSH_AUTH_SOCK!,
            }
        }
        return null
    }

    async openSFTP (): Promise<SFTPSession> {
        if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
            throw new Error('Cannot open SFTP session before auth')
        }
        if (!this.sftp) {
            this.sftp = await this.ssh.activateSFTP(await this.ssh.openSessionChannel())
        }
        return new SFTPSession(this.sftp, this.injector)
    }

    async start (): Promise<void> {
        await this.init()
        const readyTimeoutMs = this.getReadyTimeoutMs()

        const algorithms = {}
        for (const key of Object.values(SSHAlgorithmType)) {
            algorithms[key] = this.profile.options.algorithms[key].filter(x => supportedAlgorithms[key].includes(x))
        }

        // eslint-disable-next-line @typescript-eslint/init-declarations
        let transport: russh.SshTransport
        if (this.profile.options.proxyCommand) {
            this.emitServiceMessage(colors.bgBlue.black(' Proxy command ') + ` Using ${this.profile.options.proxyCommand}`)

            const argv = shellQuote.parse(this.profile.options.proxyCommand)
            transport = await russh.SshTransport.newCommand(argv[0], argv.slice(1))
        } else if (this.jumpChannel) {
            transport = await russh.SshTransport.newSshChannel(this.jumpChannel.take())
            this.jumpChannel = null
        } else if (this.profile.options.socksProxyHost) {
            this.emitServiceMessage(colors.bgBlue.black(' Proxy ') + ` Using ${this.profile.options.socksProxyHost}:${this.profile.options.socksProxyPort}`)
            transport = await russh.SshTransport.newSocksProxy(
                this.profile.options.socksProxyHost,
                this.profile.options.socksProxyPort ?? 1080,
                this.profile.options.host,
                this.profile.options.port ?? 22,
            )
        } else if (this.profile.options.httpProxyHost) {
            this.emitServiceMessage(colors.bgBlue.black(' Proxy ') + ` Using ${this.profile.options.httpProxyHost}:${this.profile.options.httpProxyPort}`)
            transport = await russh.SshTransport.newHttpProxy(
                this.profile.options.httpProxyHost,
                this.profile.options.httpProxyPort ?? 8080,
                this.profile.options.host,
                this.profile.options.port ?? 22,
            )
        } else {
            transport = await russh.SshTransport.newSocket(`${this.profile.options.host.trim()}:${this.profile.options.port ?? 22}`)
        }

        this.ssh = await russh.SSHClient.connect(
            transport,
            async key => {
                if (!await this.verifyHostKey(key)) {
                    return false
                }
                this.logger.info('Host key verified')
                return true
            },
            {
                preferred: {
                    ciphers: this.profile.options.algorithms[SSHAlgorithmType.CIPHER].filter(x => supportedAlgorithms[SSHAlgorithmType.CIPHER].includes(x)),
                    kex: this.profile.options.algorithms[SSHAlgorithmType.KEX].filter(x => supportedAlgorithms[SSHAlgorithmType.KEX].includes(x)),
                    mac: this.profile.options.algorithms[SSHAlgorithmType.HMAC].filter(x => supportedAlgorithms[SSHAlgorithmType.HMAC].includes(x)),
                    key: this.profile.options.algorithms[SSHAlgorithmType.HOSTKEY].filter(x => supportedAlgorithms[SSHAlgorithmType.HOSTKEY].includes(x)),
                    compression: this.profile.options.algorithms[SSHAlgorithmType.COMPRESSION].filter(x => supportedAlgorithms[SSHAlgorithmType.COMPRESSION].includes(x)),
                },
                keepaliveIntervalSeconds: Math.round(this.profile.options.keepaliveInterval / 1000),
                keepaliveCountMax: this.profile.options.keepaliveCountMax,
                connectionTimeoutSeconds: readyTimeoutMs ? Math.max(1, Math.round(readyTimeoutMs / 1000)) : undefined,
            },
        )

        this.ssh.banner$.subscribe(banner => {
            if (!this.profile.options.skipBanner) {
                this.emitServiceMessage(banner)
            }
        })

        this.previouslyDisconnected = false
        this.ssh.disconnect$.subscribe(() => {
            if (!this.previouslyDisconnected && !this.destroying) {
                this.previouslyDisconnected = true
                // Let service messages drain
                setTimeout(() => {
                    void this.destroy()
                })
            }
        })

        // Authentication

        this.authUsername ??= this.profile.options.user
        if (!this.authUsername) {
            const modal = this.ngbModal.open(PromptModalComponent)
            modal.componentInstance.prompt = this.translate.instant('Username for {host}', { host: this.profile.options.host })
            try {
                const result = await modal.result.catch(() => null)
                this.authUsername = result?.value ?? null
            } catch {
                this.authUsername = 'root'
            }
        }

        if (this.authUsername?.startsWith('$')) {
            try {
                const result = process.env[this.authUsername.slice(1)]
                this.authUsername = result ?? this.authUsername
            } catch {
                this.authUsername = 'root'
            }
        }

        await this.populateStoredPasswordsForResolvedUsername()

        const authenticatedClient = await this.handleAuth()
        if (authenticatedClient) {
            this.ssh = authenticatedClient
        } else {
            this.ssh.disconnect()
            this.passwordStorage.deletePassword(this.profile, this.authUsername ?? undefined)
            throw new Error(this.translate.instant('Authentication rejected'))
        }

        // auth success

        if (this.savedPassword) {
            this.passwordStorage.savePassword(this.profile, this.savedPassword, this.authUsername ?? undefined)
        }

        for (const fw of this.profile.options.forwardedPorts) {
            this.addPortForward(Object.assign(new ForwardedPort(), fw))
        }

        this.open = true

        this.ssh.tcpChannelOpen$.subscribe(async event => {
            this.logger.info(`Incoming forwarded connection: ${event.clientAddress}:${event.clientPort} -> ${event.targetAddress}:${event.targetPort}`)

            if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                throw new Error('Cannot open agent channel before auth')
            }

            const channel = await this.ssh.activateChannel(event.channel)

            const forward = this.forwardedPorts.find(x => x.port === event.targetPort && x.host === event.targetAddress)
            if (!forward) {
                this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Rejected incoming forwarded connection for unrecognized port {host}:{port}', {
                    host: event.targetAddress,
                    port: event.targetPort,
                }))
                channel.close()
                return
            }

            const socket = new Socket()
            socket.connect(forward.targetPort, forward.targetAddress)
            socket.on('error', e => {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Could not forward the remote connection to {host}:{port}: {error}', {
                    host: forward.targetAddress,
                    port: forward.targetPort,
                    error: `${e}`,
                }))
                channel.close()
            })

            this.setupSocketChannelEvents(channel, socket, 'Remote forward')

            socket.on('connect', () => {
                this.logger.info('Connection forwarded')
            })
        })

        this.ssh.x11ChannelOpen$.subscribe(async event => {
            this.logger.info(`Incoming X11 connection from ${event.clientAddress}:${event.clientPort}`)
            const displaySpec = (this.config.store.ssh.x11Display || process.env.DISPLAY) ?? 'localhost:0'
            this.logger.debug(`Trying display ${displaySpec}`)

            if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                throw new Error('Cannot open agent channel before auth')
            }

            const channel = await this.ssh.activateChannel(event.channel)

            const socket = new X11Socket()
            try {
                const x11Stream = await socket.connect(displaySpec)
                this.logger.info('Connection forwarded')
                this.setupSocketChannelEvents(channel, x11Stream, 'X11 forward')
            } catch (e) {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Could not connect to the X server: {error}', { error: `${e}` }))
                this.emitServiceMessage('    ' + this.translate.instant('Tabby tried to connect to {display} based on the DISPLAY environment var ({displaySpec})', {
                    display: JSON.stringify(X11Socket.resolveDisplaySpec(displaySpec)),
                    displaySpec,
                }))
                if (process.platform === 'win32') {
                    this.emitServiceMessage('    ' + this.translate.instant('To use X forwarding, you need a local X server, e.g.:'))
                    this.emitServiceMessage('    * VcXsrv: https://sourceforge.net/projects/vcxsrv/')
                    this.emitServiceMessage('    * Xming: https://sourceforge.net/projects/xming/')
                }
                channel.close()
            }
        })

        this.ssh.agentChannelOpen$.subscribe(async newChannel => {
            if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                throw new Error('Cannot open agent channel before auth')
            }

            const channel = await this.ssh.activateChannel(newChannel)

            const spec = await this.getAgentConnectionSpec()
            if (!spec) {
                await channel.close()
                return
            }

            const agent = await russh.SSHAgentStream.connect(spec)
            channel.data$.subscribe(data => agent.write(data))
            agent.data$.subscribe(data => channel.write(data), undefined, () => channel.close())
            channel.closed$.subscribe(() => agent.close())
        })
    }

    private async verifyHostKey (key: russh.SshPublicKey): Promise<boolean> {
        this.emitServiceMessage(this.translate.instant('Host key fingerprint'))
        this.emitServiceMessage(colors.white.bgBlack(` ${key.algorithm()} `) + colors.bgBlackBright(' ' + key.fingerprint() + ' '))
        if (!this.config.store.ssh.verifyHostKeys) {
            return true
        }
        const selector = {
            host: this.profile.options.host,
            port: this.profile.options.port ?? 22,
            type: key.algorithm(),
        }

        const keyDigest = crypto.createHash('sha256').update(key.bytes()).digest('base64')

        const knownHost = this.profile.options.host ? this.knownHosts.getFor(selector) : null
        if (!knownHost || knownHost.digest !== keyDigest) {
            const modal = this.ngbModal.open(HostKeyPromptModalComponent)
            modal.componentInstance.selector = selector
            modal.componentInstance.digest = keyDigest
            return modal.result.catch(() => false)
        }
        return true
    }

    emitServiceMessage (msg: string): void {
        this.serviceMessage.next(msg)
        this.logger.info(stripAnsi(msg))
    }

    emitKeyboardInteractivePrompt (prompt: KeyboardInteractivePrompt): void {
        this.logger.info('Keyboard-interactive auth:', prompt.name, prompt.instruction)
        this.emitServiceMessage(colors.bgBlackBright(' ') + ' ' + this.translate.instant('Keyboard-interactive auth requested: {name}', { name: prompt.name }))
        if (prompt.instruction) {
            for (const line of prompt.instruction.split('\n')) {
                this.emitServiceMessage(line)
            }
        }
        this.keyboardInteractivePrompt.next(prompt)
    }

    async handleAuth (): Promise<russh.AuthenticatedSSHClient|null> {
        const subscription = this.ssh.disconnect$.subscribe(() => {
            // Auto auth and >=3 keys found
            if (!this.profile.options.auth && this.allAuthMethods.filter(x => x.type === 'publickey').length >= 3) {
                this.emitServiceMessage(this.translate.instant('The server has disconnected during authentication.'))
                this.emitServiceMessage(this.translate.instant('This may happen if too many private key authentication attemps are made.'))
                this.emitServiceMessage(this.translate.instant('You can set the specific private key for authentication in the profile settings.'))
            }
        })
        try {
            return await this._handleAuth()
        } finally {
            subscription.unsubscribe()
        }
    }

    // eslint-disable-next-line max-statements
    private async _handleAuth (): Promise<russh.AuthenticatedSSHClient|null> {
        this.activePrivateKey = null

        if (!(this.ssh instanceof russh.SSHClient)) {
            throw new Error('Wrong state for auth handling')
        }

        if (!this.authUsername) {
            throw new Error('No username')
        }

        const noneResult = await this.ssh.authenticateNone(this.authUsername)
        if (noneResult instanceof russh.AuthenticatedSSHClient) {
            return noneResult
        }

        let remainingMethods = [...this.allAuthMethods]
        let methodsLeft = noneResult.remainingMethods

        function maybeSetRemainingMethods (r: russh.AuthFailure) {
            if (r.remainingMethods.length) {
                methodsLeft = r.remainingMethods
            }
        }

        while (true) {
            const m = methodsLeft
            const method = remainingMethods.find(x => m.length === 0 || m.includes(sshAuthTypeForMethod(x)))

            if (this.previouslyDisconnected || !method) {
                return null
            }

            remainingMethods = remainingMethods.filter(x => x !== method)

            if (method.type === 'saved-password') {
                this.emitServiceMessage(this.translate.instant('Using saved password'))
                const result = await this.ssh.authenticateWithPassword(this.authUsername, method.password)
                if (result instanceof russh.AuthenticatedSSHClient) {
                    return result
                }
                maybeSetRemainingMethods(result)
            }
            if (method.type === 'prompt-password') {
                const modal = this.ngbModal.open(PromptModalComponent)
                modal.componentInstance.prompt = this.translate.instant('Password for {user}@{host}', {
                    user: this.authUsername,
                    host: this.profile.options.host,
                })
                modal.componentInstance.password = true
                modal.componentInstance.showRememberCheckbox = true

                try {
                    const promptResult = await modal.result.catch(() => null)
                    if (promptResult) {
                        if (promptResult.remember) {
                            this.savedPassword = promptResult.value
                        }
                        const result = await this.ssh.authenticateWithPassword(this.authUsername, promptResult.value)
                        if (result instanceof russh.AuthenticatedSSHClient) {
                            return result
                        }
                        maybeSetRemainingMethods(result)
                    } else {
                        continue
                    }
                } catch {
                    continue
                }
            }
            if (method.type === 'publickey') {
                try {
                    const key = await this.loadPrivateKey(method.name, method.contents)
                    this.emitServiceMessage(this.translate.instant('Trying private key: {name}', { name: method.name }))
                    const result = await this.ssh.authenticateWithKeyPair(this.authUsername, key, null)
                    if (result instanceof russh.AuthenticatedSSHClient) {
                        return result
                    }
                    maybeSetRemainingMethods(result)
                } catch (e) {
                    this.emitServiceMessage(colors.bgYellow.yellow.black(' ! ') + this.translate.instant('Failed to load private key {name}: {error}', {
                        name: method.name,
                        error: `${e}`,
                    }))
                    continue
                }
            }
            if (method.type === 'keyboard-interactive') {
                let state: russh.AuthenticatedSSHClient|russh.KeyboardInteractiveAuthenticationState = await this.ssh.startKeyboardInteractiveAuthentication(this.authUsername)

                while (true) {
                    if (state.state === 'failure') {
                        maybeSetRemainingMethods(state)
                        break
                    }

                    const prompts = state.prompts()

                    let responses: string[] = []
                    // OpenSSH can send a k-i request without prompts
                    // just respond ok to it
                    if (prompts.length > 0) {
                        const prompt = new KeyboardInteractivePrompt(
                            state.name,
                            state.instructions,
                            state.prompts(),
                        )

                        if (method.savedPassword) {
                            // eslint-disable-next-line max-depth
                            for (let i = 0; i < prompt.prompts.length; i++) {
                                // eslint-disable-next-line max-depth
                                if (prompt.isAPasswordPrompt(i)) {
                                    prompt.responses[i] = method.savedPassword
                                }
                            }
                        }

                        this.emitKeyboardInteractivePrompt(prompt)

                        try {
                            // eslint-disable-next-line @typescript-eslint/await-thenable
                            responses = await prompt.promise
                        } catch {
                            break // this loop
                        }
                    }

                    state = await this.ssh.continueKeyboardInteractiveAuthentication(responses)

                    if (state instanceof russh.AuthenticatedSSHClient) {
                        return state
                    }
                }
            }
            if (method.type === 'agent') {
                try {
                    const result = method.publicKey ? await this.ssh.authenticateWithAgentIdentity(this.authUsername, method, method.publicKey) : await this.ssh.authenticateWithAgent(this.authUsername, method)
                    if (result instanceof russh.AuthenticatedSSHClient) {
                        return result
                    }
                    maybeSetRemainingMethods(result)
                } catch (e) {
                    const identitySuffix = method.publicKey ? this.translate.instant(' with identity {identity}', {
                        identity: method.publicKey.fingerprint(),
                    }) : ''
                    this.emitServiceMessage(colors.bgYellow.yellow.black(' ! ') + this.translate.instant('Failed to authenticate using agent{suffix}: {error}', {
                        suffix: identitySuffix,
                        error: `${e}`,
                    }))
                    continue
                }
            }
        }
        return null
    }

    async addPortForward (fw: ForwardedPort): Promise<void> {
        if (fw.type === PortForwardType.Local || fw.type === PortForwardType.Dynamic) {
            await fw.startLocalListener(async (accept, reject, sourceAddress, sourcePort, targetAddress, targetPort) => {
                this.logger.info(`New connection on ${fw}`)
                if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                    this.logger.error(`Connection while unauthenticated on ${fw}`)
                    reject()
                    return
                }
                const channel = await this.ssh.activateChannel(await this.ssh.openTCPForwardChannel({
                    addressToConnectTo: targetAddress,
                    portToConnectTo: targetPort,
                    originatorAddress: sourceAddress ?? '127.0.0.1',
                    originatorPort: sourcePort ?? 0,
                }).catch(err => {
                    this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Remote has rejected the forwarded connection to {targetAddress}:{targetPort} via {forward}: {error}', {
                        targetAddress,
                        targetPort,
                        forward: `${fw}`,
                        error: `${err}`,
                    }))
                    reject()
                    throw err
                }))
                const socket = accept()

                this.setupSocketChannelEvents(channel, socket, 'Local forward')
            }).then(() => {
                this.emitServiceMessage(colors.bgGreen.black(' -> ') + this.translate.instant('Forwarded {forward}', { forward: `${fw}` }))
                this.forwardedPorts.push(fw)
            }).catch(e => {
                this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Failed to forward port {forward}: {error}', {
                    forward: `${fw}`,
                    error: `${e}`,
                }))
                throw e
            })
        }
        if (fw.type === PortForwardType.Remote) {
            if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                throw new Error('Cannot add remote port forward before auth')
            }
            try {
                await this.ssh.forwardTCPPort(fw.host, fw.port)
            } catch (err) {
                // eslint-disable-next-line @typescript-eslint/no-base-to-string
                this.emitServiceMessage(colors.bgRed.black(' X ') + this.translate.instant('Remote rejected port forwarding for {forward}: {error}', {
                    forward: `${fw}`,
                    error: `${err}`,
                }))
                return
            }
            this.emitServiceMessage(colors.bgGreen.black(' <- ') + this.translate.instant('Forwarded {forward}', { forward: `${fw}` }))
            this.forwardedPorts.push(fw)
        }
    }

    async removePortForward (fw: ForwardedPort): Promise<void> {
        if (fw.type === PortForwardType.Local || fw.type === PortForwardType.Dynamic) {
            fw.stopLocalListener()
            this.forwardedPorts = this.forwardedPorts.filter(x => x !== fw)
        }
        if (fw.type === PortForwardType.Remote) {
            if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
                throw new Error('Cannot remove remote port forward before auth')
            }
            this.ssh.stopForwardingTCPPort(fw.host, fw.port)
            this.forwardedPorts = this.forwardedPorts.filter(x => x !== fw)
        }
        this.emitServiceMessage(this.translate.instant('Stopped forwarding {forward}', { forward: `${fw}` }))
    }

    async destroy (): Promise<void> {
        if (this.destroying) {
            return
        }
        this.destroying = true
        this.open = false
        this.previouslyDisconnected = true
        this.logger.info('Destroying')
        this.willDestroy.next()
        this.willDestroy.complete()
        this.serviceMessage.complete()
        const disconnectPromise = this.ssh?.disconnect()
        await disconnectPromise?.catch(error => {
            this.logger.debug('SSH disconnect during destroy failed:', error)
        })
    }

    async executePOSIXCommand (command: string): Promise<string> {
        if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
            throw new Error('Cannot execute a remote command before auth')
        }

        const wrappedCommand = `sh -lc ${escapePOSIXShellArgument(`${command}
exit_code=$?
printf '\n${REMOTE_COMMAND_EXIT_SENTINEL}:%s\n' "$exit_code"`)}`
        const channel = await this.ssh.activateChannel(await this.ssh.openSessionChannel())
        const stdoutBuffers: Buffer[] = []
        const stderrBuffers: Buffer[] = []
        const subscriptions = [
            channel.data$.subscribe(data => stdoutBuffers.push(Buffer.from(data))),
            channel.extendedData$.subscribe(([_, data]) => stderrBuffers.push(Buffer.from(data))),
        ]

        try {
            const closed = new Promise<void>(resolve => {
                channel.closed$.subscribe(() => resolve())
            })
            await channel.requestExec(wrappedCommand)
            await closed
        } finally {
            subscriptions.forEach(x => x.unsubscribe())
            await channel.close().catch(() => null)
        }

        const stdout = Buffer.concat(stdoutBuffers as readonly Uint8Array[]).toString('utf8')
        const stderr = Buffer.concat(stderrBuffers as readonly Uint8Array[]).toString('utf8')
        const exitMarker = new RegExp(`\\n?${REMOTE_COMMAND_EXIT_SENTINEL}:(\\d+)\\s*$`)
        const match = stdout.match(exitMarker)
        if (!match) {
            throw new Error(stderr.trim() || stdout.trim() || 'Remote command did not report an exit status')
        }

        const exitCode = Number(match[1])
        const cleanedStdout = stdout.replace(exitMarker, '').trimEnd()
        if (exitCode !== 0) {
            throw new Error(stderr.trim() || cleanedStdout || `Remote command failed with exit code ${exitCode}`)
        }
        return cleanedStdout
    }

    async openShellChannel (options: { x11: boolean }): Promise<russh.Channel> {
        if (!(this.ssh instanceof russh.AuthenticatedSSHClient)) {
            throw new Error('Cannot open shell channel before auth')
        }
        const newChannel = await this.withReadyTimeout(
            this.ssh.openSessionChannel(),
            this.translate.instant('opening an SSH session channel'),
        )
        const ch = await this.withReadyTimeout(
            this.ssh.activateChannel(newChannel),
            this.translate.instant('activating the SSH session channel'),
        )
        try {
            await this.withReadyTimeout(
                ch.requestPTY('xterm-256color', {
                    columns: 80,
                    rows: 24,
                    pixHeight: 0,
                    pixWidth: 0,
                }),
                this.translate.instant('requesting a terminal from the server'),
            )
            if (options.x11) {
                await this.withReadyTimeout(
                    ch.requestX11Forwarding({
                        singleConnection: false,
                        authProtocol: 'MIT-MAGIC-COOKIE-1',
                        authCookie: crypto.randomBytes(16).toString('hex'),
                        screenNumber: 0,
                    }),
                    this.translate.instant('requesting X11 forwarding'),
                )
            }
            if (this.profile.options.agentForward) {
                await this.withReadyTimeout(
                    ch.requestAgentForwarding(),
                    this.translate.instant('requesting agent forwarding'),
                )
            }
            await this.withReadyTimeout(
                ch.requestShell(),
                this.translate.instant('waiting for the remote shell'),
            )
            return ch
        } catch (error) {
            await ch.close().catch(() => null)
            throw error
        }
    }

    private getReadyTimeoutMs (): number|null {
        const timeoutMs = Number(this.profile.options.readyTimeout)
        if (timeoutMs === 0) {
            return null
        }
        if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
            return timeoutMs
        }
        return DEFAULT_READY_TIMEOUT_MS
    }

    private async withReadyTimeout<T> (promise: Promise<T>, operation: string): Promise<T> {
        const timeoutMs = this.getReadyTimeoutMs()
        if (!timeoutMs) {
            return promise
        }

        return new Promise<T>((resolve, reject) => {
            let settled = false
            const timer = window.setTimeout(() => {
                if (settled) {
                    return
                }
                settled = true
                reject(new Error(this.translate.instant('Timed out after {timeout} ms while {operation}', {
                    timeout: timeoutMs,
                    operation,
                })))
            }, timeoutMs)

            promise.then(value => {
                if (settled) {
                    return
                }
                settled = true
                window.clearTimeout(timer)
                resolve(value)
            }, error => {
                if (settled) {
                    return
                }
                settled = true
                window.clearTimeout(timer)
                reject(error)
            })
        })
    }

    private setupSocketChannelEvents (channel: russh.Channel, socket: Socket, logPrefix: string): void {
        // Channel → Socket data flow with error handling
        channel.data$.subscribe({
            next: data => socket.write(data),
            error: err => {
                this.logger.error(`${logPrefix}: channel data error: ${err}`)
                socket.destroy()
            },
        })

        // Socket → Channel data flow with proper conversion
        socket.on('data', data => {
            try {
                channel.write(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
            } catch (err) {
                this.logger.error(`${logPrefix}: channel write error: ${err}`)
                socket.destroy(new Error(`${logPrefix}failed to write to channel: ${err}`))
            }
        })

        // Handle EOF from remote
        channel.eof$.subscribe(() => {
            this.logger.debug(`${logPrefix}: channel EOF received, ending socket`)
            socket.end()
        })

        // Handle channel close
        channel.closed$.subscribe(() => {
            this.logger.debug(`${logPrefix}: channel closed, destroying socket`)
            socket.destroy()
        })

        // Handle socket errors
        socket.on('error', err => {
            this.logger.error(`${logPrefix}: socket error: ${err}`)
            channel.close()
        })

        // Handle socket close
        socket.on('close', () => {
            this.logger.debug(`${logPrefix}: socket closed, closing channel`)
            channel.close()
        })

        // Handle EOF from local
        socket.on('end', () => {
            this.logger.debug(`${logPrefix}: socket end, sending EOF to channel`)
            channel.eof()
        })
    }

    async loadPrivateKey (name: string, privateKeyContents: Buffer): Promise<russh.KeyPair> {
        this.activePrivateKey = await this.loadPrivateKeyWithPassphraseMaybe(privateKeyContents.toString())
        return this.activePrivateKey
    }

    async loadPrivateKeyWithPassphraseMaybe (privateKey: string): Promise<russh.KeyPair> {
        const keyHash = crypto.createHash('sha512').update(privateKey).digest('hex')

        privateKey = privateKey.replaceAll('EC PRIVATE KEY', 'PRIVATE KEY')

        let triedSavedPassphrase = false
        let passphrase: string|null = null
        while (true) {
            try {
                return await russh.KeyPair.parse(privateKey, passphrase ?? undefined)
            } catch (e) {
                if (!triedSavedPassphrase) {
                    passphrase = await this.passwordStorage.loadPrivateKeyPassword(keyHash)
                    triedSavedPassphrase = true
                    continue
                }
                if ([
                    'Error: Keys(KeyIsEncrypted)',
                    'Error: Keys(SshKey(Ppk(Encrypted)))',
                    'Error: Keys(SshKey(Ppk(IncorrectMac)))',
                    'Error: Keys(SshKey(Crypto))',
                ].includes(e.toString())) {
                    await this.passwordStorage.deletePrivateKeyPassword(keyHash)

                    const modal = this.ngbModal.open(PromptModalComponent)
                    modal.componentInstance.prompt = this.translate.instant('Private key passphrase')
                    modal.componentInstance.password = true
                    modal.componentInstance.showRememberCheckbox = true

                    const result = await modal.result.catch(() => {
                        throw new Error('Passphrase prompt cancelled')
                    })

                    passphrase = result?.value
                    if (passphrase && result.remember) {
                        this.passwordStorage.savePrivateKeyPassword(keyHash, passphrase)
                    }
                } else {
                    this.notifications.error(this.translate.instant('Could not read the private key'), e.toString())
                    throw e
                }
            }
        }
    }

    ref (): void {
        this.refCount++
    }

    unref (): void {
        this.refCount--
        if (this.refCount === 0) {
            this.destroy()
        }
    }
}
