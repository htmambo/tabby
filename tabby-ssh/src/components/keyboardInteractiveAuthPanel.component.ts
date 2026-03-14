import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ChangeDetectionStrategy, HostListener } from '@angular/core'
import { focusElementLater, isButtonLikeTarget, isPlainEnter } from 'tabby-core'
import { KeyboardInteractivePrompt } from '../session/ssh'
import { SSHProfile } from '../api'
import { PasswordStorageService } from '../services/passwordStorage.service'

@Component({
    standalone: false,
    selector: 'keyboard-interactive-auth-panel',
    templateUrl: './keyboardInteractiveAuthPanel.component.pug',
    styleUrls: ['./keyboardInteractiveAuthPanel.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeyboardInteractiveAuthComponent {
    @Input() profile: SSHProfile
    @Input() prompt: KeyboardInteractivePrompt
    @Input() step = 0
    @Output() done = new EventEmitter()
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>
    remember = false

    constructor (private passwordStorage: PasswordStorageService) {}

    ngOnInit (): void {
        focusElementLater(this.input)
    }

    isPassword (): boolean {
        return this.prompt.isAPasswordPrompt(this.step)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (!isPlainEnter(event) || isButtonLikeTarget(event.target)) {
            return
        }

        event.preventDefault()
        this.next()
    }

    previous (): void {
        if (this.step > 0) {
            this.step--
        }
        focusElementLater(this.input)
    }

    next (): void {
        if (this.isPassword() && this.remember) {
            this.passwordStorage.savePassword(this.profile, this.prompt.responses[this.step])
        }

        if (this.step === this.prompt.prompts.length - 1) {
            this.prompt.respond()
            this.done.emit()
            return
        }
        this.step++
        focusElementLater(this.input)
    }
}
