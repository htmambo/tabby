/**
 * Cloud Adapter Interface
 *
 * Unified interface for all cloud storage providers.
 */

import type {
  OAuthTokens,
  ProviderAccount,
  SyncedFile,
} from '../domain/types';

/**
 * Unified adapter interface for cloud storage providers
 */
export interface CloudAdapter {
  readonly isAuthenticated: boolean;
  readonly accountInfo: ProviderAccount | null;
  readonly resourceId: string | null;

  signOut(): void;
  initializeSync(): Promise<string | null>;
  upload(syncedFile: SyncedFile): Promise<string>;
  download(): Promise<SyncedFile | null>;
  deleteSync(): Promise<void>;
  getTokens(): OAuthTokens | null;

  /** Set OAuth tokens (only relevant for OAuth-based adapters). No-op for others. */
  setTokens(tokens: OAuthTokens): Promise<void>;

  /** Get PKCE state for OAuth flow (only relevant for PKCE-based adapters). Returns null for others. */
  getPKCEState(): string | null;
}
