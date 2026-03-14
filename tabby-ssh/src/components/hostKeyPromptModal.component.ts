/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, ViewChild, ElementRef, HostListener } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { focusElementLater, isPlainEscape } from 'tabby-core'
import { KnownHost, KnownHostSelector, SSHKnownHostsService } from '../services/sshKnownHosts.service'

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './hostKeyPromptModal.component.pug',
})
export class HostKeyPromptModalComponent {
    @Input() selector: KnownHostSelector
    @Input() digest: string
    @ViewChild('disconnectButton', { static: true }) disconnectButton: ElementRef<HTMLButtonElement>
    knownHost: KnownHost|null
    isMismatched = false
    isUnknown = false

    constructor (
        private knownHosts: SSHKnownHostsService,
        private modalInstance: NgbActiveModal,
    ) { }

    ngOnInit () {
        this.knownHost = this.knownHosts.getFor(this.selector)
        if (!this.knownHost) {
            this.isUnknown = true
        } else if (this.knownHost.digest !== this.digest) {
            this.isMismatched = true
        }

        focusElementLater(this.disconnectButton)
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (!isPlainEscape(event)) {
            return
        }

        event.preventDefault()
        this.cancel()
    }

    accept () {
        this.modalInstance.close(true)
    }

    async acceptAndSave () {
        await this.knownHosts.store(this.selector, this.digest)
        this.accept()
    }

    cancel () {
        this.modalInstance.close(false)
    }
}
