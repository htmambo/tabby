import { Component, Input, ViewChild, ElementRef } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { NotificationsService, VaultFileSecret, focusElementLater } from 'tabby-core'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './showSecretModal.component.pug',
})
export class ShowSecretModalComponent {
    @Input() title: string
    @Input() secret: VaultFileSecret
    @ViewChild('closeButton', { static: true }) closeButton: ElementRef<HTMLButtonElement>

    constructor (
        public modalInstance: NgbActiveModal,
        private notifications: NotificationsService,
    ) { }

    ngOnInit (): void {
        focusElementLater(this.closeButton)
    }

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
