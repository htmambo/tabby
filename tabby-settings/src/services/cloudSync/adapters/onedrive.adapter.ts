/**
 * OneDrive OAuth Adapter - PKCE Loopback Flow
 *
 * Uses Authorization Code Grant with PKCE.
 * Data is stored in the app's special folder.
 */

import {
  SYNC_CONSTANTS,
  type OAuthTokens,
  type ProviderAccount,
  type SyncedFile,
  type PKCEChallenge,
} from '../domain/types';
import { CloudAdapter } from './adapter.interface';
import { generateCodeVerifier, generateCodeChallenge, base64UrlEncode, generateRandomBytes } from '../crypto/crypto.utils';

interface OneDriveUserInfo {
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName: string;
}

const ONEDRIVE_SCOPES = [
  'https://graph.microsoft.com/Files.ReadWrite.AppFolder',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
];
const ONEDRIVE_SCOPE = ONEDRIVE_SCOPES.join(' ');

// ============================================================================
// Helper: getTabbyBridge
// ============================================================================

function getTabbyBridge() {
  const win = window as Window & { tabbyBridge?: { ipc: { invoke: (channel: string, ...args: unknown[]) => Promise<unknown> }; shell: { openExternal: (url: string) => Promise<void> } } };
  return win.tabbyBridge;
}

// ============================================================================
// PKCE OAuth Flow
// ============================================================================

export const buildOneDriveAuthUrl = async (
  redirectUri: string,
  clientId?: string,
): Promise<{ url: string; pkce: PKCEChallenge }> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.ONEDRIVE_CLIENT_ID;
  if (!effectiveClientId) throw new Error('OneDrive Client ID not configured');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = base64UrlEncode(generateRandomBytes(16));

  const params = new URLSearchParams({
    client_id: effectiveClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: ONEDRIVE_SCOPE,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    response_mode: 'query',
    prompt: 'consent',
  });

  return {
    url: `${SYNC_CONSTANTS.ONEDRIVE_AUTH_URL}?${params.toString()}`,
    pkce: { codeVerifier, codeChallenge, state },
  };
};

export const exchangeOneDriveCode = async (
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId?: string,
): Promise<OAuthTokens> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.ONEDRIVE_CLIENT_ID;
  if (!effectiveClientId) throw new Error('OneDrive Client ID not configured');
  const bridge = getTabbyBridge();
  if (bridge?.ipc) {
    return await bridge.ipc.invoke('cloudSync:onedrive:exchangeCode', {
      clientId: effectiveClientId,
      code,
      codeVerifier,
      redirectUri,
      scope: ONEDRIVE_SCOPE,
    }) as OAuthTokens;
  }

  const response = await fetch(SYNC_CONSTANTS.ONEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: effectiveClientId,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      scope: ONEDRIVE_SCOPE,
    }),
  });

  if (!response.ok) throw new Error('OneDrive token exchange failed');
  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
};

export const refreshOneDriveToken = async (
  refreshToken: string,
  clientId?: string,
): Promise<OAuthTokens> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.ONEDRIVE_CLIENT_ID;
  if (!effectiveClientId) throw new Error('OneDrive Client ID not configured');
  const bridge = getTabbyBridge();
  if (bridge?.ipc) {
    return await bridge.ipc.invoke('cloudSync:onedrive:refreshToken', {
      clientId: effectiveClientId,
      refreshToken,
      scope: ONEDRIVE_SCOPE,
    }) as OAuthTokens;
  }

  const response = await fetch(SYNC_CONSTANTS.ONEDRIVE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: effectiveClientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: ONEDRIVE_SCOPE,
    }),
  });

  if (!response.ok) throw new Error('OneDrive token refresh failed');
  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
};

// ============================================================================
// OneDrive Adapter Class
// ============================================================================

const APP_FOLDER_PATH = '/drive/special/approot';

export class OneDriveAdapter implements CloudAdapter {
  private tokens: OAuthTokens | null = null;
  private fileId: string | null = null;
  private account: ProviderAccount | null = null;
  private pkceChallenge: PKCEChallenge | null = null;

  constructor(tokens?: OAuthTokens, fileId?: string) {
    if (tokens) this.tokens = tokens;
    this.fileId = fileId || null;
  }

  get isAuthenticated(): boolean {
    return !!this.tokens?.accessToken;
  }

