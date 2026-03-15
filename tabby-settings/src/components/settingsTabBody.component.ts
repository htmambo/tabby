import { Component, Input, ViewContainerRef, ViewChild, ComponentFactoryResolver, ComponentRef, OnDestroy } from '@angular/core'
import { SettingsTabProvider } from '../api'

/** @hidden */
@Component({
    standalone: false,
    selector: 'settings-tab-body',
    template: '<ng-template #placeholder></ng-template>',
    styles: [`
        :host {
            display: block;
            padding-bottom: 20px;
        }
    `],
})
export class SettingsTabBodyComponent implements OnDestroy {
    @Input() provider: SettingsTabProvider
    @ViewChild('placeholder', { read: ViewContainerRef }) placeholder: ViewContainerRef
    component: ComponentRef<unknown>
    private pendingCreateHandle: number | null = null

    constructor (private componentFactoryResolver: ComponentFactoryResolver) { }

    ngAfterViewInit (): void {
        // run after the change detection finishes
        this.pendingCreateHandle = window.setTimeout(() => {
            this.pendingCreateHandle = null
            this.component = this.placeholder.createComponent(
                this.componentFactoryResolver.resolveComponentFactory(
                    this.provider.getComponentType(),
                ),
            )
        }, 0)
    }

    ngOnDestroy (): void {
        if (this.pendingCreateHandle !== null) {
            window.clearTimeout(this.pendingCreateHandle)
            this.pendingCreateHandle = null
        }
    }
}
