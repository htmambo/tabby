/**
 * CloudSyncManager - Central Orchestrator for Multi-Cloud Sync
 *
 * Manages:
 * - Security state machine (NO_KEY → LOCKED → UNLOCKED)
 * - Sync state machine (IDLE → SYNCING → CONFLICT/ERROR)
 * - Provider adapters (GitHub, Google, OneDrive, WebDAV, S3)
 * - Version conflict detection and resolution
 * - Auto-sync scheduling
 */

import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject } from 'rxjs';
import {
  type CloudProvider,
  type SecurityState,
  type SyncState,
  type SyncPayload,
  type SyncResult,
  type ConflictInfo,
  type ConflictResolution,
  type MasterKeyConfig,
  type UnlockedMasterKey,
  type ProviderConnection,
  type SyncEvent,
  type SyncHistoryEntry,
  type WebDAVConfig,
  type S3Config,
  SYNC_CONSTANTS,
  SYNC_STORAGE_KEYS,
  generateDeviceId,
  getDefaultDeviceName,
  isProviderReadyForSync,
} from './domain/types';
import { mergeSyncPayloads } from './domain/merge';
import { CloudSyncEncryptionService } from './crypto/encryption.service';
import { createAdapter, CloudAdapter } from './adapters';

// ============================================================================
// State Types
// ============================================================================

export interface SyncManagerState {
  securityState: SecurityState;
  syncState: SyncState;
  masterKeyConfig: MasterKeyConfig | null;
  unlockedKey: UnlockedMasterKey | null;
  providers: Record<CloudProvider, ProviderConnection>;
  deviceId: string;
  deviceName: string;
  localVersion: number;
  localUpdatedAt: number;
  remoteVersion: number;
  remoteUpdatedAt: number;
  currentConflict: ConflictInfo | null;
  lastError: string | null;
  autoSyncEnabled: boolean;
  autoSyncInterval: number;
  syncHistory: SyncHistoryEntry[];
}

const ALL_PROVIDERS: CloudProvider[] = ['github', 'google', 'onedrive', 'webdav', 's3'];
const SYNC_HISTORY_STORAGE_KEY = 'tabby_sync_history_v1';

const EMPTY_STATE: SyncManagerState = {
  securityState: 'NO_KEY',
  syncState: 'IDLE',
  masterKeyConfig: null,
  unlockedKey: null,
  providers: {
    github: { provider: 'github', status: 'disconnected' },
    google: { provider: 'google', status: 'disconnected' },
    onedrive: { provider: 'onedrive', status: 'disconnected' },
    webdav: { provider: 'webdav', status: 'disconnected' },
    s3: { provider: 's3', status: 'disconnected' },
  },
  deviceId: '',
  deviceName: '',
  localVersion: 0,
  localUpdatedAt: 0,
  remoteVersion: 0,
  remoteUpdatedAt: 0,
  currentConflict: null,
  lastError: null,
  autoSyncEnabled: false,
  autoSyncInterval: SYNC_CONSTANTS.DEFAULT_AUTO_SYNC_INTERVAL,
  syncHistory: [],
};

// ============================================================================
// CloudSyncManager Service
// ============================================================================

/** @hidden */
@Injectable({ providedIn: 'root' })
export class CloudSyncManagerService implements OnDestroy {
  private state: SyncManagerState;
  private state$ = new BehaviorSubject<SyncManagerState>(EMPTY_STATE);
  private eventSubject = new Subject<SyncEvent>();
  private adapters = new Map<CloudProvider, CloudAdapter>();
  private autoSyncTimer: ReturnType<typeof setInterval> | null = null;
  private autoSyncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private autoSyncDebouncePending = false;
  private destroyed = false;
  private hasStorageListener = false;
  private syncBasePayload: SyncPayload | null = null;
  private masterPassword: string | null = null; // In memory only!
  private appVersion = '1.0.0'; // TODO: get from package.json

  readonly events$: Observable<SyncEvent> = this.eventSubject.asObservable();

  constructor(
    private zone: NgZone,
    private encryption: CloudSyncEncryptionService,
  ) {
    this.state = this.loadInitialState();
    this.state$.next(this.state);
    this.setupCrossWindowSync();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopAutoSync();
  }

  // ==========================================================================
  // State Access
  // ==========================================================================

  getState(): SyncManagerState {
    return this.state$.getValue();
  }

  getState$(): Observable<SyncManagerState> {
    return this.state$.asObservable();
  }

