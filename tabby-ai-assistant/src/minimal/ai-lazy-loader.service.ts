import {
    ComponentRef,
    EnvironmentInjector,
    Injectable,
    NgModuleRef,
    ViewContainerRef,
    createEnvironmentInjector,
    createNgModule,
} from '@angular/core'
import { AI_ASSISTANT_LAZY_RUNTIME } from './lazy-runtime.token'

@Injectable({ providedIn: 'root' })
export class AiAssistantLazyLoaderService {
    private moduleRef: NgModuleRef<any> | null = null
    private moduleRefPromise: Promise<NgModuleRef<any>> | null = null
    private lazyEnvironmentInjector: EnvironmentInjector | null = null

    constructor (private environmentInjector: EnvironmentInjector) { }

    async getModuleRef (): Promise<NgModuleRef<any>> {
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

    async getSidebarService (): Promise<any> {
        const [{ AiSidebarService }, moduleRef] = await Promise.all([
            import('../services/chat/ai-sidebar.service'),
            this.getModuleRef(),
        ])
        return moduleRef.injector.get(AiSidebarService)
    }

    async getTerminalManagerService (): Promise<any> {
        const [{ TerminalManagerService }, moduleRef] = await Promise.all([
            import('../services/terminal/terminal-manager.service'),
            this.getModuleRef(),
        ])
        return moduleRef.injector.get(TerminalManagerService)
    }

    async createSettingsComponent (viewContainerRef: ViewContainerRef): Promise<ComponentRef<unknown>> {
        const [{ AiSettingsTabComponent }, moduleRef] = await Promise.all([
            import('../components/settings/ai-settings-tab.component'),
            this.getModuleRef(),
        ])
        return viewContainerRef.createComponent(AiSettingsTabComponent, {
            ngModuleRef: moduleRef,
        })
    }

    private async createModuleRef (): Promise<NgModuleRef<any>> {
        const moduleExports = await import('../index')
        this.lazyEnvironmentInjector ??= createEnvironmentInjector([
            { provide: AI_ASSISTANT_LAZY_RUNTIME, useValue: true },
        ], this.environmentInjector)
        this.moduleRef = createNgModule(moduleExports.default, this.lazyEnvironmentInjector)
        return this.moduleRef
    }
}
