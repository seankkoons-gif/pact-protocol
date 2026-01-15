/**
 * Transcript Replay Tests
 * 
 * Tests for transcript replay verification functionality.
 */

import { describe, it, expect } from "vitest";
import { replayTranscript } from "../replay";
import type { TranscriptV1 } from "../types";
import { signEnvelope, generateKeypair } from "../../protocol/envelope";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { computeCommitHash } from "../../exchange/commit";

describe("replayTranscript", () => {
  it("verifies valid transcript with signed envelope", async () => {
    const keypair = generateKeypair();
    const pubkeyB58 = bs58.encode(Buffer.from(keypair.publicKey));

    // Create a signed envelope
    const envelope = await signEnvelope(
      {
        protocol_version: "pact/1.0",
        type: "ASK",
        intent_id: "test-intent",
        intent_type: "weather.data",
        sent_at_ms: Date.now(),
        expires_at_ms: Date.now() + 60000,
        price: 0.0001,
        unit: "request",
        valid_for_ms: 20000,
        bond_required: 0.0001,
        latency_ms: 50,
      },
      keypair
    );

    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [
        {
          pubkey_b58: pubkeyB58,
          provider_id: "provider1",
        },
      ],
      credential_checks: [
        {
          pubkey_b58: pubkeyB58,
          ok: true,
          credential_summary: {
            signer_public_key_b58: pubkeyB58,
            expires_at_ms: Date.now() + 365 * 24 * 60 * 60 * 1000, // 1 year from now
          },
        },
      ],
      quotes: [
        {
          pubkey_b58: pubkeyB58,
          ok: true,
          signer_pubkey_b58: pubkeyB58,
        },
      ],
      outcome: { ok: true },
      explain: {
        level: "full",
        intentType: "weather.data",
        settlement: "hash_reveal",
        regime: "posted",
        decisions: [
          {
            provider_id: "provider1",
            pubkey_b58: pubkeyB58,
            step: "quote",
            ok: true,
            code: "PROVIDER_SELECTED",
            reason: "Selected",
            ts_ms: Date.now(),
            meta: {
              envelope,
            },
          },
        ],
      },
    };

    const result = await replayTranscript(transcript);

    expect(result.ok).toBe(true);
    expect(result.failures).toHaveLength(0);
    expect(result.summary.envelopes_verified).toBeGreaterThan(0);
    expect(result.summary.credentials_verified).toBe(1);
  });

  it("detects modified signature in envelope", async () => {
    const keypair = generateKeypair();
    const pubkeyB58 = bs58.encode(Buffer.from(keypair.publicKey));

    // Create a signed envelope
    const envelope = await signEnvelope(
      {
        protocol_version: "pact/1.0",
        type: "ASK",
        intent_id: "test-intent",
        intent_type: "weather.data",
        sent_at_ms: Date.now(),
        expires_at_ms: Date.now() + 60000,
        price: 0.0001,
        unit: "request",
        valid_for_ms: 20000,
        bond_required: 0.0001,
        latency_ms: 50,
      },
      keypair
    );

    // Modify the signature
    const modifiedEnvelope = {
      ...envelope,
      signature_b58: bs58.encode(nacl.randomBytes(64)), // Random signature
    };

    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      outcome: { ok: true },
      explain: {
        level: "full",
        intentType: "weather.data",
        settlement: "hash_reveal",
        regime: "posted",
        decisions: [
          {
            provider_id: "provider1",
            pubkey_b58: pubkeyB58,
            step: "quote",
            ok: true,
            code: "PROVIDER_SELECTED",
            reason: "Selected",
            ts_ms: Date.now(),
            meta: {
              envelope: modifiedEnvelope,
            },
          },
        ],
      },
    };

    const result = await replayTranscript(transcript);

    expect(result.ok).toBe(false);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.some((f) => f.code === "ENVELOPE_VERIFICATION_FAILED")).toBe(true);
    expect(result.summary.envelopes_failed).toBeGreaterThan(0);
  });

  it("detects expired credentials", async () => {
    const keypair = generateKeypair();
    const pubkeyB58 = bs58.encode(Buffer.from(keypair.publicKey));

    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [
        {
          pubkey_b58: pubkeyB58,
          ok: true,
          credential_summary: {
            signer_public_key_b58: pubkeyB58,
            expires_at_ms: Date.now() - 1000, // Expired 1 second ago
          },
        },
      ],
      quotes: [],
      outcome: { ok: true },
    };

    const result = await replayTranscript(transcript);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.code === "CREDENTIAL_EXPIRED")).toBe(true);
    expect(result.summary.credentials_expired).toBe(1);
  });

  it("detects credential signer mismatch", async () => {
    const keypair1 = generateKeypair();
    const keypair2 = generateKeypair();
    const pubkeyB58 = bs58.encode(Buffer.from(keypair1.publicKey));
    const otherPubkeyB58 = bs58.encode(Buffer.from(keypair2.publicKey));

    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [
        {
          pubkey_b58: pubkeyB58,
          ok: true,
          credential_summary: {
            signer_public_key_b58: otherPubkeyB58, // Different from provider pubkey
            expires_at_ms: Date.now() + 365 * 24 * 60 * 60 * 1000,
          },
        },
      ],
      quotes: [],
      outcome: { ok: true },
    };

    const result = await replayTranscript(transcript);

    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => f.code === "CREDENTIAL_SIGNER_MISMATCH")).toBe(true);
  });

  it("handles missing artifacts gracefully", async () => {
    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [
        {
          pubkey_b58: "test-pubkey",
          ok: true,
          // Missing credential_summary
        },
      ],
      quotes: [],
      settlement: {
        mode: "hash_reveal",
        artifacts_summary: {
          commit_hash: "abc123",
          reveal_nonce: "nonce123",
          // Missing payload for verification
        },
      },
      outcome: { ok: true },
    };

    const result = await replayTranscript(transcript);

    // Should not crash, but record failures
    expect(result.failures.some((f) => f.code === "MISSING_ARTIFACT")).toBe(true);
    expect(result.summary.artifacts_missing).toBeGreaterThan(0);
  });

  it("verifies commit-reveal hash match when payload is available", async () => {
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    const commitHash = computeCommitHash(payloadB64, nonceB64);

    const transcript: TranscriptV1 = {
      version: "1",
      intent_id: "test-intent",
      intent_type: "weather.data",
      timestamp_ms: Date.now(),
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0001,
      },
      directory: [],
      credential_checks: [],
      quotes: [],
      settlement: {
        mode: "hash_reveal",
        artifacts_summary: {
          commit_hash: commitHash,
          reveal_nonce: nonceB64,
        },
      },
      outcome: { ok: true },
      explain: {
        level: "full",
        intentType: "weather.data",
        settlement: "hash_reveal",
        regime: "posted",
        decisions: [
          {
            provider_id: "provider1",
            pubkey_b58: "test-pubkey",
            step: "settlement",
            ok: true,
            code: "REVEAL_VERIFIED" as any,
            reason: "Reveal verified",
            ts_ms: Date.now(),
            meta: {
              payload_b64: payloadB64,
            },
          },
        ],
      },
    };

    const result = await replayTranscript(transcript);

    expect(result.ok).toBe(true);
    expect(result.summary.commit_reveal_verified).toBe(1);
  });
});