  // ==========================================================================
  // Security State Machine
  // ==========================================================================

  /**
   * Set up a new master key
   */
  async setupMasterKey(password: string): Promise<void> {
    const config = await this.encryption.createMasterKeyConfig(password);
    this.saveToStorage(SYNC_STORAGE_KEYS.MASTER_KEY_CONFIG, config);
    this.masterPassword = password;

    this.state = {
      ...this.state,
      masterKeyConfig: config,
      securityState: 'UNLOCKED',
    };
    this.state$.next(this.state);
    this.emit({ type: 'SECURITY_STATE_CHANGED', state: 'UNLOCKED' });
  }

  /**
   * Unlock with existing master key
   */
  async unlock(password: string): Promise<boolean> {
    if (!this.state.masterKeyConfig) return false;
    const unlocked = await this.encryption.unlockMasterKey(password, this.state.masterKeyConfig);
    if (!unlocked) return false;

    this.masterPassword = password;
    this.state = {
      ...this.state,
      unlockedKey: unlocked,
      securityState: 'UNLOCKED',
    };
    this.state$.next(this.state);
    this.emit({ type: 'SECURITY_STATE_CHANGED', state: 'UNLOCKED' });
    return true;
  }

  /**
   * Lock the vault
   */
  lock(): void {
    this.masterPassword = null;
    this.state = {
      ...this.state,
      unlockedKey: null,
      securityState: this.state.masterKeyConfig ? 'LOCKED' : 'NO_KEY',
    };
    this.state$.next(this.state);
    this.emit({ type: 'SECURITY_STATE_CHANGED', state: this.state.securityState });
  }

  /**
   * Change master password
   */
  async changeMasterPassword(oldPassword: string, newPassword: string): Promise<boolean> {
    if (!this.state.masterKeyConfig) return false;
    const newConfig = await this.encryption.changeMasterPassword(
      oldPassword, newPassword, this.state.masterKeyConfig,
    );
    if (!newConfig) return false;

    this.saveToStorage(SYNC_STORAGE_KEYS.MASTER_KEY_CONFIG, newConfig);
    this.masterPassword = newPassword;
    this.state = { ...this.state, masterKeyConfig: newConfig };
    this.state$.next(this.state);
    return true;
  }

  /**
   * Remove the master key entirely
   */
  removeMasterKey(): void {
    this.masterPassword = null;
    this.removeFromStorage(SYNC_STORAGE_KEYS.MASTER_KEY_CONFIG);
    this.state = {
      ...this.state,
      masterKeyConfig: null,
      unlockedKey: null,
      securityState: 'NO_KEY',
    };
    this.state$.next(this.state);
    this.emit({ type: 'SECURITY_STATE_CHANGED', state: 'NO_KEY' });
  }

  // ==========================================================================
  // Provider Connection
  // ==========================================================================

