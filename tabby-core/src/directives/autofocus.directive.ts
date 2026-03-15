import { Directive, AfterViewInit, ElementRef, OnDestroy } from '@angular/core'

/** @hidden */
@Directive({
    standalone: false,
    selector: '[autofocus]',
})
export class AutofocusDirective implements AfterViewInit, OnDestroy {
    private focusTimeout: number | null = null

    constructor (private el: ElementRef) { }

    ngAfterViewInit (): void {
        this.el.nativeElement.blur()
        this.focusTimeout = window.setTimeout(() => {
            this.focusTimeout = null
            this.el.nativeElement.focus()
        })
    }

    ngOnDestroy (): void {
        if (this.focusTimeout !== null) {
            window.clearTimeout(this.focusTimeout)
            this.focusTimeout = null
        }
    }
}
