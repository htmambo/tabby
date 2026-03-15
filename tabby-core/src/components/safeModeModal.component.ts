import { Component, Input, ViewChild, ElementRef } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater } from '../utils'
import { getRendererSafeModeReason } from '../api/rendererState'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './safeModeModal.component.pug',
})
export class SafeModeModalComponent {
    @Input() error: Error
    @ViewChild('closeButton', { static: true }) closeButton: ElementRef<HTMLButtonElement>

    constructor (
        public modalInstance: NgbActiveModal,
    ) {
        this.error = getRendererSafeModeReason() ?? new Error('Unknown error')
    }

    ngOnInit (): void {
        focusElementLater(this.closeButton)
    }

    close (): void {
        this.modalInstance.dismiss()
    }
}
