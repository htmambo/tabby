import { Directive, Output, ElementRef, EventEmitter, AfterViewInit, OnDestroy } from '@angular/core'
import { DirectoryUpload, PlatformService } from '../api/platform'
import './dropZone.directive.scss'

/** @hidden */
@Directive({
    standalone: false,
    selector: '[dropZone]',
})
export class DropZoneDirective implements AfterViewInit, OnDestroy {
    @Output() transfer = new EventEmitter<DirectoryUpload>()
    private dropHint?: HTMLElement
    private pendingTimeouts = new Set<number>()
    private readonly onDragOver = () => {
        if (!this.dropHint) {
            this.dropHint = document.createElement('div')
            this.dropHint.className = 'drop-zone-hint'
            this.dropHint.innerHTML = require('./dropZone.directive.pug')
            this.el.nativeElement.appendChild(this.dropHint)
            this.scheduleTimeout(() => {
                this.dropHint?.classList.add('visible')
            }, 0)
        }
    }
    private readonly onDrop = async (event: DragEvent) => {
        this.removeHint()
        this.transfer.emit(await this.platform.startUploadFromDragEvent(event, true))
    }
    private readonly onDragLeave = () => {
        this.removeHint()
    }

    constructor (
        private el: ElementRef,
        private platform: PlatformService,
    ) { }

    ngAfterViewInit (): void {
        this.el.nativeElement.addEventListener('dragover', this.onDragOver)
        this.el.nativeElement.addEventListener('drop', this.onDrop)
        this.el.nativeElement.addEventListener('dragleave', this.onDragLeave)
    }

    ngOnDestroy (): void {
        this.el.nativeElement.removeEventListener('dragover', this.onDragOver)
        this.el.nativeElement.removeEventListener('drop', this.onDrop)
        this.el.nativeElement.removeEventListener('dragleave', this.onDragLeave)
        this.clearPendingTimeouts()
        this.dropHint?.remove()
        delete this.dropHint
    }

    private removeHint () {
        const element = this.dropHint
        delete this.dropHint
        element?.classList.remove('visible')
        this.scheduleTimeout(() => {
            element?.remove()
        }, 500)
    }

    private scheduleTimeout (callback: () => void, delay: number): number {
        const timeoutId = window.setTimeout(() => {
            this.pendingTimeouts.delete(timeoutId)
            callback()
        }, delay)
        this.pendingTimeouts.add(timeoutId)
        return timeoutId
    }

    private clearPendingTimeouts () {
        for (const timeoutId of this.pendingTimeouts) {
            window.clearTimeout(timeoutId)
        }
        this.pendingTimeouts.clear()
    }
}
