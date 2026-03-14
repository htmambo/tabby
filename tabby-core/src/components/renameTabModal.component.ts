/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, ElementRef, ViewChild, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isButtonLikeTarget, isPlainEnter, isPlainEscape } from '../utils'

/** @hidden */
@Component({
    standalone: false,
    selector: 'rename-tab-modal',
    templateUrl: './renameTabModal.component.pug',
})
export class RenameTabModalComponent {
    @Input() value: string
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>

    constructor (
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit () {
        focusElementLater(this.input, { delay: 250, select: true })
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (isPlainEscape(event)) {
            event.preventDefault()
            this.close()
            return
        }

        if (!isPlainEnter(event) || isButtonLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.save()
    }

    save () {
        this.modalInstance.close(this.value)
    }

    close () {
        this.modalInstance.dismiss()
    }
}
