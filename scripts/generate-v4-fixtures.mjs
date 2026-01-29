#!/usr/bin/env node
/**
 * Generate Pact v4 Failure Fixtures
 * Run from packages/sdk directory where dependencies are available
 */

import { createRequire } from "module";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to require from SDK package first, then fallback
const requireSDK = createRequire(join(__dirname, "../packages/sdk/package.json"));
const crypto = requireSDK("crypto");
const fs = requireSDK("fs");
const path = requireSDK("path");
let nacl, bs58;

try {
  nacl = requireSDK("tweetnacl");
  bs58 = requireSDK("bs58");
} catch (e) {
  // Fallback: try from root
  const requireRoot = createRequire(import.meta.url);
  nacl = requireRoot("tweetnacl");
  bs58 = requireRoot("bs58");
}

const fixturesDir = path.join(__dirname, "..", "fixtures", "failures");
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

function stableCanonicalize(obj) {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map((item) => stableCanonicalize(item)).join(",") + "]";
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    return "{" + keys.map((key) => JSON.stringify(key) + ":" + stableCanonicalize(obj[key])).join(",") + "}";
  }
  return JSON.stringify(obj);
}

function sha256(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

function deriveKeypair(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest();
  return nacl.sign.keyPair.fromSeed(new Uint8Array(hash));
}

function computeInitialHash(intentId, createdAtMs) {
  return sha256(`${intentId}:${createdAtMs}`);
}

function computeRoundHash(round) {
  const { round_hash, ...rest } = round;
  return sha256(stableCanonicalize(rest));
}

function computeTranscriptHash(transcript) {
  const { final_hash, ...rest } = transcript;
  return sha256(stableCanonicalize(rest));
}

function signEnvelopeHash(envelopeHash, keypair) {
  const hashBytes = Buffer.from(envelopeHash, "hex");
  const sigBytes = nacl.sign.detached(hashBytes, keypair.secretKey);
  return bs58.encode(Buffer.from(sigBytes));
}

const buyerKeypair = deriveKeypair("buyer-test-seed-v1");
const sellerKeypair = deriveKeypair("seller-test-seed-v1");
const buyerPubKeyB58 = bs58.encode(Buffer.from(buyerKeypair.publicKey));
const sellerPubKeyB58 = bs58.encode(Buffer.from(sellerKeypair.publicKey));

const baseTime = 1000000000000;

function createRound(roundNumber, roundType, agentId, pubKey, timestamp, previousHash, envelopeHash) {
  const round = {
    round_number: roundNumber,
    round_type: roundType,
    message_hash: envelopeHash.substring(0, 64).padStart(64, "0"),
    envelope_hash: envelopeHash,
    signature: {
      signer_public_key_b58: pubKey,
      signature_b58: signEnvelopeHash(envelopeHash, agentId === "buyer" ? buyerKeypair : sellerKeypair),
      signed_at_ms: timestamp,
      scheme: "ed25519",
    },
    timestamp_ms: timestamp,
    previous_round_hash: previousHash,
    agent_id: agentId,
    public_key_b58: pubKey,
    content_summary: roundType === "INTENT" ? { intent_type: "weather.data" } : {},
  };
  round.round_hash = computeRoundHash(round);
  return round;
}

function createPACT101() {
  const intentId = "intent-pact101-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00015 }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1);
  const rounds = [round0, round1];
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
  };
  const failureEvent = {
    code: "PACT-101",
    stage: "negotiation",
    fault_domain: "policy",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[1].envelope_hash, rounds[1].round_hash],
    timestamp: createdAt + 2000,
    transcript_hash: "",
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.failure_event = failureEvent;
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT202() {
  const intentId = "intent-pact202-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00005 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00006 }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1);
  const round2 = createRound(2, "BID", "buyer", buyerPubKeyB58, createdAt + 2000, round1.round_hash, envelopeHash2);
  const rounds = [round0, round1, round2];
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer", kya_expires_at: createdAt + 2500 })),
    rounds,
  };
  const failureEvent = {
    code: "PACT-202",
    stage: "admission",
    fault_domain: "identity",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[2].round_hash, "credential-snapshot-hash-abc123"],
    timestamp: createdAt + 5000,
    transcript_hash: "",
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.failure_event = failureEvent;
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT303() {
  const intentId = "intent-pact303-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.0001 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00008 }));
  const envelopeHash3 = sha256(stableCanonicalize({ type: "COUNTER", intent_id: intentId, price: 0.00009 }));
  const envelopeHash4 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00008 }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1);
  const round2 = createRound(2, "BID", "buyer", buyerPubKeyB58, createdAt + 2000, round1.round_hash, envelopeHash2);
  const round3 = createRound(3, "COUNTER", "seller", sellerPubKeyB58, createdAt + 3000, round2.round_hash, envelopeHash3);
  const round4 = createRound(4, "BID", "buyer", buyerPubKeyB58, createdAt + 4000, round3.round_hash, envelopeHash4);
  const rounds = [round0, round1, round2, round3, round4];
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
  };
  const failureEvent = {
    code: "PACT-303",
    stage: "negotiation",
    fault_domain: "negotiation",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[3].round_hash, rounds[4].round_hash],
    timestamp: createdAt + 5000,
    transcript_hash: "",
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.failure_event = failureEvent;
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT404() {
  const intentId = "intent-pact404-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00005 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "ACCEPT", intent_id: intentId }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1);
  const round2 = createRound(2, "ACCEPT", "buyer", buyerPubKeyB58, createdAt + 2000, round1.round_hash, envelopeHash2);
  const rounds = [round0, round1, round2];
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
  };
  const failureEvent = {
    code: "PACT-404",
    stage: "settlement",
    fault_domain: "settlement",
    terminality: "non_terminal",
    evidence_refs: [transcriptId, rounds[2].round_hash, "settlement-handle-timeout-xyz789"],
    timestamp: createdAt + 10000,
    transcript_hash: "",
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.failure_event = failureEvent;
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT420() {
  const intentId = "intent-pact420-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const rounds = [round0];
  const failureEvent = {
    code: "PACT-420",
    stage: "negotiation",
    fault_domain: "PROVIDER_AT_FAULT",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[0].round_hash, "abort_reason:Quote request network error: fetch failed"],
    timestamp: createdAt + 1000,
    transcript_hash: "",
  };
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
    failure_event: failureEvent,
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT421() {
  const intentId = "intent-pact421-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const rounds = [round0];
  const failureEvent = {
    code: "PACT-421",
    stage: "negotiation",
    fault_domain: "PROVIDER_AT_FAULT",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[0].round_hash, "abort_reason:Provider API mismatch - /pact endpoint not found: 404 Not Found"],
    timestamp: createdAt + 1000,
    transcript_hash: "",
  };
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
    failure_event: failureEvent,
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

function createPACT505() {
  const intentId = "intent-pact505-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0);
  const rounds = [round0];
  const transcript = {
    transcript_version: "pact-transcript/4.0",
    transcript_id: transcriptId,
    intent_id: intentId,
    intent_type: "weather.data",
    created_at_ms: createdAt,
    policy_hash: sha256(stableCanonicalize({ max_price: 0.0001 })),
    strategy_hash: sha256(stableCanonicalize({ strategy: "banded_concession" })),
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer" })),
    rounds,
  };
  const failureEvent = {
    code: "PACT-505",
    stage: "discovery",
    fault_domain: "recursive",
    terminality: "terminal",
    evidence_refs: [transcriptId, rounds[0].round_hash, "sub-agent-failure-log-def456", "dependency-error-stack-trace-ghi789"],
    timestamp: createdAt + 2000,
    transcript_hash: "",
  };
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.failure_event = failureEvent;
  transcript.final_hash = computeTranscriptHash(transcript);
  return transcript;
}

const fixtures = {
  "PACT-101-policy-violation.json": createPACT101(),
  "PACT-202-kya-expiry.json": createPACT202(),
  "PACT-303-strategic-deadlock.json": createPACT303(),
  "PACT-404-settlement-timeout.json": createPACT404(),
  "PACT-420-provider-unreachable.json": createPACT420(),
  "PACT-421-provider-api-mismatch.json": createPACT421(),
  "PACT-505-recursive-failure.json": createPACT505(),
};

for (const [filename, transcript] of Object.entries(fixtures)) {
  const filepath = path.join(fixturesDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2), "utf8");
  console.log(`✅ Generated: ${filename}`);
}

console.log(`\n✅ Generated ${Object.keys(fixtures).length} fixtures in ${fixturesDir}`);
