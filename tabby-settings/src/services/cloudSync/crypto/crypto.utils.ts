/**
 * Crypto Utility Functions
 *
 * Shared utility functions for the cloud sync encryption layer.
 */

/**
 * Convert Uint8Array to ArrayBuffer for Web Crypto API compatibility.
 * Handles both regular and SharedArrayBuffer by creating a fresh copy.
 */
export const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  if (bytes.byteLength === 0) {
    return new ArrayBuffer(0);
  }
  // Copy the data to avoid issues with SharedArrayBuffer
  return (bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

/**
 * Convert ArrayBuffer to Base64 string
 */
export const arrayBufferToBase64 = (buffer: ArrayBuffer | Uint8Array): string => {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

/**
 * Convert Base64 string to Uint8Array
 */
export const base64ToUint8Array = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/**
 * Generate cryptographically secure random bytes
 */
export const generateRandomBytes = (length: number): Uint8Array => {
  return crypto.getRandomValues(new Uint8Array(length));
};

/**
 * Compute SHA-256 hash of data
 */
export const sha256 = async (data: Uint8Array): Promise<Uint8Array> => {
  const hashBuffer = await crypto.subtle.digest('SHA-256', toArrayBuffer(data));
  return new Uint8Array(hashBuffer);
};

/**
 * Convert string to Uint8Array using UTF-8 encoding
 */
export const stringToBytes = (str: string): Uint8Array => {
  return new TextEncoder().encode(str);
};

/**
 * Convert Uint8Array to string using UTF-8 decoding
 */
export const bytesToString = (bytes: Uint8Array): string => {
  return new TextDecoder().decode(bytes);
};

/**
 * Base64 URL encoding (no padding, URL-safe chars)
 */
export const base64UrlEncode = (bytes: Uint8Array): string => {
  const base64 = arrayBufferToBase64(bytes);
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/**
 * Generate a cryptographically random code verifier for PKCE
 */
export const generateCodeVerifier = (): string => {
  const bytes = generateRandomBytes(32);
  return base64UrlEncode(bytes);
};

/**
 * Generate code challenge from verifier (S256)
 */
export const generateCodeChallenge = async (verifier: string): Promise<string> => {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
};