  async connectGitHub(
    deviceFlowState: { deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number },
    oauthConfig?: { clientId: string },
  ): Promise<void> {
    const provider: CloudProvider = 'github';
    this.updateProviderStatus(provider, 'connecting');

    try {
      const adapter = this.getAdapter(provider);
      const { startGitHubDeviceFlow, pollGitHubToken } = await import('./adapters/github.adapter');

      // Start device flow with optional custom client ID
      const flow = await startGitHubDeviceFlow(oauthConfig?.clientId);
      Object.assign(flow, deviceFlowState);

      // Poll for token (this is async and may take a while)
      const tokens = await pollGitHubToken(flow.deviceCode, flow.interval, flow.expiresAt, oauthConfig?.clientId);
      if (!tokens) throw new Error('Failed to obtain access token');

      await adapter.setTokens(tokens);
      const resourceId = await adapter.initializeSync();

      const connection: ProviderConnection = {
        provider,
        status: 'connected',
        account: adapter.accountInfo ?? undefined,
        tokens,
        resourceId: resourceId || undefined,
        config: oauthConfig ? { clientId: oauthConfig.clientId } : undefined,
      };

      this.state = {
        ...this.state,
        providers: { ...this.state.providers, [provider]: connection },
      };
      await this.saveProviderConnection(provider, connection);
      this.state$.next(this.state);
      this.emit({ type: 'AUTH_COMPLETED', provider, account: adapter.accountInfo ?? undefined });
    } catch (error) {
      this.updateProviderError(provider, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async connectGoogle(
    redirectUri: string,
    authCode?: string,
    oauthConfig?: { clientId: string; clientSecret?: string },
  ): Promise<void> {
    const provider: CloudProvider = 'google';
    this.updateProviderStatus(provider, 'connecting');

    try {
      // Create adapter and store it so PKCE state persists across OAuth steps
      const adapter = this.getAdapter(provider);
      const { buildGoogleAuthUrl, exchangeGoogleCode } = await import('./adapters/googledrive.adapter');

      if (!authCode) {
        // Start auth: generate URL and store PKCE state in the adapter
        const { url, pkce } = await buildGoogleAuthUrl(redirectUri, oauthConfig?.clientId);
        // Store PKCE state in the adapter for later use
        (adapter as any)._pkce = pkce;
        this.state = {
          ...this.state,
          providers: { ...this.state.providers, [provider]: { provider, status: 'connecting' } },
        };
        this.state$.next(this.state);
        // Return the URL for the UI to open; caller should call back with auth code
        void this.openOAuthUrl(url);
        return;
      }

      // Complete auth with code
      const pkce = (adapter as any)._pkce as { codeVerifier: string; codeChallenge: string; state: string } | undefined;
      if (!pkce) throw new Error('No PKCE challenge found - auth may have expired');
      const tokens = await exchangeGoogleCode(authCode, pkce.codeVerifier, redirectUri, oauthConfig?.clientId, oauthConfig?.clientSecret);
      await adapter.setTokens(tokens);
      const resourceId = await adapter.initializeSync();

      const connection: ProviderConnection = {
        provider,
        status: 'connected',
        account: adapter.accountInfo ?? undefined,
        tokens,
        resourceId: resourceId || undefined,
        config: oauthConfig ? { clientId: oauthConfig.clientId, clientSecret: oauthConfig.clientSecret } : undefined,
      };

      this.state = {
        ...this.state,
        providers: { ...this.state.providers, [provider]: connection },
      };
      await this.saveProviderConnection(provider, connection);
      this.state$.next(this.state);
      this.emit({ type: 'AUTH_COMPLETED', provider, account: adapter.accountInfo ?? undefined });
    } catch (error) {
      this.updateProviderError(provider, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async connectOneDrive(
    redirectUri: string,
    authCode?: string,
    oauthConfig?: { clientId: string },
  ): Promise<void> {
    const provider: CloudProvider = 'onedrive';
    this.updateProviderStatus(provider, 'connecting');

    try {
      const adapter = this.getAdapter(provider);
      const { buildOneDriveAuthUrl, exchangeOneDriveCode } = await import('./adapters/onedrive.adapter');

      if (!authCode) {
        const { url, pkce } = await buildOneDriveAuthUrl(redirectUri, oauthConfig?.clientId);
        (adapter as any)._pkce = pkce;
        this.state = {
          ...this.state,
          providers: { ...this.state.providers, [provider]: { provider, status: 'connecting' } },
        };
        this.state$.next(this.state);
        void this.openOAuthUrl(url);
        return;
      }

      const pkce = (adapter as any)._pkce as { codeVerifier: string; codeChallenge: string; state: string } | undefined;
      if (!pkce) throw new Error('No PKCE challenge found - auth may have expired');
      const tokens = await exchangeOneDriveCode(authCode, pkce.codeVerifier, redirectUri, oauthConfig?.clientId);
      await adapter.setTokens(tokens);
      const resourceId = await adapter.initializeSync();

      const connection: ProviderConnection = {
        provider,
        status: 'connected',
        account: adapter.accountInfo ?? undefined,
        tokens,
        resourceId: resourceId || undefined,
        config: oauthConfig ? { clientId: oauthConfig.clientId } : undefined,
      };

      this.state = {
        ...this.state,
        providers: { ...this.state.providers, [provider]: connection },
      };
      await this.saveProviderConnection(provider, connection);
      this.state$.next(this.state);
      this.emit({ type: 'AUTH_COMPLETED', provider, account: adapter.accountInfo ?? undefined });
    } catch (error) {
      this.updateProviderError(provider, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async connectWebDAV(config: WebDAVConfig): Promise<void> {
    const provider: CloudProvider = 'webdav';
    this.updateProviderStatus(provider, 'connecting');

    try {
      const adapter = this.getAdapter(provider);
      const resourceId = await adapter.initializeSync();

      const connection: ProviderConnection = {
        provider,
        status: 'connected',
        config,
        resourceId: resourceId || undefined,
      };

      this.state = {
        ...this.state,
        providers: { ...this.state.providers, [provider]: connection },
      };
      await this.saveProviderConnection(provider, connection);
      this.state$.next(this.state);
      this.emit({ type: 'AUTH_COMPLETED', provider, account: adapter.accountInfo ?? undefined });
    } catch (error) {
      this.updateProviderError(provider, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async connectS3(config: S3Config): Promise<void> {
    const provider: CloudProvider = 's3';
    this.updateProviderStatus(provider, 'connecting');

    try {
      const adapter = this.getAdapter(provider);
      const resourceId = await adapter.initializeSync();

      const connection: ProviderConnection = {
        provider,
        status: 'connected',
        config,
        resourceId: resourceId || undefined,
      };

      this.state = {
        ...this.state,
        providers: { ...this.state.providers, [provider]: connection },
      };
      await this.saveProviderConnection(provider, connection);
      this.state$.next(this.state);
      this.emit({ type: 'AUTH_COMPLETED', provider, account: adapter.accountInfo ?? undefined });
    } catch (error) {
      this.updateProviderError(provider, error instanceof Error ? error.message : 'Unknown error');
      throw error;
    }
  }

  async disconnectProvider(provider: CloudProvider): Promise<void> {
    const adapter = this.getAdapter(provider);
    await adapter.deleteSync();
    adapter.signOut();
    this.adapters.delete(provider);
    this.removeFromStorage(SYNC_STORAGE_KEYS[`PROVIDER_${provider.toUpperCase()}` as keyof typeof SYNC_STORAGE_KEYS]);

    this.state = {
      ...this.state,
      providers: {
        ...this.state.providers,
        [provider]: { provider, status: 'disconnected' },
      },
    };
    this.state$.next(this.state);
  }

  // ==========================================================================
  // Sync Operations
  // ==========================================================================

  /**
   * Trigger a sync now
   * @param payloadBuilder - function that returns the current SyncPayload
   */
  async syncNow(payloadBuilder: () => Promise<SyncPayload>): Promise<void> {
    if (this.state.securityState !== 'UNLOCKED' || !this.masterPassword) {
      throw new Error('Vault is not unlocked');
    }

    const connectedProviders = ALL_PROVIDERS.filter(p =>
      isProviderReadyForSync(this.state.providers[p]),
    );

    if (connectedProviders.length === 0) {
      throw new Error('No cloud provider connected');
    }

    this.state = { ...this.state, syncState: 'SYNCING', lastError: null };
    this.state$.next(this.state);

    const results = new Map<CloudProvider, SyncResult>();

    for (const provider of connectedProviders) {
      this.emit({ type: 'SYNC_STARTED', provider });
      this.updateProviderStatus(provider, 'syncing');

      try {
        const adapter = this.getAdapter(provider);
        const localPayload = await payloadBuilder();
        const remoteFile = await adapter.download();

        if (!remoteFile) {
          // First sync - upload
          const syncedFile = await this.encryption.encryptPayload(
            localPayload, this.masterPassword, this.state.deviceId,
            this.state.deviceName, this.appVersion, 0,
          );
          await adapter.upload(syncedFile);
          this.syncBasePayload = localPayload;
          results.set(provider, { success: true, provider, action: 'upload', version: 1 });
        } else {
          // Download remote and attempt merge
          const remotePayload = await this.encryption.decryptPayload(remoteFile, this.masterPassword);

          const { payload: mergedPayload, hadConflicts } = mergeSyncPayloads(
            this.syncBasePayload, localPayload, remotePayload,
          );

          if (!hadConflicts) {
            // No conflicts - upload merged
            const syncedFile = await this.encryption.encryptPayload(
              mergedPayload, this.masterPassword, this.state.deviceId,
              this.state.deviceName, this.appVersion, remoteFile.meta.version,
            );
            await adapter.upload(syncedFile);
            this.syncBasePayload = mergedPayload;
            results.set(provider, {
              success: true, provider, action: 'merge', version: syncedFile.meta.version,
            });
          } else {
            // Conflicts detected - store conflict info
            const conflict: ConflictInfo = {
              provider,
              localVersion: this.state.localVersion,
              localUpdatedAt: this.state.localUpdatedAt,
              localDeviceName: this.state.deviceName,
              remoteVersion: remoteFile.meta.version,
              remoteUpdatedAt: remoteFile.meta.updatedAt,
              remoteDeviceName: remoteFile.meta.deviceName,
            };

            this.state = {
              ...this.state,
              currentConflict: conflict,
              syncState: 'CONFLICT',
            };
            this.state$.next(this.state);
            this.emit({ type: 'CONFLICT_DETECTED', conflict });

            results.set(provider, {
              success: false, provider, action: 'merge', version: remoteFile.meta.version,
              conflictDetected: true, mergedPayload,
            });
            return; // Stop sync, wait for conflict resolution
          }
        }

        this.updateProviderLastSync(provider, remoteFile?.meta.version || 1);
        this.emit({
          type: 'SYNC_COMPLETED',
          provider,
          result: results.get(provider)!,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.updateProviderError(provider, errorMsg);
        results.set(provider, { success: false, provider, action: 'none', error: errorMsg });
        this.emit({ type: 'SYNC_ERROR', provider, error: errorMsg });
      }
    }

    const hasError = [...results.values()].some(r => !r.success);
    this.state = {
      ...this.state,
      syncState: hasError ? 'ERROR' : 'IDLE',
    };
    this.state$.next(this.state);

    // Auto-sync: save base for next merge
    if (!hasError && !this.state.currentConflict) {
      this.saveSyncMeta();
    }
  }

  /**
   * Resolve a detected conflict
   */
  async resolveConflict(
    resolution: ConflictResolution,
    localPayload?: SyncPayload,
  ): Promise<void> {
    if (!this.state.currentConflict || !this.masterPassword) return;

    const provider = this.state.currentConflict.provider;
    const adapter = this.getAdapter(provider);

    try {
      let payload: SyncPayload;
      if (resolution === 'USE_REMOTE') {
        const remoteFile = await adapter.download();
        if (!remoteFile) throw new Error('No remote data');
        payload = await this.encryption.decryptPayload(remoteFile, this.masterPassword);
        // Use remote as new base
        this.syncBasePayload = payload;
      } else if (resolution === 'USE_LOCAL') {
        if (!localPayload) throw new Error('Local payload required');
        payload = localPayload;
        const syncedFile = await this.encryption.encryptPayload(
          payload, this.masterPassword, this.state.deviceId,
          this.state.deviceName, this.appVersion,
          this.state.currentConflict.remoteVersion,
        );
        await adapter.upload(syncedFile);
        this.syncBasePayload = payload;
      } else {
        // AUTO_MERGED - this shouldn't happen since we detect conflicts
        throw new Error('AUTO_MERGED conflicts should not reach this point');
      }

      this.state = {
        ...this.state,
        currentConflict: null,
        syncState: 'IDLE',
      };
      this.state$.next(this.state);
      this.emit({ type: 'CONFLICT_RESOLVED', resolution });
      this.saveSyncMeta();
    } catch (error) {
      this.state = {
        ...this.state,
        lastError: error instanceof Error ? error.message : 'Unknown error',
        syncState: 'ERROR',
      };
      this.state$.next(this.state);
    }
  }

  // ==========================================================================
  // Auto-sync
  // ==========================================================================

  enableAutoSync(intervalMinutes?: number): void {
    const interval = intervalMinutes ?? SYNC_CONSTANTS.DEFAULT_AUTO_SYNC_INTERVAL;
    this.state = {
      ...this.state,
      autoSyncEnabled: true,
      autoSyncInterval: Math.max(SYNC_CONSTANTS.MIN_SYNC_INTERVAL, Math.min(SYNC_CONSTANTS.MAX_SYNC_INTERVAL, interval)),
    };
    this.saveSyncConfig();
    this.state$.next(this.state);
    this.startAutoSync();
  }

  disableAutoSync(): void {
    this.stopAutoSync();
    this.state = { ...this.state, autoSyncEnabled: false };
    this.saveSyncConfig();
    this.state$.next(this.state);
  }

  /**
   * Trigger auto-sync with debounce
   */
  triggerAutoSyncDebounced(payloadBuilder: () => Promise<SyncPayload>): void {
    if (!this.state.autoSyncEnabled || this.autoSyncDebouncePending) return;
    if (this.state.syncState === 'SYNCING') return;

    this.autoSyncDebouncePending = true;
    if (this.autoSyncDebounceTimer) clearTimeout(this.autoSyncDebounceTimer);

    this.autoSyncDebounceTimer = setTimeout(async () => {
      this.autoSyncDebouncePending = false;
      if (!this.destroyed && this.state.autoSyncEnabled) {
        try {
          await this.syncNow(payloadBuilder);
        } catch {
          // Auto-sync errors are non-fatal
        }
      }
    }, 3000); // 3 second debounce
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getAdapter(provider: CloudProvider): CloudAdapter {
    if (this.adapters.has(provider)) {
      return this.adapters.get(provider)!;
    }

    const connection = this.state.providers[provider];
    // Only pass WebDAV or S3 config to the adapter factory (not OAuth config)
    const config = connection.config;
    const storageConfig = (config && 'authType' in config)
      ? config as WebDAVConfig
      : (config && 'region' in config)
        ? config as S3Config
        : undefined;
    const adapter = createAdapter(
      provider,
      connection.tokens,
      connection.resourceId,
      storageConfig,
    );

    if (connection.tokens) {
      adapter.setTokens(connection.tokens).catch(() => {
        // Token might be invalid, that's okay
      });
    }

    this.adapters.set(provider, adapter);
    return adapter;
  }

  private updateProviderStatus(provider: CloudProvider, status: ProviderConnection['status']): void {
    this.state = {
      ...this.state,
      providers: {
        ...this.state.providers,
        [provider]: { ...this.state.providers[provider], status, error: undefined },
      },
    };
    this.state$.next(this.state);
  }

  private updateProviderError(provider: CloudProvider, error: string): void {
    this.state = {
      ...this.state,
      providers: {
        ...this.state.providers,
        [provider]: { ...this.state.providers[provider], status: 'error', error },
      },
    };
    this.state$.next(this.state);
  }

  private updateProviderLastSync(provider: CloudProvider, version: number): void {
    const now = Date.now();
    this.state = {
      ...this.state,
      providers: {
        ...this.state.providers,
        [provider]: {
          ...this.state.providers[provider],
          lastSync: now,
          lastSyncVersion: version,
        },
      },
      localVersion: version,
      localUpdatedAt: now,
    };
    this.saveSyncConfig();
  }

  private loadInitialState(): SyncManagerState {
    const masterKeyConfig = this.loadFromStorage<MasterKeyConfig>(SYNC_STORAGE_KEYS.MASTER_KEY_CONFIG);
    const deviceId = this.loadFromStorage<string>(SYNC_STORAGE_KEYS.DEVICE_ID) || generateDeviceId();
    const deviceName = this.loadFromStorage<string>(SYNC_STORAGE_KEYS.DEVICE_NAME) || getDefaultDeviceName();

    const syncConfig = this.loadFromStorage<{
      autoSync: boolean; interval: number; localVersion: number; localUpdatedAt: number;
      remoteVersion: number; remoteUpdatedAt: number;
    }>(SYNC_STORAGE_KEYS.SYNC_CONFIG);

    const syncHistory = this.loadFromStorage<SyncHistoryEntry[]>(SYNC_HISTORY_STORAGE_KEY) || [];

    // Save device ID if new
    this.saveToStorage(SYNC_STORAGE_KEYS.DEVICE_ID, deviceId);
    this.saveToStorage(SYNC_STORAGE_KEYS.DEVICE_NAME, deviceName);

    const providers: Record<CloudProvider, ProviderConnection> = {} as Record<CloudProvider, ProviderConnection>;
    for (const p of ALL_PROVIDERS) {
      const key = SYNC_STORAGE_KEYS[`PROVIDER_${p.toUpperCase()}` as keyof typeof SYNC_STORAGE_KEYS];
      const stored = this.loadFromStorage<Partial<ProviderConnection>>(key);
      const connStatus: ProviderConnection['status'] = (stored?.tokens || stored?.config)
        ? 'connected' : 'disconnected';
      providers[p] = {
        provider: p,
        status: connStatus,
        ...stored,
      } as ProviderConnection;
    }

    return {
      ...EMPTY_STATE,
      masterKeyConfig,
      securityState: masterKeyConfig ? 'LOCKED' : 'NO_KEY',
      providers,
      deviceId,
      deviceName,
      localVersion: syncConfig?.localVersion || 0,
      localUpdatedAt: syncConfig?.localUpdatedAt || 0,
      remoteVersion: syncConfig?.remoteVersion || 0,
      remoteUpdatedAt: syncConfig?.remoteUpdatedAt || 0,
      autoSyncEnabled: syncConfig?.autoSync || false,
      autoSyncInterval: syncConfig?.interval || SYNC_CONSTANTS.DEFAULT_AUTO_SYNC_INTERVAL,
      syncHistory,
    };
  }

  private loadFromStorage<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private saveToStorage(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage might be full
    }
  }

  private removeFromStorage(key: string): void {
    localStorage.removeItem(key);
  }

  private async saveProviderConnection(provider: CloudProvider, connection: ProviderConnection): Promise<void> {
    const key = SYNC_STORAGE_KEYS[`PROVIDER_${provider.toUpperCase()}` as keyof typeof SYNC_STORAGE_KEYS];
    this.saveToStorage(key, connection);
  }

  private saveSyncConfig(): void {
    this.saveToStorage(SYNC_STORAGE_KEYS.SYNC_CONFIG, {
      autoSync: this.state.autoSyncEnabled,
      interval: this.state.autoSyncInterval,
      localVersion: this.state.localVersion,
      localUpdatedAt: this.state.localUpdatedAt,
      remoteVersion: this.state.remoteVersion,
      remoteUpdatedAt: this.state.remoteUpdatedAt,
    });
  }

  private saveSyncMeta(): void {
    this.saveSyncConfig();
    this.state$.next(this.state);
  }

  private setupCrossWindowSync(): void {
    if (this.hasStorageListener) return;

    window.addEventListener('storage', this.handleStorageEvent);
    this.hasStorageListener = true;
  }

  private handleStorageEvent = (event: StorageEvent): void => {
    if (event.storageArea !== window.localStorage) return;
    const key = event.key;
    if (!key) return;

    // Re-load state from storage when another window changes things
    this.zone.run(() => {
      if (key === SYNC_STORAGE_KEYS.MASTER_KEY_CONFIG) {
        const nextConfig = this.safeJsonParse<MasterKeyConfig>(event.newValue);
        if (nextConfig && !this.state.masterKeyConfig) {
          this.state = { ...this.state, masterKeyConfig: nextConfig, securityState: 'LOCKED' };
          this.state$.next(this.state);
        } else if (!nextConfig && this.state.masterKeyConfig) {
          this.state = { ...this.state, masterKeyConfig: null, securityState: 'NO_KEY', unlockedKey: null };
          this.state$.next(this.state);
        }
        return;
      }

      if (key === SYNC_STORAGE_KEYS.SYNC_CONFIG) {
        const next = this.safeJsonParse<{ autoSync?: boolean; interval?: number }>(event.newValue);
        if (next) {
          this.state = {
            ...this.state,
            autoSyncEnabled: Boolean(next.autoSync),
            autoSyncInterval: Number(next.interval ?? SYNC_CONSTANTS.DEFAULT_AUTO_SYNC_INTERVAL),
          };
          this.state$.next(this.state);
        }
        return;
      }

      // Provider changes
      for (const p of ALL_PROVIDERS) {
        const providerKey = SYNC_STORAGE_KEYS[`PROVIDER_${p.toUpperCase()}` as keyof typeof SYNC_STORAGE_KEYS];
        if (key === providerKey) {
          const nextConn = this.safeJsonParse<ProviderConnection>(event.newValue);
          if (nextConn) {
            this.state = {
              ...this.state,
              providers: { ...this.state.providers, [p]: nextConn },
            };
            this.adapters.delete(p); // Invalidate cached adapter
            this.state$.next(this.state);
          }
        }
      }
    });
  };

  private safeJsonParse<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private startAutoSync(): void {
    if (this.autoSyncTimer) return;
    const intervalMs = this.state.autoSyncInterval * 60 * 1000;
    this.autoSyncTimer = setInterval(() => {
      if (!this.destroyed && this.state.autoSyncEnabled) {
        // Interval-based polling is handled by the payload builder callback
      }
    }, intervalMs);
  }

  private stopAutoSync(): void {
    if (this.autoSyncTimer) {
      clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (this.autoSyncDebounceTimer) {
      clearTimeout(this.autoSyncDebounceTimer);
      this.autoSyncDebounceTimer = null;
    }
  }

  private emit(event: SyncEvent): void {
    this.eventSubject.next(event);
  }

  private async openOAuthUrl(url: string): Promise<void> {
    const bridge = (window as any).tabbyBridge;
    if (bridge?.shell?.openExternal) {
      await bridge.shell.openExternal(url);
    } else if (typeof window !== 'undefined') {
      window.open(url, '_blank');
    }
  }
}
