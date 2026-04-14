/**
 * GitHub OAuth Adapter - Device Flow Implementation
 *
 * Uses Device Authorization Grant (RFC 8628) which doesn't require a client secret.
 *
 * Flow:
 * 1. Request device code from GitHub
 * 2. User opens browser and enters the code
 * 3. Poll for access token until user completes auth
 * 4. Use Gist API for sync file storage
 */

import {
  SYNC_CONSTANTS,
  type OAuthTokens,
  type ProviderAccount,
  type SyncedFile,
  type GitHubDeviceCodeResponse,
} from '../domain/types';
import { CloudAdapter } from './adapter.interface';

// ============================================================================
// Types
// ============================================================================

export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  email: string | null;
  avatar_url: string;
}

export interface GitHubGist {
  id: string;
  description: string;
  files: Record<string, { content: string; filename: string }>;
  created_at: string;
  updated_at: string;
}

export interface DeviceFlowState {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

// ============================================================================
// Helper: getTabbyBridge
// ============================================================================

function getTabbyBridge() {
  const win = window as Window & { tabbyBridge?: { ipc: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }; shell: { openExternal: (url: string) => Promise<void> } } };
  return win.tabbyBridge;
}

// ============================================================================
// Device Flow Authentication
// ============================================================================

/**
 * Start GitHub Device Flow authentication
 * Returns codes for user to enter in browser
 * @param clientId - GitHub OAuth App client ID (uses SYNC_CONSTANTS if not provided)
 */
export const startGitHubDeviceFlow = async (clientId?: string): Promise<DeviceFlowState> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.GITHUB_CLIENT_ID;
  if (!effectiveClientId) throw new Error('GitHub Client ID not configured');
  const bridge = getTabbyBridge();

  if (bridge?.ipc) {
    const result = await bridge.ipc.invoke('cloudSync:github:startDeviceFlow', {
      clientId: effectiveClientId,
      scope: 'gist read:user',
    }) as GitHubDeviceCodeResponse;

    return {
      deviceCode: result.device_code,
      userCode: result.user_code,
      verificationUri: result.verification_uri,
      expiresAt: Date.now() + result.expires_in * 1000,
      interval: result.interval,
    };
  }

  // Fallback: direct browser fetch
  const response = await fetch(SYNC_CONSTANTS.GITHUB_DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: effectiveClientId,
      scope: 'gist read:user',
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`GitHub device flow failed: ${response.status}`);
  }

  const data: GitHubDeviceCodeResponse = await response.json();

  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    expiresAt: Date.now() + data.expires_in * 1000,
    interval: data.interval,
  };
};

/**
 * Poll for access token after user authorizes
 * @param clientId - GitHub OAuth App client ID (uses SYNC_CONSTANTS if not provided)
 */
export const pollGitHubToken = async (
  deviceCode: string,
  interval: number,
  expiresAt: number,
  clientId?: string,
): Promise<OAuthTokens | null> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.GITHUB_CLIENT_ID;
  if (!effectiveClientId) throw new Error('GitHub Client ID not configured');
  const bridge = getTabbyBridge();
  const pollInterval = Math.max(interval, 5) * 1000;

  while (Date.now() < expiresAt) {
    await new Promise(resolve => setTimeout(resolve, pollInterval));

    let data: Record<string, unknown>;
    if (bridge?.ipc) {
      data = await bridge.ipc.invoke('cloudSync:github:pollToken', {
        clientId: effectiveClientId,
        deviceCode,
      }) as Record<string, unknown>;
    } else {
      const response = await fetch(SYNC_CONSTANTS.GITHUB_ACCESS_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: effectiveClientId,
          device_code: deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }).toString(),
      });
      data = await response.json();
    }

    if (data.access_token) {
      return {
        accessToken: data.access_token as string,
        tokenType: (data.token_type as string) || 'bearer',
        scope: data.scope as string | undefined,
      };
    }

    if (data.error === 'authorization_pending') continue;
    if (data.error === 'slow_down') {
      await new Promise(resolve => setTimeout(resolve, 5000));
      continue;
    }
    if (data.error === 'expired_token') throw new Error('Device code expired');
    if (data.error === 'access_denied') throw new Error('Access denied');
    if (data.error) throw new Error(`GitHub auth error: ${data.error_description || data.error}`);
  }

  throw new Error('Device code expired');
};

/**
 * Get authenticated user info
 */
