import {
    AfterViewInit,
    ChangeDetectionStrategy,
    ChangeDetectorRef,
    Component,
    ComponentRef,
    Injector,
    Input,
    OnDestroy,
    ViewChild,
    ViewContainerRef,
} from '@angular/core'
import { BaseTabComponent, TranslateService } from 'tabby-core'
import { SettingsLazyLoaderService } from './settings-lazy-loader.service'

type LoadedSettingsTabComponent = {
    activeTab?: string
    onActiveTabChange?: (activeTab: string) => void
}

@Component({
    standalone: false,
    selector: 'settings-lazy-tab',
    template: `
        <div *ngIf="!loaded && !error" class="settings-loader">
            <div class="settings-loader__title">Loading settings...</div>
            <div class="settings-loader__hint">The full settings module will load on first use.</div>
        </div>
        <div *ngIf="error" class="settings-loader settings-loader--error">
            <div class="settings-loader__title">Failed to load settings</div>
            <div class="settings-loader__hint">{{ error }}</div>
        </div>
        <ng-template #placeholder></ng-template>
    `,
    styles: [`
        .settings-loader {
            padding: 24px;
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.03);
        }

        .settings-loader--error {
            border-color: rgba(220, 53, 69, 0.35);
            background: rgba(220, 53, 69, 0.08);
        }

        .settings-loader__title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
        }

        .settings-loader__hint {
            opacity: 0.8;
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsLazyTabComponent extends BaseTabComponent implements AfterViewInit, OnDestroy {
    @ViewChild('placeholder', { read: ViewContainerRef }) placeholder!: ViewContainerRef
    loaded = false
    error: string | null = null
    private componentRef: ComponentRef<unknown> | null = null
    private _activeTab: string | undefined

    constructor (
        injector: Injector,
        private lazyLoader: SettingsLazyLoaderService,
        private cdr: ChangeDetectorRef,
        translate: TranslateService,
    ) {
        super(injector)
        this.setTitle(translate.instant('Settings'))
    }

    @Input()
    set activeTab (value: string | undefined) {
        this._activeTab = value
        this.syncActiveTab()
    }

    get activeTab (): string | undefined {
        return this._activeTab
    }

    async ngAfterViewInit (): Promise<void> {
        try {
            this.componentRef = await this.lazyLoader.createSettingsComponent(this.placeholder, this._activeTab)
            this.loaded = true
            this.syncActiveTab()
        } catch (error) {
            console.error('Failed to lazily create settings tab', error)
            this.error = error instanceof Error ? error.message : 'Unknown error'
        }
        this.cdr.markForCheck()
    }

    ngOnDestroy (): void {
        this.componentRef?.destroy()
        this.componentRef = null
        super.ngOnDestroy()
    }

    private syncActiveTab (): void {
        if (!this._activeTab || !this.componentRef) {
            return
        }
        const instance = this.componentRef.instance as LoadedSettingsTabComponent
        instance.activeTab = this._activeTab
        instance.onActiveTabChange?.(this._activeTab)
        this.componentRef.changeDetectorRef.detectChanges()
    }
}
