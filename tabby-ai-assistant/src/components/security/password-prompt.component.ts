import { Component, Input, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isButtonLikeTarget, isPlainEnter, isPlainEscape } from 'tabby-core'

@Component({
    selector: 'app-password-prompt',
    standalone: false,
    templateUrl: './password-prompt.component.html',
    styleUrls: ['./password-prompt.component.scss'],
})
export class PasswordPromptComponent {
    @Input() title = '密码验证'
    @ViewChild('passwordInput', { static: true }) passwordInput: ElementRef<HTMLInputElement>
    password = ''
    errorMessage = ''

    constructor(public activeModal: NgbActiveModal) {}

    ngOnInit(): void {
        focusElementLater(this.passwordInput)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown(event: KeyboardEvent): void {
        if (isPlainEscape(event)) {
            event.preventDefault()
            this.cancel()
            return
        }

        if (!isPlainEnter(event) || isButtonLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.submit()
    }

    submit(): void {
        if (this.password) {
            this.activeModal.close(this.password)
        } else {
            this.errorMessage = '请输入密码'
        }
    }

    cancel(): void {
        this.activeModal.dismiss('cancel')
    }
}
