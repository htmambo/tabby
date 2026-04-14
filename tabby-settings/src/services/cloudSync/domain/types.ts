/**
 * Cloud Sync Domain Types & Interfaces
 *
 * Zero-Knowledge Encrypted Multi-Cloud Sync System
 * Supports: GitHub Gist, Google Drive, Microsoft OneDrive, WebDAV, S3 Compatible
 */

import type { Profile, ProfileGroup } from 'tabby-core'

// ============================================================================
// Security State Machine
// ============================================================================

/**
 * Global Security State Machine
 * Controls access to sync operations based on master key status
 */
export type SecurityState =
  | 'NO_KEY'     // User has not set up a master key - block all sync
  | 'LOCKED'     // Master key exists but not in memory - show unlock screen
  | 'UNLOCKED';  // Master key in memory - sync operations allowed

/**
 * Sync Operation State Machine
 * Tracks the current sync operation status
 */
export type SyncState =
  | 'IDLE'       // Waiting for sync trigger
  | 'SYNCING'    // Active sync operation in progress
  | 'CONFLICT'   // Version conflict detected - needs resolution
  | 'ERROR';     // Operation failed - needs attention

/**
 * Conflict Resolution Strategy
 */
export type ConflictResolution =
  | 'USE_REMOTE'   // Download cloud data, overwrite local
  | 'USE_LOCAL'    // Upload local data, overwrite cloud
  | 'AUTO_MERGED'; // Three-way merge was applied automatically

// ============================================================================
// Cloud Provider Types
// ============================================================================

/**
 * Supported cloud storage providers
 */
export type CloudProvider = 'github' | 'google' | 'onedrive' | 'webdav' | 's3';

export type WebDAVAuthType = 'basic' | 'digest' | 'token';

export interface WebDAVConfig {
  endpoint: string;
  authType: WebDAVAuthType;
  username?: string;
  password?: string;
  token?: string;
  allowInsecure?: boolean;
}

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  prefix?: string;
  forcePathStyle?: boolean;
}

/**
 * OAuth configuration for GitHub, Google Drive, and OneDrive
 */
export interface OAuthConfig {
  clientId: string;
  clientSecret?: string;  // Not needed for GitHub device flow
  redirectUri?: string;
}

/**
 * Provider-specific connection status
 */
type ProviderConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'error';

/**
 * OAuth token storage structure
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;  // Unix timestamp
  tokenType: string;
  scope?: string;
}

/**
 * Provider account information
 */
export interface ProviderAccount {
  id: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
}

/**
 * Cloud provider connection state
 */
export interface ProviderConnection {
  provider: CloudProvider;
  status: ProviderConnectionStatus;
  account?: ProviderAccount;
  tokens?: OAuthTokens;
  config?: WebDAVConfig | S3Config | OAuthConfig;
  lastSync?: number;        // Unix timestamp
  lastSyncVersion?: number;
  resourceId?: string;      // gistId / fileId / itemId
  error?: string;
}

const hasProviderConnectionData = (
  connection: Pick<ProviderConnection, 'tokens' | 'config'>,
): boolean => Boolean(connection.tokens || connection.config);

export const isProviderReadyForSync = (
  connection: Pick<ProviderConnection, 'status' | 'tokens' | 'config'>,
): boolean =>
  connection.status === 'connected'
  || connection.status === 'syncing'
  || (connection.status === 'error' && hasProviderConnectionData(connection));

// ============================================================================
// Encrypted Sync File Schema
// ============================================================================

/**
 * Sync file metadata (stored in plaintext for version control)
 */
export interface SyncFileMeta {
  version: number;          // Incremental version number
  updatedAt: number;        // Unix timestamp (ms)
  deviceId: string;         // UUID identifying the device
  deviceName?: string;      // Human-readable device name
  appVersion: string;       // App version that created this sync
  iv: string;               // AES-GCM initialization vector (Base64)
  salt: string;             // KDF salt for key derivation (Base64)
  algorithm: 'AES-256-GCM'; // Encryption algorithm identifier
  kdf: 'PBKDF2' | 'Argon2id'; // Key derivation function
  kdfIterations?: number;   // PBKDF2 iterations (if applicable)
}

