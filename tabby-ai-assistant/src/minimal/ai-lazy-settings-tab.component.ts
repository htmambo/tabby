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
import { AiAssistantLazyLoaderService } from './ai-lazy-loader.service'

@Component({
    standalone: false,
    selector: 'app-ai-lazy-settings-tab',
    template: `
        <div *ngIf="!loaded && !error" class="ai-settings-loader">
            <div class="ai-settings-loader__title">Loading AI Assistant settings...</div>
            <div class="ai-settings-loader__hint">The full AI Assistant module will load on first use.</div>
        </div>
        <div *ngIf="error" class="ai-settings-loader ai-settings-loader--error">
            <div class="ai-settings-loader__title">Failed to load AI Assistant settings</div>
            <div class="ai-settings-loader__hint">{{ error }}</div>
        </div>
        <ng-template #placeholder></ng-template>
    `,
    styles: [`
        .ai-settings-loader {
            padding: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
        }

        .ai-settings-loader--error {
            border-color: rgba(220, 53, 69, 0.35);
            background: rgba(220, 53, 69, 0.08);
        }

        .ai-settings-loader__title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .ai-settings-loader__hint {
            opacity: 0.8;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiLazySettingsTabComponent implements AfterViewInit, OnDestroy {
    @ViewChild('placeholder', { read: ViewContainerRef }) placeholder!: ViewContainerRef
    loaded = false
    error: string | null = null
    private componentRef: ComponentRef<unknown> | null = null

    constructor (
        private lazyLoader: AiAssistantLazyLoaderService,
        private cdr: ChangeDetectorRef,
    ) { }

    async ngAfterViewInit (): Promise<void> {
        try {
            this.componentRef = await this.lazyLoader.createSettingsComponent(this.placeholder)
            this.loaded = true
        } catch (error) {
            console.error('Failed to lazily create AI Assistant settings component', error)
            this.error = error instanceof Error ? error.message : 'Unknown error'
        }
        this.cdr.markForCheck()
    }

    ngOnDestroy (): void {
        this.componentRef?.destroy()
        this.componentRef = null
    }
}
