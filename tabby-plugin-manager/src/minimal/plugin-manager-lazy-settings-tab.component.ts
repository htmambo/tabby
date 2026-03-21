import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ComponentRef,
    OnDestroy,
    ViewChild,
    ViewContainerRef,
} from '@angular/core'
import { PluginManagerLazyLoaderService } from './plugin-manager-lazy-loader.service'

@Component({
    standalone: false,
    selector: 'plugin-manager-lazy-settings-tab',
    template: `
        <div *ngIf="!loaded && !error" class="plugin-manager-loader">
            <div class="plugin-manager-loader__title">Loading plugin manager...</div>
            <div class="plugin-manager-loader__hint">The full plugin manager module will load on first use.</div>
        </div>
        <div *ngIf="error" class="plugin-manager-loader plugin-manager-loader--error">
            <div class="plugin-manager-loader__title">Failed to load plugin manager</div>
            <div class="plugin-manager-loader__hint">{{ error }}</div>
        </div>
        <ng-template #placeholder></ng-template>
    `,
    styles: [`
        .plugin-manager-loader {
            padding: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
        }

        .plugin-manager-loader--error {
            border-color: rgba(220, 53, 69, 0.35);
            background: rgba(220, 53, 69, 0.08);
        }

        .plugin-manager-loader__title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .plugin-manager-loader__hint {
            opacity: 0.8;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginManagerLazySettingsTabComponent implements AfterViewInit, OnDestroy {
    @ViewChild('placeholder', { read: ViewContainerRef }) placeholder!: ViewContainerRef
    loaded = false
    error: string | null = null
    private componentRef: ComponentRef<unknown> | null = null

    constructor (
        private lazyLoader: PluginManagerLazyLoaderService,
        private cdr: ChangeDetectorRef,
    ) { }

    async ngAfterViewInit (): Promise<void> {
        try {
            this.componentRef = await this.lazyLoader.createSettingsComponent(this.placeholder)
            this.loaded = true
        } catch (error) {
            console.error('Failed to lazily create plugin manager settings component', error)
            this.error = error instanceof Error ? error.message : 'Unknown error'
        }
        this.cdr.markForCheck()
    }

    ngOnDestroy (): void {
        this.componentRef?.destroy()
        this.componentRef = null
    }
}