export const getGitHubUserInfo = async (accessToken: string): Promise<ProviderAccount> => {
  const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info: ${response.statusText}`);
  }

  const user: GitHubUser = await response.json();

  return {
    id: String(user.id),
    email: user.email || undefined,
    name: user.name || user.login,
    avatarUrl: user.avatar_url,
  };
};

// ============================================================================
// GitHub Adapter Class
// ============================================================================

export class GitHubAdapter implements CloudAdapter {
  private accessToken: string | null = null;
  private gistId: string | null = null;
  private account: ProviderAccount | null = null;

  constructor(tokens?: OAuthTokens, gistId?: string) {
    if (tokens) {
      this.accessToken = tokens.accessToken;
    }
    this.gistId = gistId || null;
  }

  get isAuthenticated(): boolean {
    return !!this.accessToken;
  }

  get accountInfo(): ProviderAccount | null {
    return this.account;
  }

  get resourceId(): string | null {
    return this.gistId;
  }

  async setTokens(tokens: OAuthTokens): Promise<void> {
    this.accessToken = tokens.accessToken;
    try {
      this.account = await getGitHubUserInfo(tokens.accessToken);
    } catch {
      // Token might not be valid yet, that's okay
    }
  }

  getPKCEState(): string | null {
    return null; // GitHub uses Device Flow, not PKCE
  }

  signOut(): void {
    this.accessToken = null;
    this.gistId = null;
    this.account = null;
  }

  async initializeSync(): Promise<string | null> {
    if (!this.accessToken) throw new Error('Not authenticated');
    this.gistId = await this.findSyncGist();
    return this.gistId;
  }

  async upload(syncedFile: SyncedFile): Promise<string> {
    if (!this.accessToken) throw new Error('Not authenticated');

    if (this.gistId) {
      await this.updateSyncGist(this.gistId, syncedFile);
      return this.gistId;
    } else {
      this.gistId = await this.createSyncGist(syncedFile);
      return this.gistId;
    }
  }

  async download(): Promise<SyncedFile | null> {
    if (!this.accessToken) throw new Error('Not authenticated');

    if (!this.gistId) {
      this.gistId = await this.findSyncGist();
    }

    if (!this.gistId) return null;

    return this.downloadSyncGist(this.gistId);
  }

  async deleteSync(): Promise<void> {
    if (!this.accessToken || !this.gistId) return;
    await this.deleteSyncGist(this.gistId);
    this.gistId = null;
  }

  getTokens(): OAuthTokens | null {
    if (!this.accessToken) return null;
    return {
      accessToken: this.accessToken,
      tokenType: 'bearer',
    };
  }

  // ---------------------------------------------------------------------------
  // Private Gist operations
  // ---------------------------------------------------------------------------

  private async findSyncGist(): Promise<string | null> {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists?per_page=100`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) throw new Error(`Failed to list gists: ${response.statusText}`);

    const gists: GitHubGist[] = await response.json();
    const syncGist = gists.find(g =>
      g.description === SYNC_CONSTANTS.GIST_DESCRIPTION &&
      g.files[SYNC_CONSTANTS.SYNC_FILE_NAME],
    );

    return syncGist?.id || null;
  }

  private async createSyncGist(syncedFile: SyncedFile): Promise<string> {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: SYNC_CONSTANTS.GIST_DESCRIPTION,
        public: false,
        files: {
          [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
            content: JSON.stringify(syncedFile, null, 2),
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Failed to create gist: ${response.statusText}`);
    const gist: GitHubGist = await response.json();
    return gist.id;
  }

  private async updateSyncGist(gistId: string, syncedFile: SyncedFile): Promise<void> {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        files: {
          [SYNC_CONSTANTS.SYNC_FILE_NAME]: {
            content: JSON.stringify(syncedFile, null, 2),
          },
        },
      }),
    });

    if (!response.ok) throw new Error(`Failed to update gist: ${response.statusText}`);
  }

  private async downloadSyncGist(gistId: string): Promise<SyncedFile | null> {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to download gist: ${response.statusText}`);
    }

    const gist: GitHubGist = await response.json();
    const file = gist.files[SYNC_CONSTANTS.SYNC_FILE_NAME];
    if (!file?.content) return null;

    return JSON.parse(file.content) as SyncedFile;
  }

  private async deleteSyncGist(gistId: string): Promise<void> {
    const response = await fetch(`${SYNC_CONSTANTS.GITHUB_API_BASE}/gists/${gistId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete gist: ${response.statusText}`);
    }
  }
}
