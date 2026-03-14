import { Component, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isButtonLikeTarget, isMenuLikeTarget, isPlainEnter, isPlainEscape } from '../utils'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './unlockVaultModal.component.pug',
})
export class UnlockVaultModalComponent {
    passphrase: string
    rememberFor = 1
    rememberOptions = [1, 5, 15, 60, 1440, 10080]
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit (): void {
        this.rememberFor = parseInt(window.localStorage.vaultRememberPassphraseFor ?? 0)
        focusElementLater(this.input)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (isPlainEscape(event)) {
            event.preventDefault()
            this.cancel()
            return
        }

        if (!isPlainEnter(event) || isButtonLikeTarget(event.target) || isMenuLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.ok()
    }

    ok (): void {
        window.localStorage.vaultRememberPassphraseFor = this.rememberFor
        this.modalInstance.close({
            passphrase: this.passphrase,
            rememberFor: this.rememberFor,
        })
    }

    cancel (): void {
        this.modalInstance.close(null)
    }

    getRememberForDisplay (rememberOption: number): string {
        if (rememberOption >= 1440) {
            return `${Math.round(rememberOption/1440*10)/10} day`
        } else if (rememberOption >= 60) {
            return `${Math.round(rememberOption/60*10)/10} hour`
        } else {
            return `${rememberOption} min`
        }
    }
}