  get accountInfo(): ProviderAccount | null {
    return this.account;
  }

  get resourceId(): string | null {
    return this.fileId;
  }

  async startAuth(redirectUri: string): Promise<string> {
    const { url, pkce } = await buildOneDriveAuthUrl(redirectUri);
    this.pkceChallenge = pkce;
    return url;
  }

  getPKCEState(): string | null {
    return this.pkceChallenge?.state || null;
  }

  async completeAuth(code: string, redirectUri: string): Promise<OAuthTokens> {
    if (!this.pkceChallenge) throw new Error('No PKCE challenge');
    this.tokens = await exchangeOneDriveCode(code, this.pkceChallenge.codeVerifier, redirectUri);
    this.pkceChallenge = null;
    this.account = await this.fetchUserInfo();
    return this.tokens;
  }

  async setTokens(tokens: OAuthTokens): Promise<void> {
    this.tokens = tokens;
    if (tokens.expiresAt && Date.now() > tokens.expiresAt - 60000) {
      if (tokens.refreshToken) {
        this.tokens = await refreshOneDriveToken(tokens.refreshToken);
      } else {
        throw new Error('Token expired and no refresh token');
      }
    }
    this.account = await this.fetchUserInfo();
  }

  signOut(): void {
    this.tokens = null;
    this.fileId = null;
    this.account = null;
    this.pkceChallenge = null;
  }

  async initializeSync(): Promise<string | null> {
    const accessToken = await this.ensureValidToken();
    this.fileId = await this.findSyncFile(accessToken);
    return this.fileId;
  }

  async upload(syncedFile: SyncedFile): Promise<string> {
    const accessToken = await this.ensureValidToken();
    const content = JSON.stringify(syncedFile, null, 2);

    const response = await fetch(
      `${SYNC_CONSTANTS.ONEDRIVE_GRAPH_API}/me${APP_FOLDER_PATH}:/${SYNC_CONSTANTS.SYNC_FILE_NAME}:/content`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: content,
      },
    );

    if (!response.ok) throw new Error('Failed to upload sync file');
    const data = await response.json();
    if (!data.id) throw new Error('Upload response missing file ID');
    this.fileId = data.id as string;
    return this.fileId;
  }

  async download(): Promise<SyncedFile | null> {
    const accessToken = await this.ensureValidToken();
    if (!this.fileId) {
      this.fileId = await this.findSyncFile(accessToken);
    }
    if (!this.fileId) return null;
    return this.downloadSyncFile(accessToken, this.fileId);
  }

  async deleteSync(): Promise<void> {
    if (!this.tokens || !this.fileId) return;
    const accessToken = await this.ensureValidToken();
    await fetch(
      `${SYNC_CONSTANTS.ONEDRIVE_GRAPH_API}/me/drive/items/${this.fileId}`,
      { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    this.fileId = null;
  }

  getTokens(): OAuthTokens | null {
    return this.tokens;
  }

  private async ensureValidToken(): Promise<string> {
    if (!this.tokens) throw new Error('Not authenticated');
    if (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 60000) {
      if (this.tokens.refreshToken) {
        this.tokens = await refreshOneDriveToken(this.tokens.refreshToken);
      } else {
        throw new Error('Token expired');
      }
    }
    return this.tokens.accessToken;
  }

  private async fetchUserInfo(): Promise<ProviderAccount> {
    const accessToken = await this.ensureValidToken();
    const response = await fetch(`${SYNC_CONSTANTS.ONEDRIVE_GRAPH_API}/me`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error('Failed to get user info');
    const user: OneDriveUserInfo = await response.json();
    return {
      id: user.id,
      email: user.mail || user.userPrincipalName,
      name: user.displayName,
    };
  }

  private async findSyncFile(accessToken: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${SYNC_CONSTANTS.ONEDRIVE_GRAPH_API}/me${APP_FOLDER_PATH}:/${SYNC_CONSTANTS.SYNC_FILE_NAME}`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to find sync file');
      const data = await response.json();
      return data.id;
    } catch {
      return null;
    }
  }

  private async downloadSyncFile(accessToken: string, fileId: string): Promise<SyncedFile | null> {
    try {
      const response = await fetch(
        `${SYNC_CONSTANTS.ONEDRIVE_GRAPH_API}/me/drive/items/${fileId}/content`,
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Failed to download sync file');
      return response.json();
    } catch {
      return null;
    }
  }
}
