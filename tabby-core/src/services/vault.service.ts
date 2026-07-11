import { Injectable, NgZone } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AsyncSubject, Subject, Observable, lastValueFrom } from 'rxjs'
import { wrapPromise, serializeFunction } from '../utils'
import { UnlockVaultModalComponent } from '../components/unlockVaultModal.component'
import { NotificationsService } from './notifications.service'
import { SelectorService } from './selector.service'
import { FileProvider } from '../api/fileProvider'
import { PlatformService } from '../api/platform'

const PBKDF_ITERATIONS = 100000
const PBKDF_SALT_LENGTH = 64 / 8
const CRYPT_KEY_LENGTH = 256 / 8
const CRYPT_IV_LENGTH = 128 / 8
const PBKDF_HASH = 'SHA-512'
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export interface EncryptedStoredVault {
    version: number
    contents: string
    keySalt: string
    iv: string
}

export interface PlainStoredVault {
    version: number
    plaintext: Vault
}

export type StoredVault = EncryptedStoredVault|PlainStoredVault

export interface VaultSecret {
    type: string
    key: VaultSecretKey
    value: string
}

export interface VaultFileSecret extends VaultSecret {
    key: {
        id: string
        description: string
    }
}

export interface Vault {
    config: any
    secrets: VaultSecret[]
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface VaultSecretKey { }

function migrateVaultContent (content: any): Vault {
    return {
        config: content.config,
        secrets: content.secrets ?? [],
    }
}

function isEncryptedStoredVault (store: StoredVault|null|undefined): store is EncryptedStoredVault {
    return !!store
        && typeof (store as EncryptedStoredVault).contents === 'string'
        && typeof (store as EncryptedStoredVault).keySalt === 'string'
        && typeof (store as EncryptedStoredVault).iv === 'string'
}

function isPlainStoredVault (store: StoredVault|null|undefined): store is PlainStoredVault {
    return !!store && typeof (store as PlainStoredVault).plaintext === 'object'
}

function createPlainStoredVault (content: Vault): PlainStoredVault {
    return {
        version: 1,
        plaintext: content,
    }
}

function getCrypto (): Crypto {
    if (!globalThis.crypto?.subtle) {
        throw new Error('Web Crypto API is unavailable')
    }
    return globalThis.crypto
}

function getRandomBytes (length: number): Uint8Array {
    const bytes = new Uint8Array(length)
    getCrypto().getRandomValues(bytes)
    return bytes
}

function bytesToHex (bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes (value: string): Uint8Array {
    const bytes = new Uint8Array(value.length / 2)
    for (let i = 0; i < value.length; i += 2) {
        bytes[i / 2] = parseInt(value.slice(i, i + 2), 16)
    }
    return bytes
}

function bytesToBase64 (bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

function base64ToBytes (value: string): Uint8Array {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}

function toArrayBuffer (bytes: Uint8Array): ArrayBuffer {
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)
    return copy.buffer
}

async function deriveVaultKey (passphrase: string, salt: Uint8Array): Promise<Uint8Array> {
    const crypto = getCrypto()
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(textEncoder.encode(passphrase)),
        'PBKDF2',
        false,
        ['deriveBits'],
    )

    const keyBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: toArrayBuffer(salt),
            iterations: PBKDF_ITERATIONS,
            hash: PBKDF_HASH,
        },
        keyMaterial,
        CRYPT_KEY_LENGTH * 8,
    )

    return new Uint8Array(keyBits)
}

async function importVaultCipherKey (key: Uint8Array, usages: KeyUsage[]): Promise<CryptoKey> {
    return getCrypto().subtle.importKey(
        'raw',
        toArrayBuffer(key),
        {
            name: 'AES-CBC',
            length: CRYPT_KEY_LENGTH * 8,
        },
        false,
        usages,
    )
}

async function encryptVault (content: Vault, passphrase: string): Promise<EncryptedStoredVault> {
    const keySalt = getRandomBytes(PBKDF_SALT_LENGTH)
    const iv = getRandomBytes(CRYPT_IV_LENGTH)
    const key = await deriveVaultKey(passphrase, keySalt)
    const cipherKey = await importVaultCipherKey(key, ['encrypt'])

    const plaintext = textEncoder.encode(JSON.stringify(content))
    const encrypted = new Uint8Array(await getCrypto().subtle.encrypt(
        {
            name: 'AES-CBC',
            iv: toArrayBuffer(iv),
        },
        cipherKey,
        toArrayBuffer(plaintext),
    ))

    return {
        version: 1,
        contents: bytesToBase64(encrypted),
        keySalt: bytesToHex(keySalt),
        iv: bytesToHex(iv),
    }
}

