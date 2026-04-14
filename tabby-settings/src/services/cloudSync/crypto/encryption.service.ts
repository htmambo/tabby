/**
 * EncryptionService - Zero-Knowledge Encryption for Cloud Sync
 *
 * Implements AES-256-GCM encryption with PBKDF2 key derivation.
 * All encryption/decryption happens client-side; cloud providers never see plaintext.
 *
 * Security Model:
 * - Master password → PBKDF2 (600k iterations) → AES-256 key
 * - Each sync file has unique IV and salt
 * - Key verification via hash comparison (not by storing the key)
 */

import { Injectable } from '@angular/core';
import {
  SYNC_CONSTANTS,
  type EncryptionResult,
  type DecryptionInput,
  type MasterKeyConfig,
  type UnlockedMasterKey,
  type SyncedFile,
  type SyncFileMeta,
  type SyncPayload,
} from '../domain/types';
import {
  toArrayBuffer,
  arrayBufferToBase64,
  base64ToUint8Array,
  generateRandomBytes,
  sha256,
  stringToBytes,
  bytesToString,
} from './crypto.utils';

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive an AES-256 key from password using PBKDF2
 */
async function deriveKey (
  password: string,
  salt: Uint8Array,
  iterations: number = SYNC_CONSTANTS.PBKDF2_ITERATIONS,
): Promise<CryptoKey> {
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    toArrayBuffer(stringToBytes(password)),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations: iterations,
      hash: SYNC_CONSTANTS.PBKDF2_HASH,
    },
    passwordKey,
    {
      name: 'AES-GCM',
      length: SYNC_CONSTANTS.AES_KEY_LENGTH,
    },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Export CryptoKey to raw bytes for verification purposes
 */
async function exportKey (key: CryptoKey): Promise<Uint8Array> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return new Uint8Array(exported);
}

/**
 * Create a verification hash from derived key
 * Used to verify correct password without storing the key
 */
async function createVerificationHash (derivedKey: CryptoKey): Promise<string> {
  const keyBytes = await exportKey(derivedKey);
  const hash = await sha256(keyBytes);
  return arrayBufferToBase64(hash);
}

// ============================================================================
// Encryption / Decryption
// ============================================================================

/**
 * Encrypt plaintext using AES-256-GCM
 */
async function encrypt (
  plaintext: string,
  key: CryptoKey,
  salt: Uint8Array,
): Promise<EncryptionResult> {
  const iv = generateRandomBytes(SYNC_CONSTANTS.GCM_IV_LENGTH);

  const ciphertextBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(iv),
      tagLength: SYNC_CONSTANTS.GCM_TAG_LENGTH,
    },
    key,
    toArrayBuffer(stringToBytes(plaintext)),
  );

  return {
    ciphertext: new Uint8Array(ciphertextBuffer),
    iv: iv,
    salt: salt,
    algorithm: 'AES-256-GCM',
    kdf: 'PBKDF2',
    kdfIterations: SYNC_CONSTANTS.PBKDF2_ITERATIONS,
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM
 */
async function decrypt (
  input: DecryptionInput,
  key: CryptoKey,
): Promise<string> {
  const plaintextBuffer = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(input.iv),
      tagLength: SYNC_CONSTANTS.GCM_TAG_LENGTH,
    },
    key,
    toArrayBuffer(input.ciphertext),
  );

  return bytesToString(new Uint8Array(plaintextBuffer));
}

// ============================================================================
// Angular Service
// ============================================================================

