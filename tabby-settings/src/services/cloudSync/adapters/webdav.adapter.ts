/**
 * WebDAV Adapter
 *
 * Supports basic auth, digest auth, and token-based auth.
 */

import { createClient, AuthType } from 'webdav';
import {
  SYNC_CONSTANTS,
  type WebDAVConfig,
  type SyncedFile,
  type ProviderAccount,
  type OAuthTokens,
} from '../domain/types';
import { CloudAdapter } from './adapter.interface';

type WebDAVClient = ReturnType<typeof createClient>;

const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

const ensureLeadingSlash = (value: string): string =>
  value.startsWith('/') ? value : `/${value}`;

export class WebDAVAdapter implements CloudAdapter {
  private config: WebDAVConfig | null;
  private resource: string | null;
  private account: ProviderAccount | null;
  private client: WebDAVClient | null;

  constructor(config?: WebDAVConfig, resourceId?: string) {
    this.config = config ? { ...config, endpoint: normalizeEndpoint(config.endpoint) } : null;
    this.resource = resourceId || null;
    this.account = this.buildAccountInfo(this.config);
    this.client = this.config ? this.createClient(this.config) : null;
  }

  get isAuthenticated(): boolean {
    return !!this.config;
  }

  get accountInfo(): ProviderAccount | null {
    return this.account;
  }

  get resourceId(): string | null {
    return this.resource;
  }

  signOut(): void {
    this.config = null;
    this.resource = null;
    this.account = null;
    this.client = null;
  }

  async initializeSync(): Promise<string | null> {
    if (!this.config || !this.client) throw new Error('Missing WebDAV config');
    const path = this.getSyncPath();
    await this.client.exists(path);
    this.resource = path;
    return this.resource;
  }

  async upload(syncedFile: SyncedFile): Promise<string> {
    if (!this.config || !this.client) throw new Error('Missing WebDAV config');
    const path = this.getSyncPath();
    await this.client.putFileContents(path, JSON.stringify(syncedFile), { overwrite: true });
    this.resource = path;
    return path;
  }

  async download(): Promise<SyncedFile | null> {
    if (!this.config || !this.client) throw new Error('Missing WebDAV config');
    const path = this.getSyncPath();
    const exists = await this.client.exists(path);
    if (!exists) return null;
    const data = await this.client.getFileContents(path, { format: 'text' });
    if (!data) return null;
    return JSON.parse(data as string) as SyncedFile;
  }

  async deleteSync(): Promise<void> {
    if (!this.config || !this.client) return;
    const path = this.getSyncPath();
    const exists = await this.client.exists(path);
    if (!exists) return;
    await this.client.deleteFile(path);
  }

  getTokens(): OAuthTokens | null {
    return null;
  }

  async setTokens(_tokens: OAuthTokens): Promise<void> {
    // WebDAV uses config-based auth, not OAuth tokens
  }

  getPKCEState(): string | null {
    return null; // WebDAV does not use OAuth
  }

  private createClient(config: WebDAVConfig): WebDAVClient {
    const extraOpts: Record<string, unknown> = {};
    if (config.allowInsecure) {
      extraOpts['httpsAgent'] = { rejectUnauthorized: false };
    }

    if (config.authType === 'token') {
      return createClient(config.endpoint, {
        authType: AuthType.Token,
        token: { access_token: config.token || '', token_type: 'Bearer' },
        ...extraOpts,
      });
    }

    if (config.authType === 'digest') {
      return createClient(config.endpoint, {
        authType: AuthType.Digest,
        username: config.username || '',
        password: config.password || '',
        ...extraOpts,
      });
    }

    return createClient(config.endpoint, {
      authType: AuthType.Password,
      username: config.username || '',
      password: config.password || '',
      ...extraOpts,
    });
  }

  private getSyncPath(): string {
    return ensureLeadingSlash(SYNC_CONSTANTS.SYNC_FILE_NAME);
  }

  private buildAccountInfo(config: WebDAVConfig | null): ProviderAccount | null {
    if (!config) return null;
    try {
      const url = new URL(config.endpoint);
      const host = url.host;
      const name = config.username ? `${config.username}@${host}` : host;
      return { id: host, name };
    } catch {
      return { id: config.endpoint, name: config.endpoint };
    }
  }
}
