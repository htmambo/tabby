import { Directive, Input, ElementRef, OnChanges, OnDestroy } from '@angular/core'
import { PlatformService } from '../api/platform'
import { normalizeExternalURL, sanitizeHTML } from '../utils'

/** @hidden */
@Directive({
    standalone: false,
    selector: '[fastHtmlBind]',
})
export class FastHtmlBindDirective implements OnChanges, OnDestroy {
    @Input() fastHtmlBind?: string
    @Input() fastHtmlBindSanitize = false
    private boundLinks: HTMLAnchorElement[] = []

    constructor (
        private el: ElementRef,
        private platform: PlatformService,
    ) { }

    ngOnChanges (): void {
        this.clearBoundLinks()
        const html = this.fastHtmlBind ?? ''
        this.el.nativeElement.innerHTML = this.fastHtmlBindSanitize ? sanitizeHTML(html) : html
        for (const link of this.el.nativeElement.querySelectorAll('a')) {
            const rawHref = link.getAttribute('href') ?? ''
            const safeHref = normalizeExternalURL(rawHref)
            if (!safeHref) {
                link.removeAttribute('href')
                link.onclick = null
                continue
            }
            link.setAttribute('href', safeHref)
            link.setAttribute('rel', 'noopener noreferrer')
            link.onclick = (event: MouseEvent) => {
                event.preventDefault()
                this.platform.openExternal(safeHref)
            }
            this.boundLinks.push(link)
        }
    }

    ngOnDestroy (): void {
        this.clearBoundLinks()
    }

    private clearBoundLinks (): void {
        for (const link of this.boundLinks) {
            link.onclick = null
        }
        this.boundLinks = []
    }
}
