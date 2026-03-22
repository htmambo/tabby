import {
    ComponentRef,
    EnvironmentInjector,
    Injectable,
    NgModuleRef,
    ViewContainerRef,
    createEnvironmentInjector,
    createNgModule,
} from '@angular/core'
import { SETTINGS_LAZY_RUNTIME } from './lazy-runtime.token'

@Injectable({ providedIn: 'root' })
export class SettingsLazyLoaderService {
    private moduleRef: NgModuleRef<any> | null = null
    private moduleRefPromise: Promise<NgModuleRef<any>> | null = null
    private lazyEnvironmentInjector: EnvironmentInjector | null = null

    constructor (private environmentInjector: EnvironmentInjector) { }

    async createSettingsComponent (viewContainerRef: ViewContainerRef, activeTab?: string): Promise<ComponentRef<unknown>> {
        const [{ SettingsTabComponent }, moduleRef] = await Promise.all([
            import('../components/settingsTab.component'),
            this.getModuleRef(),
        ])
        const componentRef = viewContainerRef.createComponent(SettingsTabComponent, {
            ngModuleRef: moduleRef,
        })
        if (activeTab) {
            (componentRef.instance as { activeTab?: string }).activeTab = activeTab
        }
        componentRef.changeDetectorRef.detectChanges()
        return componentRef
    }

    private async getModuleRef (): Promise<NgModuleRef<any>> {
        if (!this.moduleRefPromise) {
            this.moduleRefPromise = this.createModuleRef()
        }
        try {
            return await this.moduleRefPromise
        } catch (error) {
            this.moduleRefPromise = null
            throw error
        }
    }

    private async createModuleRef (): Promise<NgModuleRef<any>> {
        const moduleExports = await import('../index')
        this.lazyEnvironmentInjector ??= createEnvironmentInjector([
            { provide: SETTINGS_LAZY_RUNTIME, useValue: true },
        ], this.environmentInjector)
        this.moduleRef = createNgModule(moduleExports.default, this.lazyEnvironmentInjector)
        return this.moduleRef
    }
}
