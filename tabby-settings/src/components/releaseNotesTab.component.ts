/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import axios from 'axios'
import * as marked from '../../node_modules/marked/src/marked'
import { Component, Injector } from '@angular/core'
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
    releases: Release[] = []
    lastPage = 1
    loadingReleases = false
    hasMoreReleases = true
    private loadedPages = new Set<number>()

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
        console.log('Loading releases page', page)
        try {
            const response = await axios.get(`https://api.github.com/repos/htmambo/tabby/releases?page=${page}`, {
                headers: { Accept: 'application/vnd.github.v3+json' },
            })
            const releases = response.data.map(r => ({
                name: r.name,
                version: r.tag_name,
                content: marked.marked(r.body),
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

    onScrolled (): void {
        void this.loadReleases(this.lastPage + 1).catch(error => {
            console.error('Failed to load release notes', error)
        })
    }

}
