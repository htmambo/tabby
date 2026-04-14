/**
 * Cloud Sync Settings Tab Component
 *
 * Provides the UI for the zero-knowledge encrypted multi-cloud sync system.
 *
 * Security states:
 *   NO_KEY  → Master key setup screen
 *   LOCKED  → Unlock screen
 *   UNLOCKED → Full sync UI
 */

import { Component, HostBinding, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { Subject, takeUntil } from 'rxjs';
import { BaseComponent, PlatformService, ConfigService, TranslateService } from 'tabby-core';
import { CloudSyncManagerService, SyncManagerState } from '../services/cloudSync/sync-manager.service';
import { CloudSyncPayloadBuilderService } from '../services/cloudSync/payload-builder.service';
import type {
  CloudProvider,
  WebDAVConfig,
  S3Config,
  SyncEvent,
  ConflictInfo,
} from '../services/cloudSync/domain/types';
import { formatLastSync } from '../services/cloudSync/domain/types';

/** @hidden */
@Component({
  standalone: false,
  selector: 'cloud-sync-settings-tab',
  templateUrl: './cloudSyncSettingsTab.component.pug',
  styleUrls: ['./cloudSyncSettingsTab.component.scss'],
})
export class CloudSyncSettingsTabComponent extends BaseComponent implements OnDestroy {
  @HostBinding('class.content-box') readonly contentBox = true;

  state: SyncManagerState | undefined = undefined;
  activeNav: string | number = 'providers';

  // Master key form
  masterPassword = '';
  confirmPassword = '';
  unlockPassword = '';
  masterKeyError = '';
  changingPassword = false;

  // OAuth flow state
  pendingOAuthProvider: CloudProvider | null = null;
  githubUserCode = '';
  githubVerificationUrl = '';
  oauthRedirectUrl = '';

  // WebDAV form
  webdavEndpoint = '';
  webdavUsername = '';
  webdavPassword = '';
  webdavAuthType: 'basic' | 'digest' | 'token' = 'basic';
  webdavToken = '';
  webdavAllowInsecure = false;

  // S3 form
  s3Endpoint = '';
  s3Region = 'us-east-1';
  s3Bucket = '';
  s3AccessKeyId = '';
  s3SecretAccessKey = '';
  s3SessionToken = '';
  s3Prefix = '';

  // GitHub OAuth form
  githubClientId = '';

  // Google OAuth form
  googleClientId = '';
  googleClientSecret = '';

  // OneDrive OAuth form
  onedriveClientId = '';

  // Connecting state
  connectingProvider: CloudProvider | null = null;
  connectError: string | null = null;

  // Sync state
  syncing = false;
  syncError: string | null = null;

  // Active tab for nav
  activeSettingsNav = 'security';

  private destroy$ = new Subject<void>();

  constructor(
    public cloudSync: CloudSyncManagerService,
    private payloadBuilder: CloudSyncPayloadBuilderService,
    private platform: PlatformService,
    public config: ConfigService,
    private translate: TranslateService,
    private cdr: ChangeDetectorRef,
  ) {
    super();

    cloudSync.getState$()
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        this.state = state;
        this.cdr.markForCheck();
      });

    cloudSync.events$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => this.handleSyncEvent(event));

    // Initialize OAuth redirect URL
    this.oauthRedirectUrl = this.getOAuthRedirectUrl();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ==========================================================================
  // Security state helpers
  // ==========================================================================

  get isNoKey(): boolean { return !this.state || this.state.securityState === 'NO_KEY'; }
  get isLocked(): boolean { return this.state?.securityState === 'LOCKED'; }
  get isUnlocked(): boolean { return this.state?.securityState === 'UNLOCKED'; }

  async setupMasterKey(): Promise<void> {
    if (!this.masterPassword || this.masterPassword.length < 8) {
      this.masterKeyError = this.translate.instant('cloudSync.passwordMinLength');
      return;
    }
    if (this.masterPassword !== this.confirmPassword) {
      this.masterKeyError = this.translate.instant('cloudSync.passwordsDoNotMatch');
      return;
    }
    this.masterKeyError = '';
    try {
      await this.cloudSync.setupMasterKey(this.masterPassword);
      this.masterPassword = '';
      this.confirmPassword = '';
    } catch (e) {
      this.masterKeyError = e instanceof Error ? e.message : String(e);
    }
  }

  async unlock(): Promise<void> {
    if (!this.unlockPassword) return;
    const success = await this.cloudSync.unlock(this.unlockPassword);
    if (!success) {
      this.masterKeyError = this.translate.instant('cloudSync.incorrectPassword');
    } else {
      this.unlockPassword = '';
      this.masterKeyError = '';
    }
  }

  lock(): void {
    this.cloudSync.lock();
  }

  async changePassword(): Promise<void> {
    if (!this.masterPassword || this.masterPassword.length < 8) {
      this.masterKeyError = this.translate.instant('cloudSync.passwordMinLength');
      return;
    }
    if (this.masterPassword !== this.confirmPassword) {
      this.masterKeyError = this.translate.instant('cloudSync.passwordsDoNotMatch');
      return;
    }
    this.changingPassword = true;
    try {
      const success = await this.cloudSync.changeMasterPassword(this.unlockPassword, this.masterPassword);
      if (success) {
        this.masterPassword = '';
        this.confirmPassword = '';
        this.unlockPassword = '';
        this.masterKeyError = '';
        this.changingPassword = false;
      } else {
        this.masterKeyError = this.translate.instant('cloudSync.incorrectCurrentPassword');
        this.changingPassword = false;
      }
    } catch (e) {
      this.masterKeyError = e instanceof Error ? e.message : String(e);
      this.changingPassword = false;
    }
  }

  // ==========================================================================
  // Provider connection
  // ==========================================================================

  async connectGitHub(): Promise<void> {
    this.connectingProvider = 'github';
    this.connectError = null;
    try {
      const { startGitHubDeviceFlow } = await import('../services/cloudSync/adapters/github.adapter');
      const flow = await startGitHubDeviceFlow(this.githubClientId || undefined);
      this.githubUserCode = flow.userCode;
      this.githubVerificationUrl = flow.verificationUri;

      // Start polling in background
      this.cloudSync.connectGitHub(
        {
          deviceCode: flow.deviceCode,
          userCode: flow.userCode,
          verificationUri: flow.verificationUri,
          expiresAt: flow.expiresAt,
          interval: flow.interval,
        },
        this.githubClientId ? { clientId: this.githubClientId } : undefined,
      ).then(() => {
        this.connectingProvider = null;
        this.githubUserCode = '';
      }).catch((e) => {
        this.connectError = e instanceof Error ? e.message : String(e);
        this.connectingProvider = null;
        this.githubUserCode = '';
      });
    } catch (e) {
      this.connectError = e instanceof Error ? e.message : String(e);
      this.connectingProvider = null;
    }
  }

  async connectGoogle(): Promise<void> {
    if (!this.googleClientId) {
      this.connectError = this.translate.instant('cloudSync.clientIdRequired');
      return;
    }
    this.connectingProvider = 'google';
    this.connectError = null;
    try {
      await this.cloudSync.connectGoogle(
        this.oauthRedirectUrl,
        undefined,
        { clientId: this.googleClientId, clientSecret: this.googleClientSecret || undefined },
      );
    } catch (e) {
      this.connectError = e instanceof Error ? e.message : String(e);
      this.connectingProvider = null;
    }
  }

  async connectOneDrive(): Promise<void> {
    if (!this.onedriveClientId) {
      this.connectError = this.translate.instant('cloudSync.clientIdRequired');
      return;
    }
    this.connectingProvider = 'onedrive';
    this.connectError = null;
    try {
      await this.cloudSync.connectOneDrive(
        this.oauthRedirectUrl,
        undefined,
        { clientId: this.onedriveClientId },
      );
    } catch (e) {
      this.connectError = e instanceof Error ? e.message : String(e);
      this.connectingProvider = null;
    }
  }

  async connectWebDAV(): Promise<void> {
    if (!this.webdavEndpoint) {
      this.connectError = this.translate.instant('cloudSync.webdavEndpointRequired');
      return;
    }
    this.connectingProvider = 'webdav';
    this.connectError = null;
    try {
      const config: WebDAVConfig = {
        endpoint: this.webdavEndpoint,
        authType: this.webdavAuthType,
        username: this.webdavUsername || undefined,
        password: this.webdavPassword || undefined,
        token: this.webdavToken || undefined,
        allowInsecure: this.webdavAllowInsecure,
      };
      await this.cloudSync.connectWebDAV(config);
      this.clearWebDAVForm();
    } catch (e) {
      this.connectError = e instanceof Error ? e.message : String(e);
    } finally {
      this.connectingProvider = null;
    }
  }

  async connectS3(): Promise<void> {
    if (!this.s3Endpoint || !this.s3Bucket || !this.s3AccessKeyId || !this.s3SecretAccessKey) {
      this.connectError = this.translate.instant('cloudSync.s3CredentialsRequired');
      return;
    }
    this.connectingProvider = 's3';
    this.connectError = null;
    try {
      const config: S3Config = {
        endpoint: this.s3Endpoint,
        region: this.s3Region,
        bucket: this.s3Bucket,
        accessKeyId: this.s3AccessKeyId,
        secretAccessKey: this.s3SecretAccessKey,
        sessionToken: this.s3SessionToken || undefined,
        prefix: this.s3Prefix || undefined,
        forcePathStyle: true,
      };
      await this.cloudSync.connectS3(config);
      this.clearS3Form();
    } catch (e) {
      this.connectError = e instanceof Error ? e.message : String(e);
    } finally {
      this.connectingProvider = null;
    }
  }

  async disconnect(provider: CloudProvider): Promise<void> {
    const confirmed = await this.platform.showMessageBox({
      type: 'warning',
      message: this.translate.instant('cloudSync.disconnectConfirm', { provider: this.getProviderName(provider) }),
      detail: this.translate.instant('cloudSync.disconnectDetail'),
      buttons: [this.translate.instant('cloudSync.disconnect'), this.translate.instant('cloudSync.cancel')],
      defaultId: 1,
      cancelId: 1,
    });
    if (confirmed.response === 0) {
      await this.cloudSync.disconnectProvider(provider);
    }
  }

  // ==========================================================================
  // Sync operations
  // ==========================================================================

  async syncNow(): Promise<void> {
    this.syncing = true;
    this.syncError = null;
    try {
      await this.cloudSync.syncNow(async () => await this.payloadBuilder.buildPayload());
    } catch (e) {
      this.syncError = e instanceof Error ? e.message : String(e);
    } finally {
      this.syncing = false;
    }
  }

  async resolveConflict(resolution: 'USE_LOCAL' | 'USE_REMOTE'): Promise<void> {
    try {
      if (resolution === 'USE_LOCAL') {
        await this.cloudSync.resolveConflict(
          resolution,
          await this.payloadBuilder.buildPayload(),
        );
      } else {
        await this.cloudSync.resolveConflict(resolution);
      }
    } catch (e) {
      this.syncError = e instanceof Error ? e.message : String(e);
    }
  }

  // ==========================================================================
  // Auto-sync
  // ==========================================================================

  toggleAutoSync(): void {
    if (this.state?.autoSyncEnabled) {
      this.cloudSync.disableAutoSync();
    } else {
      this.cloudSync.enableAutoSync();
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  getProviderName(provider: CloudProvider): string {
    switch (provider) {
      case 'github': return 'GitHub Gist';
      case 'google': return 'Google Drive';
      case 'onedrive': return 'OneDrive';
      case 'webdav': return 'WebDAV';
      case 's3': return 'S3';
    }
  }

  getProviderIcon(provider: CloudProvider): string {
    switch (provider) {
      case 'github': return 'fab fa-github';
      case 'google': return 'fab fa-google';
      case 'onedrive': return 'fab fa-microsoft';
      case 'webdav': return 'fas fa-cloud';
      case 's3': return 'fas fa-database';
    }
  }

  getProviderStatus(provider: CloudProvider): string {
    const conn = this.state?.providers[provider];
    if (!conn) return 'disconnected';
    return conn.status;
  }

  isProviderConnected(provider: CloudProvider): boolean {
    const conn = this.state?.providers[provider];
    return conn?.status === 'connected' || conn?.status === 'syncing';
  }

  isProviderConnecting(provider: CloudProvider): boolean {
    const conn = this.state?.providers[provider];
    return conn?.status === 'connecting';
  }

  isProviderSyncing(provider: CloudProvider): boolean {
    const conn = this.state?.providers[provider];
    return conn?.status === 'syncing';
  }

  isProviderError(provider: CloudProvider): boolean {
    const conn = this.state?.providers[provider];
    return conn?.status === 'error';
  }

  getProviderError(provider: CloudProvider): string | undefined {
    return this.state?.providers[provider]?.error;
  }

  formatLastSync(timestamp?: number): string {
    return formatLastSync(timestamp, (key) => this.translate.instant(key));
  }

  hasConflict(): boolean {
    return this.state?.currentConflict != null;
  }

  getConflict(): ConflictInfo | null {
    return this.state?.currentConflict ?? null;
  }

  getConnectedProviders(): CloudProvider[] {
    if (!this.state) return [];
    return (['github', 'google', 'onedrive', 'webdav', 's3'] as CloudProvider[]).filter(
      (p) => this.isProviderConnected(p),
    );
  }

  hasAnyConnectedProvider(): boolean {
    return this.getConnectedProviders().length > 0;
  }

  // ==========================================================================
  // Event handlers
  // ==========================================================================

  private handleSyncEvent(event: SyncEvent): void {
    switch (event.type) {
      case 'SYNC_ERROR':
        this.syncError = event.error;
        this.syncing = false;
        break;
      case 'SYNC_COMPLETED':
        this.syncing = false;
        this.syncError = null;
        break;
      case 'CONFLICT_DETECTED':
        this.syncing = false;
        break;
    }
    this.cdr.markForCheck();
  }

  private getOAuthRedirectUrl(): string {
    // In Electron, use a custom protocol. In browser, use loopback.
    return 'http://localhost:3847/cloud-sync/oauth/callback';
  }

  private clearWebDAVForm(): void {
    this.webdavEndpoint = '';
    this.webdavUsername = '';
    this.webdavPassword = '';
    this.webdavToken = '';
  }

  private clearS3Form(): void {
    this.s3Endpoint = '';
    this.s3AccessKeyId = '';
    this.s3SecretAccessKey = '';
    this.s3SessionToken = '';
    this.s3Prefix = '';
  }
}