/**
 * Complete synced file structure
 * The payload contains all encrypted user data
 */
export interface SyncedFile {
  meta: SyncFileMeta;
  payload: string;          // Base64 encrypted ciphertext
}

/**
 * Decrypted payload structure - contains all syncable data
 */
export interface SyncPayload {
  // Core profile data (hosts and SSH keys)
  hosts: Profile[];
  keys: Profile[];          // SSH key profiles (profiles with type containing 'ssh')

  // Groups
  groups: ProfileGroup[];
  customGroups: string[];

  // Settings (subset of config.yaml)
  settings?: {
    theme?: string;
    colorSchemeMode?: 'dark' | 'light' | 'system';
    hotkeys?: Record<string, string>;
    terminal?: Record<string, unknown>;
    [key: string]: unknown;
  };

  // Encrypted vault data
  vault?: unknown;

  // Sync metadata
  syncedAt: number;         // When this payload was created
}

// ============================================================================
// Encryption Types
// ============================================================================

/**
 * Encryption result
 */
export interface EncryptionResult {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  algorithm: 'AES-256-GCM';
  kdf: 'PBKDF2' | 'Argon2id';
  kdfIterations?: number;
}

/**
 * Decryption input
 */
export interface DecryptionInput {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  salt: Uint8Array;
  kdf: 'PBKDF2' | 'Argon2id';
  kdfIterations?: number;
}

// ============================================================================
// Master Key Types
// ============================================================================

/**
 * Master key configuration stored in safeStorage
 */
export interface MasterKeyConfig {
  // Verification hash to confirm correct password
  verificationHash: string; // Base64 of hash(derived_key)
  salt: string;             // Base64 KDF salt
  kdf: 'PBKDF2' | 'Argon2id';
  kdfIterations?: number;
  createdAt: number;
}

/**
 * Unlocked master key state (in memory only)
 */
export interface UnlockedMasterKey {
  derivedKey: CryptoKey;    // AES-256-GCM key
  salt: Uint8Array;
  unlockedAt: number;
}

// ============================================================================
// Sync Manager Types
// ============================================================================

/**
 * Sync operation result
 */
export interface SyncResult {
  success: boolean;
  provider: CloudProvider;
  action: 'upload' | 'download' | 'merge' | 'none';
  version?: number;
  error?: string;
  conflictDetected?: boolean;
  /** Present when action === 'merge'; caller should apply this to update local state */
  mergedPayload?: SyncPayload;
}

/**
 * Conflict information for UI
 */
export interface ConflictInfo {
  provider: CloudProvider;
  localVersion: number;
  localUpdatedAt: number;
  localDeviceName?: string;
  remoteVersion: number;
  remoteUpdatedAt: number;
  remoteDeviceName?: string;
}

/**
 * Sync history record entry
 */
export interface SyncHistoryEntry {
  id: string;
  timestamp: number;
  provider: CloudProvider;
  action: 'upload' | 'download' | 'merge' | 'conflict_resolved';
  success: boolean;
  localVersion: number;
  remoteVersion?: number;
  deviceName?: string;
  error?: string;
}

// ============================================================================
// OAuth Flow Types
// ============================================================================

/**
 * GitHub Device Flow response
 */
export interface GitHubDeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

/**
 * OAuth PKCE challenge
 */
