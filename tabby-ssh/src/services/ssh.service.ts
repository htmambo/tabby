import { Injectable } from '@angular/core'
import { ConfigService, FileProvidersService, HostAppService, Platform, PlatformService, writeTextFile } from 'tabby-core'
import { SSHSession } from '../session/ssh'
import { SSHProfile } from '../api'
import { PasswordStorageService } from './passwordStorage.service'
import { sha512Hex } from '../webCrypto'
import { createTemporaryFile, type TemporaryPath } from '../utils/tempFiles'

@Injectable({ providedIn: 'root' })
export class SSHService {
    private detectedWinSCPPath: string | null

    private constructor (
        private passwordStorage: PasswordStorageService,
        private config: ConfigService,
        hostApp: HostAppService,
        private platform: PlatformService,
        private fileProviders: FileProvidersService,
    ) {
        if (hostApp.platform === Platform.Windows) {
            this.detectedWinSCPPath = platform.getWinSCPPath()
        }
    }

    getWinSCPPath (): string|undefined {
        return this.detectedWinSCPPath ?? this.config.store.ssh.winSCPPath
    }

    async generateWinSCPXTunnelURI (jumpHostProfile: SSHProfile|null): Promise<{ uri: string|null, privateKeyFile?: TemporaryPath|null }> {
        let uri = ''
        let tmpFile: TemporaryPath|null = null
        if (jumpHostProfile) {
            uri += ';x-tunnel=1'
            const jumpHostname = jumpHostProfile.options.host
            uri += `;x-tunnelhostname=${jumpHostname}`
            const jumpPort = jumpHostProfile.options.port ?? 22
            uri += `;x-tunnelportnumber=${jumpPort}`
            const jumpUsername = jumpHostProfile.options.user
            uri += `;x-tunnelusername=${jumpUsername}`
            if (jumpHostProfile.options.auth === 'password') {
                const jumpPassword = await this.passwordStorage.loadPassword(jumpHostProfile, jumpUsername)
                if (jumpPassword) {
                    uri += `;x-tunnelpasswordplain=${encodeURIComponent(jumpPassword)}`
                }
            }
            if (jumpHostProfile.options.auth === 'publicKey' && jumpHostProfile.options.privateKeys.length > 0) {
                const privateKeyPairs = await this.convertPrivateKeyFileToPuTTYFormat(jumpHostProfile)
                tmpFile = privateKeyPairs.privateKeyFile
                if (tmpFile) {
                    uri += `;x-tunnelpublickeyfile=${encodeURIComponent(tmpFile.path)}`
                }
                if (privateKeyPairs.passphrase != null) {
                    uri += `;x-tunnelpassphraseplain=${encodeURIComponent(privateKeyPairs.passphrase)}`
                }
            }
        }
        return { uri: uri, privateKeyFile: tmpFile?? null }
    }

    async getWinSCPURI (profile: SSHProfile, cwd?: string, username?: string): Promise<{ uri: string, privateKeyFile?: TemporaryPath|null }> {
        let uri = `scp://${username ?? profile.options.user}`
        const password = await this.passwordStorage.loadPassword(profile, username)
        if (password) {
            uri += ':' + encodeURIComponent(password)
        }
        let tmpFile: TemporaryPath|null = null
        if (profile.options.jumpHost) {
            const jumpHostProfile = this.config.store.profiles.find((x: { id?: string }) => x.id === profile.options.jumpHost) ?? null
            const xTunnelParams = await this.generateWinSCPXTunnelURI(jumpHostProfile)
            uri += xTunnelParams.uri ?? ''
            tmpFile = xTunnelParams.privateKeyFile ?? null
        }
        if (profile.options.host.includes(':')) {
            uri += `@[${profile.options.host}]:${profile.options.port}${cwd ?? '/'}`
        }else {
            uri += `@${profile.options.host}:${profile.options.port}${cwd ?? '/'}`
        }
        return { uri, privateKeyFile: tmpFile?? null }
    }

    async convertPrivateKeyFileToPuTTYFormat (profile: SSHProfile): Promise<{ passphrase: string|null, privateKeyFile: TemporaryPath|null }> {
        if (profile.options.privateKeys.length === 0) {
            throw new Error('No private keys in profile')
        }
        const path = this.getWinSCPPath()
        if (!path) {
            throw new Error('WinSCP not found')
        }
        let tmpPrivateKeyFile: TemporaryPath|null = null
        let passphrase: string|null = null
        const tmpFile = await createTemporaryFile('tabby-ssh-', 'winscp-key')
        for (const pk of profile.options.privateKeys) {
            let privateKeyContent: string|null = null
            const buffer = await this.fileProviders.retrieveFile(pk)
            privateKeyContent = buffer.toString()
            await writeTextFile(tmpFile.path, privateKeyContent)
            const keyHash = await sha512Hex(privateKeyContent)
            // need to pass an default passphrase, otherwise it might get stuck at the passphrase input
            const curPassphrase = await this.passwordStorage.loadPrivateKeyPassword(keyHash) ?? 'tabby'
            const winSCPcom = path.slice(0, -3) + 'com'
            try {
                await this.platform.exec(winSCPcom, ['/keygen', tmpFile.path, '-o', tmpFile.path, '--old-passphrase', curPassphrase])
            } catch (error) {
                console.warn('Could not convert private key ', error)
                continue
            }
            tmpPrivateKeyFile = tmpFile
            passphrase = curPassphrase
            break
        }
        return { passphrase, privateKeyFile: tmpPrivateKeyFile }
    }

    async launchWinSCP (session: SSHSession): Promise<void> {
        const path = this.getWinSCPPath()
        if (!path) {
            return
        }
        const winscpParms = await this.getWinSCPURI(session.profile, undefined, session.authUsername ?? undefined)
        const args = [winscpParms.uri]

        let tmpFile: TemporaryPath|null = null
        try {
            if (session.activePrivateKey && session.profile.options.privateKeys.length > 0) {
                const profile = session.profile
                const privateKeyPairs = await this.convertPrivateKeyFileToPuTTYFormat(profile)
                tmpFile = privateKeyPairs.privateKeyFile
                if (tmpFile) {
                    args.push(`/privatekey=${tmpFile.path}`)
                }
                if (privateKeyPairs.passphrase != null) {
                    args.push(`/passphrase=${privateKeyPairs.passphrase}`)
                }
            }
            await this.platform.exec(path, args)
        } finally {
            await tmpFile?.cleanup().catch(() => null)
            await winscpParms.privateKeyFile?.cleanup().catch(() => null)
        }
    }
}