async function decryptVault (vault: EncryptedStoredVault, passphrase: string): Promise<Vault> {
    if (vault.version !== 1) {
        throw new Error(`Unsupported vault format version ${vault.version}`)
    }

    const keySalt = hexToBytes(vault.keySalt)
    const key = await deriveVaultKey(passphrase, keySalt)
    const iv = hexToBytes(vault.iv)
    const encrypted = base64ToBytes(vault.contents)
    const cipherKey = await importVaultCipherKey(key, ['decrypt'])

    const plaintext = await getCrypto().subtle.decrypt(
        {
            name: 'AES-CBC',
            iv: toArrayBuffer(iv),
        },
        cipherKey,
        toArrayBuffer(encrypted),
    )

    return migrateVaultContent(JSON.parse(textDecoder.decode(new Uint8Array(plaintext))))
}

export const VAULT_SECRET_TYPE_FILE = 'file'

// Don't make it accessible through VaultService fields
let _rememberedPassphrase: string|null = null
let _rememberedPassphraseTimeout: ReturnType<typeof setTimeout> | null = null

@Injectable({ providedIn: 'root' })
export class VaultService {
    /** Fires once when the config is loaded */
    get ready$ (): Observable<boolean> { return this.ready }

    get contentChanged$ (): Observable<void> { return this.contentChanged }

    store: StoredVault|null = null
    private ready = new AsyncSubject<boolean>()
    private contentChanged = new Subject<void>()

    /** @hidden */
    private constructor (
        private zone: NgZone,
        private notifications: NotificationsService,
        private ngbModal: NgbModal,
    ) {
        this.getPassphrase = serializeFunction(this.getPassphrase.bind(this))
    }

    async setEnabled (enabled: boolean, passphrase?: string): Promise<void> {
        if (enabled) {
            if (!this.store) {
                await this.save(migrateVaultContent({}), passphrase)
            }
        } else {
            this.store = null
            this.forgetPassphrase()
            this.contentChanged.next()
        }
    }

    isEnabled (): boolean {
        return !!this.store
    }

    isProtected (): boolean {
        return isEncryptedStoredVault(this.store)
    }

    isOpen (): boolean {
        return this.isEnabled() && (!this.isProtected() || !!_rememberedPassphrase)
    }

    forgetPassphrase (): void {
        _rememberedPassphrase = null
        if (_rememberedPassphraseTimeout !== null) {
            clearTimeout(_rememberedPassphraseTimeout)
            _rememberedPassphraseTimeout = null
        }
    }

    async decrypt (storage: StoredVault, passphrase?: string): Promise<Vault> {
        if (!isEncryptedStoredVault(storage)) {
            return migrateVaultContent(storage.plaintext)
        }

        if (!passphrase) {
            passphrase = await this.getPassphrase()
        }
        try {
            return await wrapPromise(this.zone, decryptVault(storage, passphrase))
        } catch (e) {
            this.forgetPassphrase()
            if (e.toString().includes('BAD_DECRYPT')) {
                this.notifications.error('Incorrect passphrase')
            }
            throw e
        }
    }

    async load (passphrase?: string): Promise<Vault|null> {
        if (!this.store) {
            return null
        }
        if (isPlainStoredVault(this.store)) {
            return migrateVaultContent(this.store.plaintext)
        }
        return this.decrypt(this.store, passphrase)
    }

    async encrypt (vault: Vault, passphrase?: string): Promise<EncryptedStoredVault> {
        if (!passphrase) {
            passphrase = await this.getPassphrase()
        }
        _rememberedPassphrase = passphrase
        return wrapPromise(this.zone, encryptVault(vault, passphrase))
    }

    async save (vault: Vault, passphrase?: string): Promise<void> {
        await lastValueFrom(this.ready$)
        if (passphrase !== undefined) {
            this.store = passphrase ? await this.encrypt(vault, passphrase) : createPlainStoredVault(vault)
        } else if (this.isProtected()) {
            this.store = await this.encrypt(vault)
        } else {
            this.store = createPlainStoredVault(vault)
        }
        this.contentChanged.next()
    }

    async setPassphrase (passphrase: string, vault?: Vault|null): Promise<void> {
        await lastValueFrom(this.ready$)
        vault ??= await this.load()
        if (!vault) {
            return
        }
        this.store = await this.encrypt(vault, passphrase)
        this.contentChanged.next()
    }

    async clearPassphrase (vault?: Vault|null): Promise<void> {
        await lastValueFrom(this.ready$)
        vault ??= await this.load()
        if (!vault) {
            return
        }
        this.store = createPlainStoredVault(vault)
        this.forgetPassphrase()
        this.contentChanged.next()
    }

