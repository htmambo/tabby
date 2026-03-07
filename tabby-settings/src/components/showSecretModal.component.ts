import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { NotificationsService, VaultFileSecret } from 'tabby-core'

/** @hidden */
@Component({
    templateUrl: './showSecretModal.component.pug',
})
export class ShowSecretModalComponent {
    @Input() title: string
    @Input() secret: VaultFileSecret

    constructor (
        public modalInstance: NgbActiveModal,
        private notifications: NotificationsService,
    ) { }

    close (): void {
        this.modalInstance.dismiss()
    }

    async copySecret (): Promise<void> {
        try {
            await navigator.clipboard.writeText(this.secret.value)
            this.notifications.info('Copied to clipboard')
        } catch {
            this.notifications.error('Failed to copy to clipboard')
        }
    }
}
