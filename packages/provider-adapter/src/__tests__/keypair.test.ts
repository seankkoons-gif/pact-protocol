import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadProviderKeypair } from "../keypair";

describe("loadProviderKeypair", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Clear env vars before each test
    process.env = { ...originalEnv };
    delete process.env.PACT_PROVIDER_SECRET_KEY_B58;
    delete process.env.PACT_PROVIDER_KEYPAIR_FILE;
    delete process.env.PACT_DEV_IDENTITY_SEED;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load keypair from PACT_PROVIDER_SECRET_KEY_B58", async () => {
    // Generate a test keypair
    const nacl = await import("tweetnacl");
    const bs58 = await import("bs58");
    const testKeypair = nacl.default.sign.keyPair();
    const secretKeyB58 = bs58.default.encode(Buffer.from(testKeypair.secretKey));
    
    process.env.PACT_PROVIDER_SECRET_KEY_B58 = secretKeyB58;
    
    const result = await loadProviderKeypair();
    
    expect(result.mode).toBe("env-secret-key");
    expect(result.sellerId).toBe(bs58.default.encode(Buffer.from(testKeypair.publicKey)));
    expect(result.warning).toBeUndefined();
  });

  it("should load keypair from PACT_PROVIDER_KEYPAIR_FILE", async () => {
    const nacl = await import("tweetnacl");
    const bs58 = await import("bs58");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    
    // Generate a test keypair
    const testKeypair = nacl.default.sign.keyPair();
    const secretKeyB58 = bs58.default.encode(Buffer.from(testKeypair.secretKey));
    const publicKeyB58 = bs58.default.encode(Buffer.from(testKeypair.publicKey));
    
    const keypairFile = "/tmp/test-keypair.json";
    writeFileSync(keypairFile, JSON.stringify({ secretKeyB58, publicKeyB58 }));
    
    process.env.PACT_PROVIDER_KEYPAIR_FILE = keypairFile;
    
    const result = await loadProviderKeypair();
    
    expect(result.mode).toBe("keypair-file");
    expect(result.sellerId).toBe(publicKeyB58);
    expect(result.warning).toBeUndefined();
    
    // Cleanup
    unlinkSync(keypairFile);
  });

  it("should load deterministic keypair when PACT_DEV_IDENTITY_SEED is set", async () => {
    process.env.PACT_DEV_IDENTITY_SEED = "test-seed-v1";
    
    const result1 = await loadProviderKeypair();
    
    // Clear and reload with same seed - should produce same keypair
    delete process.env.PACT_DEV_IDENTITY_SEED;
    process.env.PACT_DEV_IDENTITY_SEED = "test-seed-v1";
    
    const result2 = await loadProviderKeypair();
    
    expect(result1.mode).toBe("dev-seed");
    expect(result2.mode).toBe("dev-seed");
    expect(result1.sellerId).toBe(result2.sellerId); // Same seed = same keypair
    expect(result1.warning).toContain("DEV-ONLY");
    expect(result2.warning).toContain("DEV-ONLY");
  });

  it("should generate ephemeral keypair when no env vars are set", async () => {
    const result = await loadProviderKeypair();
    
    expect(result.mode).toBe("ephemeral");
    expect(result.sellerId).toBeTruthy();
    expect(result.warning).toBeUndefined();
  });

  it("should prioritize PACT_PROVIDER_SECRET_KEY_B58 over PACT_PROVIDER_KEYPAIR_FILE", async () => {
    const nacl = await import("tweetnacl");
    const bs58 = await import("bs58");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    
    // Generate two different keypairs
    const envKeypair = nacl.default.sign.keyPair();
    const fileKeypair = nacl.default.sign.keyPair();
    
    const envSecretKeyB58 = bs58.default.encode(Buffer.from(envKeypair.secretKey));
    const fileSecretKeyB58 = bs58.default.encode(Buffer.from(fileKeypair.secretKey));
    const filePublicKeyB58 = bs58.default.encode(Buffer.from(fileKeypair.publicKey));
    
    const keypairFile = "/tmp/test-keypair.json";
    writeFileSync(keypairFile, JSON.stringify({ secretKeyB58: fileSecretKeyB58, publicKeyB58: filePublicKeyB58 }));
    
    process.env.PACT_PROVIDER_SECRET_KEY_B58 = envSecretKeyB58;
    process.env.PACT_PROVIDER_KEYPAIR_FILE = keypairFile;
    
    const result = await loadProviderKeypair();
    
    // Should use env var (precedence 1)
    expect(result.mode).toBe("env-secret-key");
    expect(result.sellerId).toBe(bs58.default.encode(Buffer.from(envKeypair.publicKey)));
    
    // Cleanup
    unlinkSync(keypairFile);
  });

  it("should prioritize PACT_PROVIDER_KEYPAIR_FILE over PACT_DEV_IDENTITY_SEED", async () => {
    const nacl = await import("tweetnacl");
    const bs58 = await import("bs58");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    
    // Generate a test keypair
    const testKeypair = nacl.default.sign.keyPair();
    const secretKeyB58 = bs58.default.encode(Buffer.from(testKeypair.secretKey));
    const publicKeyB58 = bs58.default.encode(Buffer.from(testKeypair.publicKey));
    
    const keypairFile = "/tmp/test-keypair.json";
    writeFileSync(keypairFile, JSON.stringify({ secretKeyB58, publicKeyB58 }));
    
    process.env.PACT_PROVIDER_KEYPAIR_FILE = keypairFile;
    process.env.PACT_DEV_IDENTITY_SEED = "test-seed-v1";
    
    const result = await loadProviderKeypair();
    
    // Should use keypair file (precedence 2)
    expect(result.mode).toBe("keypair-file");
    expect(result.sellerId).toBe(publicKeyB58);
    expect(result.warning).toBeUndefined();
    
    // Cleanup
    unlinkSync(keypairFile);
  });

  it("should throw error for invalid secret key length", async () => {
    process.env.PACT_PROVIDER_SECRET_KEY_B58 = "invalid";
    
    await expect(loadProviderKeypair()).rejects.toThrow("Failed to load keypair");
  });

  it("should throw error for invalid keypair file", async () => {
    process.env.PACT_PROVIDER_KEYPAIR_FILE = "/nonexistent/file.json";
    
    await expect(loadProviderKeypair()).rejects.toThrow("Failed to load keypair");
  });
});




