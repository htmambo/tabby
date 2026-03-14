import { Component, Input, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isPlainEscape } from 'tabby-core'
import { RiskLevel } from '../../types/security.types'

@Component({
    selector: 'app-consent-dialog',
    standalone: false,
    templateUrl: './consent-dialog.component.html',
    styleUrls: ['./consent-dialog.component.scss'],
})
export class ConsentDialogComponent {
    @Input() command = ''
    @Input() riskLevel: RiskLevel = RiskLevel.MEDIUM
    @ViewChild('cancelButton', { static: true }) cancelButton: ElementRef<HTMLButtonElement>
    rememberChoice = false

    constructor(public activeModal: NgbActiveModal) {}

    ngOnInit(): void {
        focusElementLater(this.cancelButton)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown(event: KeyboardEvent): void {
        if (!isPlainEscape(event)) {
            return
        }

        event.preventDefault()
        this.cancel()
    }

    confirm(): void {
        this.activeModal.close({ confirmed: true, remember: this.rememberChoice })
    }

    cancel(): void {
        this.activeModal.dismiss('cancel')
    }
}
