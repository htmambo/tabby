import {
    ComponentRef,
    EnvironmentInjector,
    Injectable,
    NgModuleRef,
    ViewContainerRef,
    createNgModule,
} from '@angular/core'

@Injectable({ providedIn: 'root' })
export class PluginManagerLazyLoaderService {
    private moduleRef: NgModuleRef<any> | null = null
    private moduleRefPromise: Promise<NgModuleRef<any>> | null = null

    constructor (private environmentInjector: EnvironmentInjector) { }

    async createSettingsComponent (viewContainerRef: ViewContainerRef): Promise<ComponentRef<unknown>> {
        const [{ PluginsSettingsTabComponent }, moduleRef] = await Promise.all([
            import('../components/pluginsSettingsTab.component'),
            this.getModuleRef(),
        ])
        return viewContainerRef.createComponent(PluginsSettingsTabComponent, {
            ngModuleRef: moduleRef,
        })
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
        this.moduleRef = createNgModule(moduleExports.default, this.environmentInjector)
        return this.moduleRef
    }
}
