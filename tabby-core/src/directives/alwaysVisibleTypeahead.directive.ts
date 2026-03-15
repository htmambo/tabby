import { Directive, ElementRef, AfterViewInit, OnDestroy } from '@angular/core'

/** @hidden */
@Directive({
    standalone: false,
    selector: '[alwaysVisibleTypeahead]',
})
export class AlwaysVisibleTypeaheadDirective implements AfterViewInit, OnDestroy {
    private inputTimeout: number | null = null
    private readonly onFocus = (event: FocusEvent) => {
        event.stopPropagation()
        this.inputTimeout = window.setTimeout(() => {
            this.inputTimeout = null
            const inputEvent = new Event('input')
            event.target?.dispatchEvent(inputEvent)
        }, 0)
    }

    constructor (private el: ElementRef) { }

    ngAfterViewInit (): void {
        this.el.nativeElement.addEventListener('focus', this.onFocus)
    }

    ngOnDestroy (): void {
        this.el.nativeElement.removeEventListener('focus', this.onFocus)
        if (this.inputTimeout !== null) {
            window.clearTimeout(this.inputTimeout)
            this.inputTimeout = null
        }
    }
}
