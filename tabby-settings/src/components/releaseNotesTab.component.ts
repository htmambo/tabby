/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Component, HostListener, Injector } from '@angular/core'
import { BaseTabComponent, TranslateService } from 'tabby-core'

export interface Release {
    name: string
    version: string
    content: string
    date: Date
}

/** @hidden */
@Component({
    standalone: false,
    selector: 'release-notes-tab',
    templateUrl: './releaseNotesTab.component.pug',
    styleUrls: ['./releaseNotesTab.component.scss'],
})
export class ReleaseNotesComponent extends BaseTabComponent {
    private readonly loadMoreThreshold = 240
    releases: Release[] = []
    lastPage = 1
    loadingReleases = false
    hasMoreReleases = true
    private loadedPages = new Set<number>()
    private axiosModulePromise: Promise<any> | null = null
    private markedModulePromise: Promise<any> | null = null

    constructor (translate: TranslateService, injector: Injector) {
        super(injector)
        this.setTitle(translate.instant(_('Release notes')))
        void this.loadReleases(1).catch(error => {
            console.error('Failed to load release notes', error)
        })
    }

    async loadReleases (page: number): Promise<void> {
        if (this.loadingReleases || this.loadedPages.has(page) || !this.hasMoreReleases) {
            return
        }

        this.loadingReleases = true
        console.debug('Loading releases page', page)
        try {
            const [axiosModule, markedModule] = await Promise.all([
                this.getAxios(),
                this.getMarked(),
            ])
            const axios = axiosModule.default ?? axiosModule
            const marked = markedModule.marked ?? markedModule.default ?? markedModule
            const response = await axios.get(`https://api.github.com/repos/htmambo/tabby/releases?page=${page}`, {
                headers: { Accept: 'application/vnd.github.v3+json' },
            })
            const releases = response.data.map((r: { name: string, tag_name: string, body: string, created_at: string }) => ({
                name: r.name,
                version: r.tag_name,
                content: marked.parse(r.body),
                date: new Date(r.created_at),
            }))

            this.loadedPages.add(page)
            this.releases = this.releases.concat(releases)
            this.lastPage = page
            if (!releases.length) {
                this.hasMoreReleases = false
            }
        } finally {
            this.loadingReleases = false
        }
    }

    @HostListener('scroll', ['$event.target'])
    onHostScroll (target: HTMLElement | null): void {
        if (!target || this.loadingReleases || !this.hasMoreReleases) {
            return
        }
        const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
        if (remaining <= this.loadMoreThreshold) {
            this.onScrolled()
        }
    }

    onScrolled (): void {
        void this.loadReleases(this.lastPage + 1).catch(error => {
            console.error('Failed to load release notes', error)
        })
    }

    private async getAxios (): Promise<any> {
        this.axiosModulePromise ??= import('axios')
        return this.axiosModulePromise
    }

    private async getMarked (): Promise<any> {
        this.markedModulePromise ??= import('marked')
        return this.markedModulePromise
    }
}
