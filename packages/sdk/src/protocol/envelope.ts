// packages/sdk/src/protocol/envelope.ts
import nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash } from "node:crypto";
import { stableCanonicalize } from "./canonical";
import type { ParsedPactMessage } from "./schemas";

export type Keypair = {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
};

export type SignedEnvelope<T = ParsedPactMessage> = {
  envelope_version: "pact-envelope/1.0";
  message: T;
  message_hash_hex: string;
  envelope_hash_hex: string;
  signer_public_key_b58: string;
  signature_b58: string;
  signed_at_ms: number;
};

export function generateKeypair(): Keypair {
  return nacl.sign.keyPair();
}

// Back-compat alias (some code calls generateKeyPair)
export const generateKeyPair = generateKeypair;

/**
 * Encode a public key to base58 string (used for agent IDs).
 * This encapsulates bs58 usage so examples don't need to import it directly.
 */
export function publicKeyToB58(publicKey: Uint8Array): string {
  return bs58.encode(Buffer.from(publicKey));
}

/**
 * Encode arbitrary bytes to base58 string (used for signatures).
 * This encapsulates bs58 usage so examples don't need to import it directly.
 */
export function bytesToB58(bytes: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return bs58.encode(buf);
}

function toUtf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function sha256Hex(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Hashes the message ONLY (not the envelope), using stable canonical JSON.
 */
export function hashMessage(message: unknown): { hashBytes: Uint8Array; hashHex: string } {
  const canon = stableCanonicalize(message);
  const bytes = toUtf8Bytes(canon);
  const hex = sha256Hex(bytes);
  return { hashBytes: new Uint8Array(Buffer.from(hex, "hex")), hashHex: hex };
}

/**
 * Signs the envelope hash with Ed25519 (tweetnacl).
 * 
 * The envelope hash is computed from {envelope_version, message, message_hash_hex}
 * (excluding signature fields), and the signature is over the raw bytes of that hash.
 * This matches what the v4 replay verifier expects.
 */
export async function signEnvelope<T = ParsedPactMessage>(
  message: T,
  keypair: Keypair,
  signedAtMs: number = Date.now()
): Promise<SignedEnvelope<T>> {
  // Compute message hash
  const { hashHex: messageHashHex } = hashMessage(message);

  // Compute envelope hash (same method as replay verifier expects)
  const envelopeForHash = {
    envelope_version: "pact-envelope/1.0" as const,
    message,
    message_hash_hex: messageHashHex,
  };
  const envelopeCanonical = stableCanonicalize(envelopeForHash);
  const envelopeHashHex = sha256Hex(toUtf8Bytes(envelopeCanonical));

  // Sign the raw bytes of envelope_hash_hex (not message_hash_hex)
  const envelopeHashBytes = Buffer.from(envelopeHashHex, "hex");
  const sigBytes = nacl.sign.detached(envelopeHashBytes, keypair.secretKey);

  return {
    envelope_version: "pact-envelope/1.0",
    message,
    message_hash_hex: messageHashHex,
    envelope_hash_hex: envelopeHashHex,
    signer_public_key_b58: bs58.encode(Buffer.from(keypair.publicKey)),
    signature_b58: bs58.encode(Buffer.from(sigBytes)),
    signed_at_ms: signedAtMs,
  };
}

/**
 * Verifies:
 * 1) envelope shape
 * 2) message_hash_hex matches recomputed hash(message)
 * 3) envelope_hash_hex matches recomputed hash(envelope structure)
 * 4) signature verifies over envelope_hash_hex bytes using signer_public_key_b58
 */
export function verifyEnvelope(envelope: any): boolean {
  try {
    if (!envelope || envelope.envelope_version !== "pact-envelope/1.0") return false;
    if (!envelope.message) return false;

    const msgHashHex = envelope.message_hash_hex;
    if (typeof msgHashHex !== "string" || msgHashHex.length !== 64) return false;

    // Recompute message hash
    const { hashHex } = hashMessage(envelope.message);
    if (hashHex !== msgHashHex.toLowerCase()) return false;

    // Recompute envelope hash (same method as signEnvelope)
    const envelopeForHash = {
      envelope_version: "pact-envelope/1.0" as const,
      message: envelope.message,
      message_hash_hex: msgHashHex,
    };
    const envelopeCanonical = stableCanonicalize(envelopeForHash);
    const computedEnvelopeHashHex = sha256Hex(toUtf8Bytes(envelopeCanonical));

    // Verify envelope_hash_hex if present (new envelopes have it, old ones might not)
    if (envelope.envelope_hash_hex) {
      if (computedEnvelopeHashHex !== envelope.envelope_hash_hex.toLowerCase()) return false;
    }

    const pubB58 = envelope.signer_public_key_b58;
    const sigB58 = envelope.signature_b58;
    if (typeof pubB58 !== "string" || typeof sigB58 !== "string") return false;

    const pubBytes = bs58.decode(pubB58);
    const sigBytes = bs58.decode(sigB58);

    // Verify signature over envelope_hash_hex bytes (not message_hash_hex)
    const envelopeHashBytes = Buffer.from(
      envelope.envelope_hash_hex || computedEnvelopeHashHex,
      "hex"
    );
    return nacl.sign.detached.verify(envelopeHashBytes, sigBytes, pubBytes);
  } catch {
    return false;
  }
}

/**
 * Parse and validate an envelope from unknown input.
 */
export async function parseEnvelope(input: unknown): Promise<SignedEnvelope> {
  // Basic shape validation
  if (typeof input !== "object" || input === null) {
    throw new Error("Envelope must be an object");
  }

  const env = input as Record<string, unknown>;

  if (env.envelope_version !== "pact-envelope/1.0") {
    throw new Error(`Invalid envelope_version: ${env.envelope_version}`);
  }

  if (!env.message) {
    throw new Error("Envelope missing message field");
  }

  // Validate envelope structure
  if (typeof env.message_hash_hex !== "string") {
    throw new Error("message_hash_hex must be a string");
  }

  // envelope_hash_hex is optional for backward compatibility (old envelopes may not have it)
  if (env.envelope_hash_hex !== undefined && typeof env.envelope_hash_hex !== "string") {
    throw new Error("envelope_hash_hex must be a string if present");
  }

  if (typeof env.signer_public_key_b58 !== "string") {
    throw new Error("signer_public_key_b58 must be a string");
  }

  if (typeof env.signature_b58 !== "string") {
    throw new Error("signature_b58 must be a string");
  }

  if (typeof env.signed_at_ms !== "number") {
    throw new Error("signed_at_ms must be a number");
  }

  // Compute envelope_hash_hex if missing (backward compatibility)
  let envelopeHashHex = env.envelope_hash_hex as string | undefined;
  if (!envelopeHashHex) {
    const envelopeForHash = {
      envelope_version: "pact-envelope/1.0" as const,
      message: env.message,
      message_hash_hex: env.message_hash_hex,
    };
    const envelopeCanonical = stableCanonicalize(envelopeForHash);
    envelopeHashHex = sha256Hex(toUtf8Bytes(envelopeCanonical));
  }

  return {
    envelope_version: "pact-envelope/1.0",
    message: env.message as ParsedPactMessage,
    message_hash_hex: env.message_hash_hex,
    envelope_hash_hex: envelopeHashHex,
    signer_public_key_b58: env.signer_public_key_b58,
    signature_b58: env.signature_b58,
    signed_at_ms: env.signed_at_ms,
  };
}
