/**
 * Google Drive OAuth Adapter - PKCE Loopback Flow
 *
 * Uses Authorization Code Grant with PKCE (RFC 7636).
 * Data is stored in appDataFolder (hidden, app-specific folder).
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

interface GoogleUserInfo {
  id: string;
  email: string;
  name: string;
  picture: string;
}

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

export const buildGoogleAuthUrl = async (
  redirectUri: string,
  clientId?: string,
): Promise<{ url: string; pkce: PKCEChallenge }> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.GOOGLE_CLIENT_ID;
  if (!effectiveClientId) throw new Error('Google Client ID not configured');
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = base64UrlEncode(generateRandomBytes(16));

  const params = new URLSearchParams({
    client_id: effectiveClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    url: `${SYNC_CONSTANTS.GOOGLE_AUTH_URL}?${params.toString()}`,
    pkce: { codeVerifier, codeChallenge, state },
  };
};

export const exchangeGoogleCode = async (
  code: string,
  codeVerifier: string,
  redirectUri: string,
  clientId?: string,
  clientSecret?: string,
): Promise<OAuthTokens> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.GOOGLE_CLIENT_ID;
  const effectiveClientSecret = clientSecret || SYNC_CONSTANTS.GOOGLE_CLIENT_SECRET;
  if (!effectiveClientId) throw new Error('Google Client ID not configured');
  const bridge = getTabbyBridge();
  if (bridge?.ipc) {
    return await bridge.ipc.invoke('cloudSync:google:exchangeCode', {
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      code,
      codeVerifier,
      redirectUri,
    }) as OAuthTokens;
  }

  const response = await fetch(SYNC_CONSTANTS.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: effectiveClientId,
      client_secret: effectiveClientSecret,
      code,
      code_verifier: codeVerifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) throw new Error('Google token exchange failed');
  const data = await response.json();

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    tokenType: data.token_type,
    scope: data.scope,
  };
};

export const refreshGoogleToken = async (
  refreshToken: string,
  clientId?: string,
  clientSecret?: string,
): Promise<OAuthTokens> => {
  const effectiveClientId = clientId || SYNC_CONSTANTS.GOOGLE_CLIENT_ID;
  const effectiveClientSecret = clientSecret || SYNC_CONSTANTS.GOOGLE_CLIENT_SECRET;
  if (!effectiveClientId) throw new Error('Google Client ID not configured');
  const bridge = getTabbyBridge();
  if (bridge?.ipc) {
    return await bridge.ipc.invoke('cloudSync:google:refreshToken', {
      clientId: effectiveClientId,
      clientSecret: effectiveClientSecret,
      refreshToken,
    }) as OAuthTokens;
  }

  const response = await fetch(SYNC_CONSTANTS.GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: effectiveClientId,
      client_secret: effectiveClientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) throw new Error('Google token refresh failed');
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
// Google Drive Adapter Class
// ============================================================================

export class GoogleDriveAdapter implements CloudAdapter {
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
    const { url, pkce } = await buildGoogleAuthUrl(redirectUri);
    this.pkceChallenge = pkce;
    return url;
  }

  getPKCEState(): string | null {
    return this.pkceChallenge?.state || null;
  }

  async completeAuth(code: string, redirectUri: string): Promise<OAuthTokens> {
    if (!this.pkceChallenge) throw new Error('No PKCE challenge');
    this.tokens = await exchangeGoogleCode(code, this.pkceChallenge.codeVerifier, redirectUri);
    this.pkceChallenge = null;
    this.account = await this.fetchUserInfo();
    return this.tokens;
  }

  async setTokens(tokens: OAuthTokens): Promise<void> {
    this.tokens = tokens;
    if (tokens.expiresAt && Date.now() > tokens.expiresAt - 60000) {
      if (tokens.refreshToken) {
        this.tokens = await refreshGoogleToken(tokens.refreshToken);
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
    if (this.fileId) {
      await this.updateSyncFile(accessToken, this.fileId, syncedFile);
      return this.fileId;
    } else {
      this.fileId = await this.createSyncFile(accessToken, syncedFile);
      return this.fileId;
    }
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
    await this.deleteSyncFile(accessToken, this.fileId);
    this.fileId = null;
  }

  getTokens(): OAuthTokens | null {
    return this.tokens;
  }

  private async ensureValidToken(): Promise<string> {
    if (!this.tokens) throw new Error('Not authenticated');
    if (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 60000) {
      if (this.tokens.refreshToken) {
        this.tokens = await refreshGoogleToken(this.tokens.refreshToken);
      } else {
        throw new Error('Token expired');
      }
    }
    return this.tokens.accessToken;
  }

  private async fetchUserInfo(): Promise<ProviderAccount> {
    const accessToken = await this.ensureValidToken();
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error('Failed to get user info');
    const user: GoogleUserInfo = await response.json();
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.picture,
    };
  }

  private async findSyncFile(accessToken: string): Promise<string | null> {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${SYNC_CONSTANTS.SYNC_FILE_NAME}'`,
      fields: 'files(id, name, modifiedTime)',
    });
    const response = await fetch(`${SYNC_CONSTANTS.GOOGLE_DRIVE_API}/files?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Drive API error: ${response.status}`);
    const data = await response.json();
    return data.files?.[0]?.id || null;
  }

  private async createSyncFile(accessToken: string, syncedFile: SyncedFile): Promise<string> {
    const metadata = { name: SYNC_CONSTANTS.SYNC_FILE_NAME, parents: ['appDataFolder'] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(syncedFile, null, 2)], { type: 'application/json' }));

    const response = await fetch(
      `${SYNC_CONSTANTS.GOOGLE_DRIVE_API.replace('/v3', '/upload/v3')}/files?uploadType=multipart`,
      { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` }, body: form },
    );
    if (!response.ok) throw new Error(`Failed to create file: ${response.status}`);
    const data = await response.json();
    return data.id;
  }

  private async updateSyncFile(accessToken: string, fileId: string, syncedFile: SyncedFile): Promise<void> {
    const response = await fetch(
      `${SYNC_CONSTANTS.GOOGLE_DRIVE_API.replace('/v3', '/upload/v3')}/files/${fileId}?uploadType=media`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(syncedFile, null, 2),
      },
    );
    if (!response.ok) throw new Error(`Failed to update file: ${response.status}`);
  }

  private async downloadSyncFile(accessToken: string, fileId: string): Promise<SyncedFile | null> {
    const response = await fetch(
      `${SYNC_CONSTANTS.GOOGLE_DRIVE_API}/files/${fileId}?alt=media`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Failed to download file: ${response.status}`);
    }
    return response.json();
  }

  private async deleteSyncFile(accessToken: string, fileId: string): Promise<void> {
    const response = await fetch(`${SYNC_CONSTANTS.GOOGLE_DRIVE_API}/files/${fileId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 404) throw new Error(`Failed to delete file: ${response.status}`);
  }
}
