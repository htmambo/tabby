import { Component, Input, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isButtonLikeTarget, isMenuLikeTarget, isPlainEnter, isPlainEscape } from '../utils'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './promptModal.component.pug',
})
export class PromptModalComponent {
    @Input() value: string
    @Input() prompt: string|undefined
    @Input() password: boolean
    @Input() remember: boolean
    @Input() showRememberCheckbox: boolean
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

        if (!isPlainEnter(event) || isButtonLikeTarget(event.target) || isMenuLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.ok()
    }

    ok (): void {
        this.modalInstance.close({
            value: this.value,
            remember: this.remember,
        })
    }

    cancel (): void {
        this.modalInstance.close(null)
    }
}