    async getPassphrase (): Promise<string> {
        if (!_rememberedPassphrase) {
            const modal = this.ngbModal.open(UnlockVaultModalComponent)
            const result = await modal.result.catch(() => null)
            if (!result) {
                throw new Error('Vault unlock cancelled')
            }
            const { passphrase, rememberFor } = result
            if (_rememberedPassphraseTimeout !== null) {
                clearTimeout(_rememberedPassphraseTimeout)
            }
            _rememberedPassphraseTimeout = setTimeout(() => {
                _rememberedPassphrase = null
                _rememberedPassphraseTimeout = null
                // avoid multiple consequent prompts
            }, Math.max(1000, rememberFor * 60000))
            _rememberedPassphrase = passphrase
        }

        return _rememberedPassphrase!
    }

    async getSecret (type: string, key: VaultSecretKey): Promise<VaultSecret|null> {
        await lastValueFrom(this.ready$)
        const vault = await this.load()
        if (!vault) {
            return null
        }
        let vaultSecret = vault.secrets.find(s => s.type === type && this.keyMatches(key, s))
        if (!vaultSecret) {
            // search for secret without host in vault (like a default user/password used in multiple servers)
            ;(key as Record<string, unknown>)['host'] = null
            vaultSecret = vault.secrets.find(s => s.type === type && this.keyMatches(key, s))
        }
        return vaultSecret ?? null
    }

    async addSecret (secret: VaultSecret): Promise<void> {
        await lastValueFrom(this.ready$)
        const vault = await this.load()
        if (!vault) {
            return
        }
        vault.secrets = vault.secrets.filter(s => s.type !== secret.type || !this.keyMatches(secret.key, s))
        vault.secrets.push(secret)
        await this.save(vault)
    }

    async updateSecret (secret: VaultSecret, update: VaultSecret): Promise<void> {
        await lastValueFrom(this.ready$)
        const vault = await this.load()
        if (!vault) {
            return
        }
        const target = vault.secrets.find(s => s.type === secret.type && this.keyMatches(secret.key, s))
        if (!target) {
            return
        }
        Object.assign(target, update)
        await this.save(vault)
    }

    async removeSecret (type: string, key: VaultSecretKey): Promise<void> {
        await lastValueFrom(this.ready$)
        const vault = await this.load()
        if (!vault) {
            return
        }
        vault.secrets = vault.secrets.filter(s => s.type !== type || !this.keyMatches(key, s))
        await this.save(vault)
    }

    private keyMatches (key: VaultSecretKey, secret: VaultSecret): boolean {
        const secretKey = secret.key as Record<string, unknown>
        const matchKey = key as Record<string, unknown>
        return Object.keys(key).every(k => secretKey[k] === matchKey[k])
    }

    setStore (store: StoredVault|null): void {
        this.store = store
        this.ready.next(true)
        this.ready.complete()
    }
}


@Injectable()
export class VaultFileProvider extends FileProvider {
    name = 'Vault'
    prefix = 'vault://'

    constructor (
        private vault: VaultService,
        private platform: PlatformService,
        private selector: SelectorService,
    ) {
        super()
    }

    async isAvailable (): Promise<boolean> {
        return this.vault.isEnabled()
    }

    async selectAndStoreFile (description: string): Promise<string> {
        const vault = await this.vault.load()
        if (!vault) {
            throw new Error('Vault is locked')
        }
        const files = vault.secrets.filter(x => x.type === VAULT_SECRET_TYPE_FILE) as VaultFileSecret[]
        if (files.length) {
            const result = await this.selector.show<VaultFileSecret|null>('Select file', [
                {
                    name: 'Add a new file',
                    icon: 'fas fa-plus',
                    result: null,
                },
                ...files.map(f => ({
                    name: f.key.description,
                    icon: 'fas fa-file',
                    result: f,
                })),
            ]).catch(() => null)
            if (result) {
                return `${this.prefix}${result.key.id}`
            }
        }
        return this.addNewFile(description)
    }

    async addNewFile (description: string): Promise<string> {
        const transfers = await this.platform.startUpload()
        if (!transfers.length) {
            throw new Error('Nothing selected')
        }
        const transfer = transfers[0]
        const id = bytesToHex(getRandomBytes(32))
        await this.vault.addSecret({
            type: VAULT_SECRET_TYPE_FILE,
            key: {
                id,
                description: `${description} (${transfer.getName()})`,
            },
            value: Buffer.from(await transfer.readAll()).toString('base64'),
        })
        return `${this.prefix}${id}`
    }

    async retrieveFile (key: string): Promise<Buffer> {
        if (!key.startsWith(this.prefix)) {
            throw new Error('Incorrect type')
        }
        const secret = await this.vault.getSecret(VAULT_SECRET_TYPE_FILE, { id: key.substring(this.prefix.length) })
        if (!secret) {
            throw new Error('Not found')
        }
        return Buffer.from(secret.value, 'base64')
    }
}
