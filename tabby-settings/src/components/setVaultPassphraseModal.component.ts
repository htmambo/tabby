import { Component, ViewChild, ElementRef, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './setVaultPassphraseModal.component.pug',
})
export class SetVaultPassphraseModalComponent {
    @Input() title = 'Set master passphrase'
    @Input() buttonLabel = 'Set passphrase'
    passphrase: string
    showPassphrase = false
    @ViewChild('input') input: ElementRef

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        setTimeout(() => {
            this.input.nativeElement.focus()
        })
    }

    ok (): void {
        if (!this.canSubmit) {
            return
        }
        this.modalInstance.close(this.passphrase)
    }

    cancel (): void {
        this.modalInstance.close(null)
    }

    get canSubmit (): boolean {
        return !!this.passphrase.trim()
    }
}
