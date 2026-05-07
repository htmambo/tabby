import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, ChangeDetectionStrategy, HostListener, OnInit, ChangeDetectorRef } from '@angular/core'
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
export class KeyboardInteractiveAuthComponent implements OnInit {
    @Input() profile: SSHProfile
    @Input() prompt: KeyboardInteractivePrompt
    @Input() step = 0
    @Output() done = new EventEmitter()
    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>
    remember = false

    constructor (
        private passwordStorage: PasswordStorageService,
        private cdr: ChangeDetectorRef,
    ) {}

    async ngOnInit (): Promise<void> {
        focusElementLater(this.input)
        const savedPassword = await this.passwordStorage.loadPassword(this.profile)
        if (savedPassword) {
            for (let i = 0; i < this.prompt.prompts.length; i++) {
                if (this.prompt.isAPasswordPrompt(i) && !this.prompt.responses[i]) {
                    this.prompt.responses[i] = savedPassword
                }
            }
            this.cdr.markForCheck()
        }
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

    shouldEcho (): boolean {
        return this.prompt.prompts[this.step].echo ?? false
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
