import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import deepClone from 'clone-deep'
import { Component, Inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { ConfigService, HostAppService, Profile, SelectorService, ProfilesService, PromptModalComponent, PlatformService, BaseComponent, PartialProfile, ProfileProvider, TranslateService, Platform, ProfileGroup, PartialProfileGroup, QuickConnectProfileProvider } from 'tabby-core'
import { EditProfileModalComponent } from './editProfileModal.component'
import { EditProfileGroupModalComponent, EditProfileGroupModalComponentResult } from './editProfileGroupModal.component'

_('Filter')
_('Ungrouped')

interface CollapsableProfileGroup extends ProfileGroup {
    collapsed: boolean
}

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './profilesSettingsTab.component.pug',
    styleUrls: ['./profilesSettingsTab.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfilesSettingsTabComponent extends BaseComponent {
    builtinProfiles: PartialProfile<Profile>[] = []
    profiles: PartialProfile<Profile>[] = []
    templateProfiles: PartialProfile<Profile>[] = []
    customProfiles: PartialProfile<Profile>[] = []
    profileGroups: PartialProfileGroup<CollapsableProfileGroup>[]
    filter = ''
    Platform = Platform

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        @Inject(ProfileProvider) public profileProviders: ProfileProvider<Profile>[],
        private profilesService: ProfilesService,
        private selector: SelectorService,
        private ngbModal: NgbModal,
        private platform: PlatformService,
        private translate: TranslateService,
        private cdr: ChangeDetectorRef,
    ) {
        super()
        this.profileProviders.sort((a, b) => a.name.localeCompare(b.name))
    }

    /** 用于检测 profile 相关配置是否变化的缓存 */
    private lastProfileConfigVersion: number = 0

    /** 缓存的 profile 描述，避免模板热路径重复调用 profilesService.getDescription() */
    private profileDescriptionCache = new Map<string, string|null>()

    /** 缓存的 profile 可见性，filter 变化时清空 */
    private profileVisibilityCache = new Map<string, boolean>()

    /** 缓存的 group 可见性，filter 变化时清空 */
    private groupVisibilityCache = new Map<string, boolean>()

    async ngOnInit (): Promise<void> {
        await this.refreshAll()
        // 只在 profile 相关配置变化时刷新
        this.subscribeUntilDestroyed(this.config.changed$, () => {
            if (this.hasProfileConfigChanged()) {
                void this.refreshAll()
            }
        })
    }

    /**
     * 检测 profile 相关配置是否发生变化
     * 使用配置版本号比较，避免 JSON.stringify 开销
     */
    private hasProfileConfigChanged (): boolean {
        if (this.config.storeVersion !== this.lastProfileConfigVersion) {
            this.lastProfileConfigVersion = this.config.storeVersion
            return true
        }
        return false
    }

    /**
     * 统一刷新方法，避免重复枚举 profile
     */
    private async refreshAll (): Promise<void> {
        // 一次调用获取 groups（包含 profiles），然后从中提取 profiles
        const groups = await this.profilesService.getProfileGroups({ includeNonUserGroup: true, includeProfiles: true })
        groups.sort((a, b) => a.name.localeCompare(b.name))
        groups.sort((a, b) => (a.id === 'built-in' || !a.editable ? 1 : 0) - (b.id === 'built-in' || !a.editable ? 1 : 0))
        groups.sort((a, b) => (a.id === 'ungrouped' ? 0 : 1) - (b.id === 'ungrouped' ? 0 : 1))

        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        this.profileGroups = groups.map(g => ProfilesSettingsTabComponent.intoPartialCollapsableProfileGroup(g, profileGroupCollapsed[g.id] ?? false))

        // 从 groups 中提取所有 profiles，避免再次调用 getProfiles()
        const allProfiles = groups.flatMap(g => g.profiles ?? [])
        this.builtinProfiles = allProfiles.filter(x => x.isBuiltin && !x.isTemplate)
        this.templateProfiles = allProfiles.filter(x => x.isTemplate)
        this.customProfiles = allProfiles.filter(x => !x.isBuiltin)

        // 清空缓存，因为 profile 数据已更新
        this.profileDescriptionCache.clear()
        this.profileVisibilityCache.clear()
        this.groupVisibilityCache.clear()
        this.cdr.markForCheck()
    }

    launchProfile (profile: PartialProfile<Profile>): void {
        this.profilesService.openNewTabForProfile(profile)
    }

    async newProfile (base?: PartialProfile<Profile>): Promise<void> {
        if (!base) {
            let profiles = await this.profilesService.getProfiles()
            profiles = profiles.filter(x => !this.isProfileBlacklisted(x))
            profiles.sort((a, b) => (a.weight ?? 0) - (b.weight ?? 0))
            base = await this.selector.show(
                this.translate.instant('Select a base profile to use as a template'),
                profiles.map(p => ({
                    icon: p.icon ?? undefined,
                    description: this.profilesService.getDescription(p) ?? undefined,
                    name: p.group ? `${this.profilesService.resolveProfileGroupName(p.group)} / ${p.name}` : p.name,
                    result: p,
                })),
            ).catch(() => undefined)
            if (!base) {
                return
            }
        }
        const baseProfile: PartialProfile<Profile> = deepClone(base)
        delete baseProfile.id
        if (base.isTemplate) {
            baseProfile.name = ''
        } else if (!base.isBuiltin) {
            baseProfile.name = this.translate.instant('{name} copy', base)
        }
        baseProfile.isBuiltin = false
        baseProfile.isTemplate = false
        const result = await this.showProfileEditModal(baseProfile)
        if (!result) {
            return
        }
        if (!result.name) {
            const cfgProxy = this.profilesService.getConfigProxyForProfile(result)
            result.name = this.profilesService.providerForProfile(result)?.getSuggestedName(cfgProxy) ?? this.translate.instant('{name} copy', base)
        }
        await this.profilesService.newProfile(result)
        await this.config.save()
    }

    async editProfile (profile: PartialProfile<Profile>): Promise<void> {
        const result = await this.showProfileEditModal(profile)
        if (!result) {
            return
        }
        await this.profilesService.writeProfile(result)
        await this.config.save()
    }

    async showProfileEditModal (profile: PartialProfile<Profile>): Promise<PartialProfile<Profile>|null> {
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const provider = this.profilesService.providerForProfile(profile)
        if (!provider) {
            throw new Error('Cannot edit a profile without a provider')
        }
        modal.componentInstance.profile = deepClone(profile)
        modal.componentInstance.profileProvider = provider

        const result = await modal.result.catch(() => null)
        if (!result) {
            return null
        }

        result.type = provider.id
        return result
    }

    async deleteProfile (profile: PartialProfile<Profile>): Promise<void> {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', profile),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            await this.profilesService.deleteProfile(profile)
            await this.config.save()
        }
    }

    async newProfileGroup (): Promise<void> {
        const modal = this.ngbModal.open(PromptModalComponent)
        modal.componentInstance.prompt = this.translate.instant('New group name')
        const result = await modal.result.catch(() => null)
        if (result?.value.trim()) {
            await this.profilesService.newProfileGroup({ id: '', name: result.value })
            await this.config.save()
        }
    }

    async editProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<void> {
        const result = await this.showProfileGroupEditModal(group)
        if (!result) {
            return
        }
        await this.profilesService.writeProfileGroup(ProfilesSettingsTabComponent.collapsableIntoPartialProfileGroup(result))
        await this.config.save()
    }

    async showProfileGroupEditModal (group: PartialProfileGroup<CollapsableProfileGroup>): Promise<PartialProfileGroup<CollapsableProfileGroup>|null> {
        const modal = this.ngbModal.open(
            EditProfileGroupModalComponent,
            { size: 'lg' },
        )

        modal.componentInstance.group = deepClone(group)
        modal.componentInstance.providers = this.profileProviders

        const result: EditProfileGroupModalComponentResult<CollapsableProfileGroup> | null = await modal.result.catch(() => null)
        if (!result) {
            return null
        }

        if (result.provider) {
            return this.editProfileGroupDefaults(result.group, result.provider)
        }

        return result.group
    }

    private async editProfileGroupDefaults (group: PartialProfileGroup<CollapsableProfileGroup>, provider: ProfileProvider<Profile>): Promise<PartialProfileGroup<CollapsableProfileGroup>|null> {
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = group.defaults?.[provider.id] ?? {}
        model.type = provider.id
        modal.componentInstance.profile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'group'

        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            if (!group.defaults) {
                group.defaults = {}
            }
            group.defaults[provider.id] = model
        }
        return this.showProfileGroupEditModal(group)
    }

    async deleteProfileGroup (group: PartialProfileGroup<ProfileGroup>): Promise<void> {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', group),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            let deleteProfiles = false
            if ((group.profiles?.length ?? 0) > 0 && (await this.platform.showMessageBox(
                {
                    type: 'warning',
                    message: this.translate.instant('Delete the group\'s profiles?'),
                    buttons: [
                        this.translate.instant('Move to "Ungrouped"'),
                        this.translate.instant('Delete'),
                    ],
                    defaultId: 0,
                    cancelId: 0,
                },
            )).response !== 0) {
                deleteProfiles = true
            }

            await this.profilesService.deleteProfileGroup(group, { deleteProfiles })
            await this.config.save()
        }
    }

    isGroupVisible (group: PartialProfileGroup<ProfileGroup>): boolean {
        if (!this.filter) {
            return true
        }
        // 使用缓存
        const cached = this.groupVisibilityCache.get(group.id)
        if (cached !== undefined) {
            return cached
        }
        const result = (group.profiles ?? []).some(x => this.isProfileVisible(x))
        this.groupVisibilityCache.set(group.id, result)
        return result
    }

    isProfileVisible (profile: PartialProfile<Profile>): boolean {
        if (!this.filter) {
            return true
        }
        // 使用缓存
        const cacheKey = profile.id ?? profile.name
        const cached = this.profileVisibilityCache.get(cacheKey)
        if (cached !== undefined) {
            return cached
        }
        const result = (profile.name + '$' + (this.getCachedDescription(profile) ?? '')).toLowerCase().includes(this.filter.toLowerCase())
        this.profileVisibilityCache.set(cacheKey, result)
        return result
    }

    /**
     * 获取 profile 描述（带缓存）
     * 模板调用此方法，避免每次变更检测都调用 profilesService.getDescription()
     */
    getDescription (profile: PartialProfile<Profile>): string|null {
        return this.getCachedDescription(profile)
    }

    /**
     * 内部方法：从缓存获取描述，缓存未命中时计算并缓存
     */
    private getCachedDescription (profile: PartialProfile<Profile>): string|null {
        const cacheKey = profile.id ?? profile.name
        const cached = this.profileDescriptionCache.get(cacheKey)
        if (cached !== undefined) {
            return cached
        }
        const result = this.profilesService.getDescription(profile)
        this.profileDescriptionCache.set(cacheKey, result)
        return result
    }

    /**
     * filter 变化时清空可见性缓存
     */
    onFilterChange (): void {
        this.profileVisibilityCache.clear()
        this.groupVisibilityCache.clear()
        this.cdr.markForCheck()
    }

    getTypeLabel (profile: PartialProfile<Profile>): string {
        const name = this.profilesService.providerForProfile(profile)?.name
        if (name === 'Local terminal') {
            return ''
        }
        return name ? this.translate.instant(name) : this.translate.instant('Unknown')
    }

    getTypeColorClass (profile: PartialProfile<Profile>): string {
        return {
            ssh: 'secondary',
            serial: 'success',
            telnet: 'info',
        }[this.profilesService.providerForProfile(profile)?.id ?? ''] ?? 'warning'
    }

    toggleGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        if (group.profiles?.length === 0) {
            return
        }
        group.collapsed = !group.collapsed
        this.saveProfileGroupCollapse(group)
    }

    async editDefaults (provider: ProfileProvider<Profile>): Promise<void> {
        const modal = this.ngbModal.open(
            EditProfileModalComponent,
            { size: 'lg' },
        )
        const model = this.profilesService.getProviderDefaults(provider)
        model.type = provider.id
        modal.componentInstance.profile = Object.assign({}, model)
        modal.componentInstance.profileProvider = provider
        modal.componentInstance.defaultsMode = 'enabled'
        const result = await modal.result.catch(() => null)
        if (result) {
            // Fully replace the config
            for (const k in model) {
                // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
                delete model[k]
            }
            Object.assign(model, result)
            this.profilesService.setProviderDefaults(provider, model)
            await this.config.save()
        }
    }

    async deleteDefaults (provider: ProfileProvider<Profile>): Promise<void> {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Restore settings to defaults ?'),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            this.profilesService.setProviderDefaults(provider, {})
            await this.config.save()
        }
    }

    blacklistProfile (profile: PartialProfile<Profile>): void {
        this.config.store.profileBlacklist = [...this.config.store.profileBlacklist, profile.id]
        this.config.save()
    }

    unblacklistProfile (profile: PartialProfile<Profile>): void {
        this.config.store.profileBlacklist = this.config.store.profileBlacklist.filter((x: string) => x !== profile.id)
        this.config.save()
    }

    isProfileBlacklisted (profile: PartialProfile<Profile>): boolean {
        return profile.id && this.config.store.profileBlacklist.includes(profile.id)
    }

    getQuickConnectProviders (): ProfileProvider<Profile>[] {
        return this.profileProviders.filter(x => x instanceof QuickConnectProfileProvider)
    }

    /**
    * Save ProfileGroup collapse state in localStorage
    */
    private saveProfileGroupCollapse (group: PartialProfileGroup<CollapsableProfileGroup>): void {
        const profileGroupCollapsed = JSON.parse(window.localStorage.profileGroupCollapsed ?? '{}')
        profileGroupCollapsed[group.id] = group.collapsed
        window.localStorage.profileGroupCollapsed = JSON.stringify(profileGroupCollapsed)
    }

    private static collapsableIntoPartialProfileGroup (group: PartialProfileGroup<CollapsableProfileGroup>): PartialProfileGroup<ProfileGroup> {
        const g: any = { ...group }
        delete g.collapsed
        return g
    }

    private static intoPartialCollapsableProfileGroup (group: PartialProfileGroup<ProfileGroup>, collapsed: boolean): PartialProfileGroup<CollapsableProfileGroup> {
        const collapsableGroup = {
            ...group,
            collapsed,
        }
        return collapsableGroup
    }
}
