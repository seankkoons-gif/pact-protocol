/**
 * Secure Store (v2 Phase 4)
 * 
 * Encrypted key-value store for sensitive data.
 * Uses file-backed storage with AES-256-GCM encryption.
 * 
 * Security:
 * - Random salt per store instance
 * - Random IV per record
 * - Never logs secrets or decrypted payloads
 * - Passphrase from PACT_LOCAL_KEY or PACT_SECURESTORE_PASSPHRASE env
 * 
 * Encryption Modes:
 * - If passphrase provided: AES-256-GCM encryption enabled
 * - If no passphrase: Plaintext storage (for testing convenience, not secure)
 * - Use requirePassphrase: true in production to enforce encryption
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { deriveKeyFromPassphrase, encryptBytes, decryptBytes } from "./crypto";

/**
 * Secure store interface for encrypted key-value storage.
 */
export interface SecureStore {
  /**
   * Store an encrypted value.
   * 
   * @param key - Storage key
   * @param value - Value to store (will be JSON-serialized and encrypted)
   * @returns Promise that resolves when storage is complete
   */
  put(key: string, value: unknown): Promise<void>;
  
  /**
   * Retrieve and decrypt a value.
   * 
   * @param key - Storage key
   * @returns Promise resolving to decrypted value or null if not found
   */
  get<T>(key: string): Promise<T | null>;
  
  /**
   * Delete a stored value.
   * 
   * @param key - Storage key to delete
   * @returns Promise that resolves when deletion is complete
   */
  del(key: string): Promise<void>;
  
  /**
   * List all keys (optionally filtered by prefix).
   * 
   * @param prefix - Optional prefix to filter keys
   * @returns Promise resolving to array of keys
   */
  list(prefix?: string): Promise<string[]>;
}

/**
 * File-backed secure store implementation.
 * 
 * Stores encrypted blobs as files under a base directory.
 * Each store instance uses a unique salt derived from a master salt file.
 */
export interface FileSecureStoreOptions {
  /** Base directory for storage (default: .pact/secure) */
  baseDir?: string;
  
  /** 
   * Passphrase for encryption (default: from PACT_LOCAL_KEY or PACT_SECURESTORE_PASSPHRASE env).
   * If not provided and env vars are missing, encryption is disabled (plaintext storage).
   * This allows tests to run without setup, but production should always use encryption.
   */
  passphrase?: string;
  
  /**
   * If true, throw error if passphrase is missing (default: false for convenience).
   * Set to true in production to enforce encryption.
   */
  requirePassphrase?: boolean;
}

/**
 * File-backed secure store.
 * 
 * Storage format:
 * - Master salt stored in `.salt` file (16 bytes, base64url)
 * - Records stored as `.enc` files (JSON: { iv, tag, ciphertext } as base64url)
 * - Key names sanitized for filesystem (invalid chars replaced with _)
 */
export class FileSecureStore implements SecureStore {
  private baseDir: string;
  private passphrase: string;
  private encryptionEnabled: boolean;
  private masterSalt: Uint8Array | null;
  private derivedKey: Uint8Array | null;
  private saltPath: string;
  
  constructor(options: FileSecureStoreOptions = {}) {
    // Determine base directory
    const envDir = process.env.PACT_SECURESTORE_DIR;
    this.baseDir = options.baseDir || envDir || path.join(process.cwd(), ".pact", "secure");
    
    // Ensure directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    
    // Get passphrase (v2 Phase 4: support PACT_LOCAL_KEY for convenience, fallback to PACT_SECURESTORE_PASSPHRASE)
    this.passphrase = options.passphrase 
      || process.env.PACT_LOCAL_KEY 
      || process.env.PACT_SECURESTORE_PASSPHRASE 
      || "";
    
    // If passphrase is missing and requirePassphrase is true, throw error
    if (!this.passphrase && options.requirePassphrase) {
      throw new Error(
        "FileSecureStore requires passphrase. " +
        "Provide via constructor options, PACT_LOCAL_KEY, or PACT_SECURESTORE_PASSPHRASE environment variable."
      );
    }
    
    // If no passphrase, encryption is disabled (plaintext storage)
    // This allows tests to run without setup, but is not secure for production
    this.encryptionEnabled = !!this.passphrase;
    
    // Load or create master salt (only if encryption is enabled)
    this.saltPath = path.join(this.baseDir, ".salt");
    if (this.encryptionEnabled) {
      if (fs.existsSync(this.saltPath)) {
        // Load existing salt
        const saltBase64 = fs.readFileSync(this.saltPath, "utf-8").trim();
        this.masterSalt = this.base64urlDecode(saltBase64);
      } else {
        // Generate new salt
        this.masterSalt = crypto.randomBytes(16);
        fs.writeFileSync(this.saltPath, this.base64urlEncode(this.masterSalt), "utf-8");
      }
      
      // Derive encryption key from passphrase and salt
      this.derivedKey = deriveKeyFromPassphrase(this.passphrase, this.masterSalt);
    } else {
      // Encryption disabled - no salt or key needed
      this.masterSalt = null;
      this.derivedKey = null;
    }
  }
  
