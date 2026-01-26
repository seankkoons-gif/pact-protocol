/**
 * Cryptographic Utilities (v2 Phase 4)
 * 
 * Deterministic encryption utilities for at-rest encryption.
 * Uses Node.js built-in crypto module only (no external dependencies).
 * 
 * Features:
 * - AES-256-GCM encryption/decryption
 * - Key derivation from passphrase (scrypt)
 * - Base64url encoding/decoding
 */

import * as crypto from "node:crypto";

/**
 * Derive a 32-byte encryption key from a passphrase using scrypt.
 * 
 * @param passphrase - Passphrase string
 * @param salt - Salt bytes (16 bytes recommended)
 * @returns 32-byte key suitable for AES-256
 */
export function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Uint8Array {
  // scrypt parameters: N=16384, r=8, p=1 (moderate cost)
  // Output: 32 bytes (256 bits) for AES-256
  const key = crypto.scryptSync(passphrase, salt, 32);
  return new Uint8Array(key);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * 
 * @param plaintext - Plaintext bytes to encrypt
 * @param key - 32-byte encryption key
 * @param aad - Optional additional authenticated data
 * @returns Encrypted data with IV and authentication tag
 */
export function encryptBytes(
  plaintext: Uint8Array,
  key: Uint8Array,
  aad?: Uint8Array
): { ciphertext: Uint8Array; iv: Uint8Array; tag: Uint8Array } {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes for AES-256");
  }
  
  // Generate random 12-byte IV (96 bits, standard for GCM)
  const iv = crypto.randomBytes(12);
  
  // Create cipher
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  
  // Set AAD if provided
  if (aad) {
    cipher.setAAD(Buffer.from(aad));
  }
  
  // Encrypt
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext)),
    cipher.final(),
  ]);
  
  // Get authentication tag (16 bytes for GCM)
  const tag = cipher.getAuthTag();
  
  return {
    ciphertext: new Uint8Array(encrypted),
    iv: new Uint8Array(iv),
    tag: new Uint8Array(tag),
  };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 * 
 * @param ciphertext - Encrypted bytes
 * @param key - 32-byte decryption key (must match encryption key)
 * @param iv - Initialization vector (12 bytes)
 * @param tag - Authentication tag (16 bytes)
 * @param aad - Optional additional authenticated data (must match encryption AAD)
 * @returns Decrypted plaintext bytes
 * @throws Error if decryption fails (invalid key, tampered data, etc.)
 */
export function decryptBytes(
  ciphertext: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array,
  tag: Uint8Array,
  aad?: Uint8Array
): Uint8Array {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes for AES-256");
  }
  if (iv.length !== 12) {
    throw new Error("IV must be 12 bytes for AES-256-GCM");
  }
  if (tag.length !== 16) {
    throw new Error("Tag must be 16 bytes for AES-256-GCM");
  }
  
  // Create decipher
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), Buffer.from(iv));
  
  // Set authentication tag
  decipher.setAuthTag(Buffer.from(tag));
  
  // Set AAD if provided
  if (aad) {
    decipher.setAAD(Buffer.from(aad));
  }
  
  // Decrypt
  try {
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(ciphertext)),
      decipher.final(),
    ]);
    
    return new Uint8Array(decrypted);
  } catch (error: any) {
    // Decryption failed (wrong key, tampered data, etc.)
    throw new Error(`Decryption failed: ${error?.message || "authentication failed"}`);
  }
}

/**
 * Encode bytes to base64url string (URL-safe base64, no padding).
 * 
 * @param bytes - Bytes to encode
 * @returns Base64url-encoded string
 */
export function base64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Decode base64url string to bytes.
 * 
 * @param str - Base64url-encoded string
 * @returns Decoded bytes
 * @throws Error if input is not valid base64url
 */
export function base64urlDecode(str: string): Uint8Array {
  // Handle empty string
  if (str === "") {
    return new Uint8Array(0);
  }
  
  // Add padding if needed
  let padded = str.replace(/-/g, "+").replace(/_/g, "/");
  while (padded.length % 4) {
    padded += "=";
  }
  
  // Validate base64 characters before decoding
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(padded)) {
    throw new Error("Invalid base64url string: contains invalid characters");
  }
  
  try {
    const decoded = Buffer.from(padded, "base64");
    return new Uint8Array(decoded);
  } catch (error: any) {
    throw new Error(`Invalid base64url string: ${error?.message || String(error)}`);
  }
}
