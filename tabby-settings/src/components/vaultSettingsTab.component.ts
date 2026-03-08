/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, HostBinding } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, VaultService, VaultSecret, Vault, PlatformService, ConfigService, VAULT_SECRET_TYPE_FILE, PromptModalComponent, VaultFileSecret, TranslateService } from 'tabby-core'
import { SetVaultPassphraseModalComponent } from './setVaultPassphraseModal.component'
import { ShowSecretModalComponent } from './showSecretModal.component'


/** @hidden */
@Component({
    standalone: false,
    selector: 'vault-settings-tab',
    templateUrl: './vaultSettingsTab.component.pug',
})
export class VaultSettingsTabComponent extends BaseComponent {
    vaultContents: Vault|null = null
    VAULT_SECRET_TYPE_FILE = VAULT_SECRET_TYPE_FILE

    @HostBinding('class.content-box') true

    constructor (
        public vault: VaultService,
        public config: ConfigService,
        private platform: PlatformService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
    ) {
        super()
        if (vault.isOpen()) {
            this.loadVault()
        }
    }

    async loadVault (): Promise<void> {
        this.vaultContents = await this.vault.load().catch(() => null)
    }

    async enableVault () {
        await this.vault.setEnabled(true)
        this.vaultContents = await this.vault.load()
    }

    async setOrChangePassphrase () {
        const vaultContents = await this.getVaultContentsForEdit()
        if (!vaultContents) {
            return
        }

        const modal = this.ngbModal.open(SetVaultPassphraseModalComponent)
        modal.componentInstance.title = this.vault.isProtected() ? 'Change the master passphrase' : 'Set a master passphrase'
        modal.componentInstance.buttonLabel = this.vault.isProtected() ? 'Change passphrase' : 'Set passphrase'

        const newPassphrase = await modal.result.catch(() => null)
        if (!newPassphrase) {
            return
        }

        await this.vault.setPassphrase(newPassphrase, vaultContents)
        this.vaultContents = await this.vault.load(newPassphrase)
    }

    async clearPassphrase () {
        if (!this.vault.isProtected()) {
            return
        }

        const vaultContents = await this.getVaultContentsForEdit()
        if (!vaultContents) {
            return
        }

        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: this.translate.instant('Clear the master passphrase and keep synced secrets?'),
            detail: this.translate.instant('SSH passwords and private key passphrases will stay in the synced Vault, but Tabby will stop asking for the master passphrase on startup. Config file encryption, if enabled, will also be disabled.'),
            buttons: [
                this.translate.instant('Clear'),
                this.translate.instant('Cancel'),
            ],
            defaultId: 1,
            cancelId: 1,
        })
        if (result.response !== 0) {
            return
        }

        await this.disableConfigEncryptionIfNeeded()
        await this.vault.clearPassphrase(vaultContents)
        this.vaultContents = await this.vault.load()
    }

    async eraseVault () {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Erase the Vault and all stored secrets?'),
                detail: this.translate.instant('All Vault secrets will be permanently deleted and cannot be recovered. Saved SSH passwords stored only in the Vault will also be deleted. Config file encryption, if enabled, will also be disabled.'),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            await this.disableConfigEncryptionIfNeeded()
            await this.vault.setEnabled(false)
            this.vault.forgetPassphrase()
            this.vaultContents = null
        }
    }

    async toggleConfigEncrypted () {
        const nextEncrypted = !this.config.store.encrypted

        if (nextEncrypted && !this.vault.isProtected()) {
            const vaultContents = await this.getVaultContentsForEdit()
            if (!vaultContents) {
                return
            }

            const modal = this.ngbModal.open(SetVaultPassphraseModalComponent)
            modal.componentInstance.title = 'Set a master passphrase to encrypt the config file'
            modal.componentInstance.buttonLabel = 'Set passphrase'

            const newPassphrase = await modal.result.catch(() => null)
            if (!newPassphrase) {
                return
            }

            await this.vault.setPassphrase(newPassphrase, vaultContents)
            this.vaultContents = await this.vault.load(newPassphrase)
        }

        this.config.store.encrypted = nextEncrypted
        try {
            await this.config.save()
        } catch (e) {
            this.config.store.encrypted = !nextEncrypted
            throw e
        }
    }

    getSecretLabel (secret: VaultSecret) {
        if (secret.type === 'ssh:password') {
            return this.translate.instant('SSH password for {user}@{host}:{port}', (secret as any).key)
        }
        if (secret.type === 'ssh:key-passphrase') {
            return this.translate.instant('Passphrase for a private key with hash {hash}...', { hash: (secret as any).key.hash.substring(0, 8) })
        }
        if (secret.type === VAULT_SECRET_TYPE_FILE) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
            return this.translate.instant('File: {description}', (secret as VaultFileSecret).key)
        }
        return this.translate.instant('Unknown secret of type {type} for {key}', { type: secret.type, key: JSON.stringify(secret.key) })
    }

    showSecret (secret: VaultSecret) {
        if (!this.vaultContents) {
            return
        }
        const modal = this.ngbModal.open(ShowSecretModalComponent)
        modal.componentInstance.title = this.getSecretLabel(secret)
        modal.componentInstance.secret = secret

    }

    removeSecret (secret: VaultSecret) {
        if (!this.vaultContents) {
            return
        }
        this.vaultContents.secrets = this.vaultContents.secrets.filter(x => x !== secret)
        this.vault.removeSecret(secret.type, secret.key)
    }

    async replaceFileContent (secret: VaultFileSecret) {
        const transfers = await this.platform.startUpload()
        if (!transfers.length) {
            return
        }
        await this.vault.updateSecret(secret, {
            ...secret,
            value: Buffer.from(await transfers[0].readAll()).toString('base64'),
        })
        this.loadVault()
    }

    async renameFile (secret: VaultFileSecret) {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = this.translate.instant('New name')
        modal.componentInstance.value = secret.key.description

        const description = (await modal.result.catch(() => null))?.value
        if (!description) {
            return
        }

        await this.vault.updateSecret(secret, {
            ...secret,
            key: {
                ...secret.key,
                description,
            },
        })

        this.loadVault()
    }

    async exportFile (secret: VaultFileSecret) {
        this.vault.forgetPassphrase()

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        secret = (await this.vault.getSecret(secret.type, secret.key)) as VaultFileSecret

        const content = Buffer.from(secret.value, 'base64')
        const download = await this.platform.startDownload(secret.key.description, 0o600, content.length)

        if (download) {
            await download.write(content as Uint8Array)
            download.close()
        }
    }

    castAny = (x: any) => x

    private async getVaultContentsForEdit (): Promise<Vault|null> {
        if (this.vaultContents) {
            return this.vaultContents
        }
        this.vaultContents = await this.vault.load().catch(() => null)
        return this.vaultContents
    }

    private async disableConfigEncryptionIfNeeded (): Promise<void> {
        if (!this.config.store.encrypted) {
            return
        }

        this.config.store.encrypted = false
        try {
            await this.config.save()
        } catch (error) {
            this.config.store.encrypted = true
            throw error
        }
    }
}
