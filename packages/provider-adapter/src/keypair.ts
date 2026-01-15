/**
 * Provider Keypair Loading Utility
 * 
 * Loads provider keypair with the following precedence:
 * 1. PACT_PROVIDER_SECRET_KEY_B58 (env var - base58 encoded 64-byte ed25519 secret key)
 * 2. PACT_PROVIDER_KEYPAIR_FILE (env var - path to JSON file with {publicKeyB58, secretKeyB58} or {secretKeyB58})
 * 3. PACT_DEV_IDENTITY_SEED (env var - explicit opt-in for deterministic dev identity)
 * 4. Random ephemeral keypair (fallback)
 */

import type { Keypair } from "@pact/sdk";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

export interface KeypairLoadResult {
  keypair: Keypair;
  sellerId: string; // pubkey b58
  mode: "env-secret-key" | "keypair-file" | "dev-seed" | "ephemeral";
  warning?: string; // Only set for dev-seed mode
}

export async function loadProviderKeypair(): Promise<KeypairLoadResult> {
  const nacl = await import("tweetnacl");
  const bs58 = await import("bs58");
  
  // Precedence 1: PACT_PROVIDER_SECRET_KEY_B58
  const secretKeyB58 = process.env.PACT_PROVIDER_SECRET_KEY_B58;
  if (secretKeyB58) {
    try {
      const secretKey = bs58.default.decode(secretKeyB58);
      if (secretKey.length !== 64) {
        throw new Error(`Invalid secret key length: expected 64 bytes, got ${secretKey.length}`);
      }
      const keypair = nacl.default.sign.keyPair.fromSecretKey(secretKey);
      const sellerId = bs58.default.encode(Buffer.from(keypair.publicKey));
      return {
        keypair,
        sellerId,
        mode: "env-secret-key",
      };
    } catch (error: any) {
      throw new Error(`Failed to load keypair from PACT_PROVIDER_SECRET_KEY_B58: ${error.message}`);
    }
  }
  
  // Precedence 2: PACT_PROVIDER_KEYPAIR_FILE
  const keypairFile = process.env.PACT_PROVIDER_KEYPAIR_FILE;
  if (keypairFile) {
    try {
      const fileContent = readFileSync(keypairFile, "utf-8");
      const data = JSON.parse(fileContent);
      
      let secretKey: Uint8Array;
      if (data.secretKeyB58) {
        secretKey = bs58.default.decode(data.secretKeyB58);
      } else if (data.secretKey) {
        // Allow raw base64 or hex encoding as fallback
        if (typeof data.secretKey === "string") {
          try {
            secretKey = bs58.default.decode(data.secretKey);
          } catch {
            secretKey = Buffer.from(data.secretKey, "base64");
          }
        } else {
          throw new Error("Invalid secretKey format in keypair file");
        }
      } else {
        throw new Error("Keypair file must contain secretKeyB58 or secretKey field");
      }
      
      if (secretKey.length !== 64) {
        throw new Error(`Invalid secret key length: expected 64 bytes, got ${secretKey.length}`);
      }
      
      const keypair = nacl.default.sign.keyPair.fromSecretKey(secretKey);
      const sellerId = bs58.default.encode(Buffer.from(keypair.publicKey));
      
      // Verify publicKeyB58 if provided
      if (data.publicKeyB58) {
        const expectedPubkey = bs58.default.encode(Buffer.from(keypair.publicKey));
        if (data.publicKeyB58 !== expectedPubkey) {
          throw new Error("Public key in file does not match secret key");
        }
      }
      
      return {
        keypair,
        sellerId,
        mode: "keypair-file",
      };
    } catch (error: any) {
      throw new Error(`Failed to load keypair from ${keypairFile}: ${error.message}`);
    }
  }
  
  // Precedence 3: PACT_DEV_IDENTITY_SEED (explicit opt-in)
  const devSeed = process.env.PACT_DEV_IDENTITY_SEED;
  if (devSeed) {
    const seedHash = createHash("sha256").update(devSeed).digest(); // 32 bytes
    const keypair = nacl.default.sign.keyPair.fromSeed(seedHash);
    const sellerId = bs58.default.encode(Buffer.from(keypair.publicKey));
    return {
      keypair,
      sellerId,
      mode: "dev-seed",
      warning: "⚠️  DEV-ONLY: Using deterministic identity from seed (NOT for production)",
    };
  }
  
  // Precedence 4: Random ephemeral keypair
  const keypair = nacl.default.sign.keyPair();
  const sellerId = bs58.default.encode(Buffer.from(keypair.publicKey));
  return {
    keypair,
    sellerId,
    mode: "ephemeral",
  };
}