export interface PKCEChallenge {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Sync event for UI updates
 */
export type SyncEvent =
  | { type: 'SYNC_STARTED'; provider: CloudProvider }
  | { type: 'SYNC_PROGRESS'; provider: CloudProvider; progress: number; message: string }
  | { type: 'SYNC_COMPLETED'; provider: CloudProvider; result: SyncResult }
  | { type: 'SYNC_ERROR'; provider: CloudProvider; error: string }
  | { type: 'CONFLICT_DETECTED'; conflict: ConflictInfo }
  | { type: 'CONFLICT_RESOLVED'; resolution: ConflictResolution }
  | { type: 'AUTH_REQUIRED'; provider: CloudProvider }
  | { type: 'AUTH_COMPLETED'; provider: CloudProvider; account?: ProviderAccount }
  | { type: 'SECURITY_STATE_CHANGED'; state: SecurityState };

// ============================================================================
// Storage Keys
// ============================================================================

export const SYNC_STORAGE_KEYS = {
  MASTER_KEY_CONFIG: 'tabby_master_key_config_v1',
  DEVICE_ID: 'tabby_device_id_v1',
  DEVICE_NAME: 'tabby_device_name_v1',
  SYNC_CONFIG: 'tabby_sync_config_v2',
  PROVIDER_GITHUB: 'tabby_provider_github_v1',
  PROVIDER_GOOGLE: 'tabby_provider_google_v1',
  PROVIDER_ONEDRIVE: 'tabby_provider_onedrive_v1',
  PROVIDER_WEBDAV: 'tabby_provider_webdav_v1',
  PROVIDER_S3: 'tabby_provider_s3_v1',
  LOCAL_SYNC_META: 'tabby_local_sync_meta_v1',
  SYNC_BASE_PAYLOAD: 'tabby_sync_base_payload_v1',
} as const;

// ============================================================================
// Constants
// ============================================================================

export const SYNC_CONSTANTS = {
  // Encryption
  AES_KEY_LENGTH: 256,
  GCM_IV_LENGTH: 12,        // bytes
  GCM_TAG_LENGTH: 128,      // bits
  SALT_LENGTH: 32,          // bytes

  // PBKDF2
  PBKDF2_ITERATIONS: 600000, // OWASP recommended minimum
  PBKDF2_HASH: 'SHA-256',

  // Sync
  SYNC_FILE_NAME: 'tabby-vault.json',
  GIST_DESCRIPTION: 'Tabby Encrypted Vault (DO NOT EDIT MANUALLY)',

  // Auto-sync
  DEFAULT_AUTO_SYNC_INTERVAL: 5, // minutes
  MIN_SYNC_INTERVAL: 1,          // minutes
  MAX_SYNC_INTERVAL: 60,         // minutes

  // OAuth
  GITHUB_CLIENT_ID: '',
  GOOGLE_CLIENT_ID: '',
  GOOGLE_CLIENT_SECRET: '',
  ONEDRIVE_CLIENT_ID: '',

  // API endpoints
  GITHUB_DEVICE_CODE_URL: 'https://github.com/login/device/code',
  GITHUB_ACCESS_TOKEN_URL: 'https://github.com/login/oauth/access_token',
  GITHUB_API_BASE: 'https://api.github.com',

  GOOGLE_AUTH_URL: 'https://accounts.google.com/o/oauth2/v2/auth',
  GOOGLE_TOKEN_URL: 'https://oauth2.googleapis.com/token',
  GOOGLE_DRIVE_API: 'https://www.googleapis.com/drive/v3',

  ONEDRIVE_AUTH_URL: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize',
  ONEDRIVE_TOKEN_URL: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
  ONEDRIVE_GRAPH_API: 'https://graph.microsoft.com/v1.0',
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique device ID
 */
export const generateDeviceId = (): string => {
  return crypto.randomUUID();
};

/**
 * Get default device name based on OS
 */
export const getDefaultDeviceName = (): string => {
  const platform = navigator.platform || 'Unknown';
  return `Tabby (${platform})`;
};

/**
 * Format last sync time for display
 * @param timestamp - Unix timestamp in ms
 * @param t - Optional translate function. If not provided, returns raw strings.
 */
export const formatLastSync = (
  timestamp?: number,
  t?: (key: string) => string,
): string => {
  if (!timestamp) return t ? t('Never synced') : 'Never synced';

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 60000) return t ? t('Just now') : 'Just now';
  if (diff < 3600000) {
    const min = Math.floor(diff / 60000);
    const label = t ? t('{count} min ago') : `{count} min ago`;
    return label.replace('{count}', String(min));
  }
  if (diff < 86400000) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const date = new Date(timestamp);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

/**
 * Get status dot color class
 */
export const getSyncDotColor = (status: ProviderConnectionStatus): string => {
  switch (status) {
    case 'connected': return 'bg-green-500';
    case 'syncing': return 'bg-blue-500';
    case 'error': return 'bg-red-500';
    case 'connecting': return 'bg-yellow-500';
    default: return 'bg-muted-foreground';
  }
};
