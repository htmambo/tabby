import { Component, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseComponent, focusElementLater, isButtonLikeTarget, isPlainEnter, isPlainEscape } from 'tabby-core'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './sftpCreateDirectoryModal.component.pug',
})
export class SFTPCreateDirectoryModalComponent extends BaseComponent {
    directoryName: string
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>

    constructor (
        private modalInstance: NgbActiveModal,
    ) {
        super()
    }

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
        this.create()
    }

    create (): void {
        this.modalInstance.close(this.directoryName)
    }

    cancel (): void {
        this.modalInstance.close('')
    }
}
