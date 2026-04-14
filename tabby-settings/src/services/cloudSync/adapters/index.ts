/**
 * Cloud Adapter Factory
 *
 * Creates the appropriate adapter for a given cloud provider.
 */

import type {
  CloudProvider,
  OAuthTokens,
  WebDAVConfig,
  S3Config,
} from '../domain/types';
import { CloudAdapter } from './adapter.interface';
import { GitHubAdapter } from './github.adapter';
import { GoogleDriveAdapter } from './googledrive.adapter';
import { OneDriveAdapter } from './onedrive.adapter';
import { WebDAVAdapter } from './webdav.adapter';
import { S3Adapter } from './s3.adapter';

/**
 * Create adapter for a specific provider
 */
export const createAdapter = (
  provider: CloudProvider,
  tokens?: OAuthTokens,
  resourceId?: string,
  config?: WebDAVConfig | S3Config,
): CloudAdapter => {
  switch (provider) {
    case 'github':
      return new GitHubAdapter(tokens, resourceId);
    case 'google':
      return new GoogleDriveAdapter(tokens, resourceId);
    case 'onedrive':
      return new OneDriveAdapter(tokens, resourceId);
    case 'webdav':
      return new WebDAVAdapter(config as WebDAVConfig | undefined, resourceId);
    case 's3':
      return new S3Adapter(config as S3Config | undefined, resourceId);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
};

export { CloudAdapter } from './adapter.interface';
export { GitHubAdapter } from './github.adapter';
export { GoogleDriveAdapter } from './googledrive.adapter';
export { OneDriveAdapter } from './onedrive.adapter';
export { WebDAVAdapter } from './webdav.adapter';
export { S3Adapter } from './s3.adapter';