/** @hidden */
@Injectable({ providedIn: 'root' })
export class CloudSyncEncryptionService {
  /**
   * Encrypt a sync payload to create a SyncedFile
   */
  async encryptPayload (
    payload: SyncPayload,
    password: string,
    deviceId: string,
    deviceName: string,
    appVersion: string,
    existingVersion?: number,
  ): Promise<SyncedFile> {
    const salt = generateRandomBytes(SYNC_CONSTANTS.SALT_LENGTH);
    const key = await deriveKey(password, salt);
    const plaintext = JSON.stringify(payload);
    const encrypted = await encrypt(plaintext, key, salt);

    const meta: SyncFileMeta = {
      version: (existingVersion || 0) + 1,
      updatedAt: Date.now(),
      deviceId: deviceId,
      deviceName: deviceName,
      appVersion: appVersion,
      iv: arrayBufferToBase64(encrypted.iv),
      salt: arrayBufferToBase64(encrypted.salt),
      algorithm: 'AES-256-GCM',
      kdf: 'PBKDF2',
      kdfIterations: SYNC_CONSTANTS.PBKDF2_ITERATIONS,
    };

    return {
      meta,
      payload: arrayBufferToBase64(encrypted.ciphertext),
    };
  }

  /**
   * Decrypt a SyncedFile to retrieve the payload
   */
  async decryptPayload (
    syncedFile: SyncedFile,
    password: string,
  ): Promise<SyncPayload> {
    const { meta, payload } = syncedFile;

    const salt = base64ToUint8Array(meta.salt);
    const iv = base64ToUint8Array(meta.iv);
    const ciphertext = base64ToUint8Array(payload);

    const key = await deriveKey(
      password,
      salt,
      meta.kdfIterations || SYNC_CONSTANTS.PBKDF2_ITERATIONS,
    );

    const decrypted = await decrypt(
      { ciphertext, iv, salt, kdf: meta.kdf, kdfIterations: meta.kdfIterations },
      key,
    );

    return JSON.parse(decrypted) as SyncPayload;
  }

  /**
   * Verify a SyncedFile can be decrypted with given password
   */
  async verifySyncedFile (syncedFile: SyncedFile, password: string): Promise<boolean> {
    try {
      await this.decryptPayload(syncedFile, password);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create a new master key configuration
   */
  async createMasterKeyConfig (password: string): Promise<MasterKeyConfig> {
    const salt = generateRandomBytes(SYNC_CONSTANTS.SALT_LENGTH);
    const key = await deriveKey(password, salt);
    const verificationHash = await createVerificationHash(key);

    return {
      verificationHash,
      salt: arrayBufferToBase64(salt),
      kdf: 'PBKDF2',
      kdfIterations: SYNC_CONSTANTS.PBKDF2_ITERATIONS,
      createdAt: Date.now(),
    };
  }

  /**
   * Unlock the master key and return it for use
   */
  async unlockMasterKey (
    password: string,
    config: MasterKeyConfig,
  ): Promise<UnlockedMasterKey | null> {
    const isValid = await this.verifyPassword(password, config);
    if (!isValid) return null;

    const salt = base64ToUint8Array(config.salt);
    const derivedKey = await deriveKey(
      password,
      salt,
      config.kdfIterations || SYNC_CONSTANTS.PBKDF2_ITERATIONS,
    );

    return {
      derivedKey,
      salt,
      unlockedAt: Date.now(),
    };
  }

  /**
   * Verify that a password produces the expected verification hash
   */
  async verifyPassword (password: string, config: MasterKeyConfig): Promise<boolean> {
    try {
      const salt = base64ToUint8Array(config.salt);
      const derivedKey = await deriveKey(
        password,
        salt,
        config.kdfIterations || SYNC_CONSTANTS.PBKDF2_ITERATIONS,
      );
      const hash = await createVerificationHash(derivedKey);
      return hash === config.verificationHash;
    } catch {
      return false;
    }
  }

  /**
   * Change master password
   * Note: This only changes the config. Re-encryption of existing data
   * must be done by the sync manager.
   */
  async changeMasterPassword (
    oldPassword: string,
    newPassword: string,
    config: MasterKeyConfig,
  ): Promise<MasterKeyConfig | null> {
    const isValid = await this.verifyPassword(oldPassword, config);
    if (!isValid) return null;

    return this.createMasterKeyConfig(newPassword);
  }
}