  /**
   * Sanitize key name for filesystem (replace invalid chars with _).
   */
  private sanitizeKey(key: string): string {
    // Replace invalid filesystem chars with underscore
    return key.replace(/[^a-zA-Z0-9._-]/g, "_");
  }
  
  /**
   * Get file path for a key.
   */
  private getKeyPath(key: string): string {
    const sanitized = this.sanitizeKey(key);
    return path.join(this.baseDir, `${sanitized}.enc`);
  }
  
  /**
   * Base64url encode helper.
   */
  private base64urlEncode(bytes: Uint8Array): string {
    return Buffer.from(bytes)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "");
  }
  
  /**
   * Base64url decode helper.
   */
  private base64urlDecode(str: string): Uint8Array {
    let padded = str.replace(/-/g, "+").replace(/_/g, "/");
    while (padded.length % 4) {
      padded += "=";
    }
    const decoded = Buffer.from(padded, "base64");
    return new Uint8Array(decoded);
  }
  
  async put(key: string, value: unknown): Promise<void> {
    // Serialize value to JSON
    const json = JSON.stringify(value);
    
    if (this.encryptionEnabled && this.derivedKey) {
      // Encrypt
      const plaintext = new TextEncoder().encode(json);
      const { ciphertext, iv, tag } = encryptBytes(plaintext, this.derivedKey);
      
      // Store as JSON with base64url-encoded fields
      const record = {
        encrypted: true,
        iv: this.base64urlEncode(iv),
        tag: this.base64urlEncode(tag),
        ciphertext: this.base64urlEncode(ciphertext),
      };
      
      const filePath = this.getKeyPath(key);
      fs.writeFileSync(filePath, JSON.stringify(record), "utf-8");
    } else {
      // Encryption disabled - store plaintext (not secure, but allows tests to run)
      const record = {
        encrypted: false,
        data: json,
      };
      
      const filePath = this.getKeyPath(key);
      fs.writeFileSync(filePath, JSON.stringify(record), "utf-8");
    }
  }
  
  async get<T>(key: string): Promise<T | null> {
    const filePath = this.getKeyPath(key);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }
    
    try {
      // Read record
      const recordJson = fs.readFileSync(filePath, "utf-8");
      const record = JSON.parse(recordJson);
      
      if (record.encrypted === false) {
        // Plaintext storage (encryption disabled)
        return JSON.parse(record.data) as T;
      }
      
      // Encrypted storage
      if (!this.encryptionEnabled || !this.derivedKey) {
        throw new Error(`Store entry '${key}' is encrypted but no passphrase provided`);
      }
      
      // Decode base64url fields
      const iv = this.base64urlDecode(record.iv);
      const tag = this.base64urlDecode(record.tag);
      const ciphertext = this.base64urlDecode(record.ciphertext);
      
      // Decrypt
      const plaintext = decryptBytes(ciphertext, this.derivedKey, iv, tag);
      
      // Deserialize JSON
      const json = new TextDecoder().decode(plaintext);
      return JSON.parse(json) as T;
    } catch (error: any) {
      // Decryption failed or file corrupted
      throw new Error(`Failed to decrypt store entry '${key}': ${error?.message || String(error)}`);
    }
  }
  
  async del(key: string): Promise<void> {
    const filePath = this.getKeyPath(key);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
  
  async list(prefix?: string): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) {
      return [];
    }
    
    const files = fs.readdirSync(this.baseDir);
    const keys: string[] = [];
    
    for (const file of files) {
      // Skip salt file and non-.enc files
      if (file === ".salt" || !file.endsWith(".enc")) {
        continue;
      }
      
      // Extract key name (remove .enc extension)
      const key = file.slice(0, -4);
      
      // Filter by prefix if provided
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      
      keys.push(key);
    }
    
    return keys.sort();
  }
}
