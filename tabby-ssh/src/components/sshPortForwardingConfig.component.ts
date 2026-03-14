/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { Component, Input, Output, EventEmitter, HostListener, ViewChild, ElementRef } from '@angular/core'
import { focusElementLater, isPlainEnter, isTextInputTarget } from 'tabby-core'
import { ForwardedPortConfig, PortForwardType } from '../api'

/** @hidden */
@Component({
    standalone: false,
    selector: 'ssh-port-forwarding-config',
    templateUrl: './sshPortForwardingConfig.component.pug',
})
export class SSHPortForwardingConfigComponent {
    @Input() model: ForwardedPortConfig[]
    @Output() forwardAdded = new EventEmitter<ForwardedPortConfig>()
    @Output() forwardRemoved = new EventEmitter<ForwardedPortConfig>()
    @ViewChild('hostInput') hostInput: ElementRef<HTMLInputElement>
    newForward: ForwardedPortConfig
    PortForwardType = PortForwardType

    constructor (
    ) {
        this.reset()
    }

    ngAfterViewInit (): void {
        this.focusHostInput()
    }

    reset () {
        this.newForward = {
            type: PortForwardType.Local,
            host: '127.0.0.1',
            port: 8000,
            targetAddress: '127.0.0.1',
            targetPort: 80,
            description: '',
        }
        this.focusHostInput()
    }

    @HostListener('keydown', ['$event'])
    onKeyDown (event: KeyboardEvent): void {
        if (!isPlainEnter(event) || !isTextInputTarget(event.target)) {
            return
        }

        event.preventDefault()
        void this.addForward()
    }

    async addForward () {
        try {
            this.forwardAdded.emit(this.newForward)
            this.reset()
        } catch (e) {
            console.error(e)
        }
    }

    remove (fw: ForwardedPortConfig) {
        this.forwardRemoved.emit(fw)
        this.newForward = fw
        this.focusHostInput()
    }

    private focusHostInput (): void {
        focusElementLater(this.hostInput)
    }
}
