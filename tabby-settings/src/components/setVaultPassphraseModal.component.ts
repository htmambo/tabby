import { Component, ViewChild, ElementRef, Input, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isButtonLikeTarget, isPlainEnter, isPlainEscape } from 'tabby-core'

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
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        focusElementLater(this.input)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (isPlainEscape(event)) {
            event.preventDefault()
            this.cancel()
            return
        }

        if (!isPlainEnter(event) || isButtonLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.ok()
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
