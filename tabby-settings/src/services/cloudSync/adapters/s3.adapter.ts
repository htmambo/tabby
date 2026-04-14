/**
 * S3 Compatible Adapter
 *
 * Uses AWS SDK v3 for S3-compatible storage (including MinIO, Backblaze B2, etc.)
 */

import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import {
  SYNC_CONSTANTS,
  type S3Config,
  type SyncedFile,
  type ProviderAccount,
  type OAuthTokens,
} from '../domain/types';
import { CloudAdapter } from './adapter.interface';

const normalizeEndpoint = (endpoint: string): string => {
  const trimmed = endpoint.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
};

export class S3Adapter implements CloudAdapter {
  private config: S3Config | null;
  private resource: string | null;
  private account: ProviderAccount | null;
  private client: S3Client | null;

  constructor(config?: S3Config, resourceId?: string) {
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
    if (!this.config || !this.client) throw new Error('Missing S3 config');
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(),
      }));
    } catch (error) {
      if (this.isNotFound(error)) {
        // File doesn't exist yet
      } else if (this.isAccessDenied(error)) {
        throw new Error('S3 access denied');
      } else {
        throw error;
      }
    }
    this.resource = this.getObjectKey();
    return this.resource;
  }

  async upload(syncedFile: SyncedFile): Promise<string> {
    if (!this.config || !this.client) throw new Error('Missing S3 config');
    const body = JSON.stringify(syncedFile);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.getObjectKey(),
      Body: body,
      ContentType: 'application/json',
    }));
    this.resource = this.getObjectKey();
    return this.resource;
  }

  async download(): Promise<SyncedFile | null> {
    if (!this.config || !this.client) throw new Error('Missing S3 config');
    try {
      const response = await this.client.send(new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(),
      }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = (response.Body as any);
      let text = '';
      if (body) {
        if (typeof body.text === 'function') {
          text = await body.text();
        } else if (body instanceof Uint8Array || body instanceof ArrayBuffer) {
          text = new TextDecoder().decode(body instanceof ArrayBuffer ? new Uint8Array(body) : body);
        } else {
          text = await new Response(body as ReadableStream).text();
        }
      }
      if (!text) return null;
      return JSON.parse(text) as SyncedFile;
    } catch (error) {
      if (this.isNotFound(error)) return null;
      throw error;
    }
  }

  async deleteSync(): Promise<void> {
    if (!this.config || !this.client) return;
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: this.getObjectKey(),
      }));
    } catch (error) {
      if (this.isNotFound(error)) return;
      throw error;
    }
  }

  getTokens(): OAuthTokens | null {
    return null;
  }

  async setTokens(_tokens: OAuthTokens): Promise<void> {
    // S3 uses config-based credentials, not OAuth tokens
  }

  getPKCEState(): string | null {
    return null; // S3 does not use OAuth
  }

  private createClient(config: S3Config): S3Client {
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle ?? true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        sessionToken: config.sessionToken,
      },
    });
  }

  private isNotFound(error: unknown): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((error as any)?.$metadata?.httpStatusCode === 404);
  }

  private isAccessDenied(error: unknown): boolean {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((error as any)?.$metadata?.httpStatusCode === 403);
  }

  private getObjectKey(): string {
    if (!this.config) throw new Error('Missing S3 config');
    const prefix = (this.config.prefix || '').trim().replace(/^\/+|\/+$/g, '');
    if (!prefix) return SYNC_CONSTANTS.SYNC_FILE_NAME;
    return `${prefix}/${SYNC_CONSTANTS.SYNC_FILE_NAME}`;
  }

  private buildAccountInfo(config: S3Config | null): ProviderAccount | null {
    if (!config) return null;
    const name = `${config.bucket} (${config.region})`;
    const id = `${config.bucket}@${config.endpoint}`;
    return { id, name };
  }
}
