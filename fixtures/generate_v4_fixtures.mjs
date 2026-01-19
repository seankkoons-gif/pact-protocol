#!/usr/bin/env node
/**
 * Generate Pact v4 Failure Fixtures
 * 
 * Creates complete v4 transcripts with failure events for testing.
 */

import * as crypto from "node:crypto";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import nacl from "tweetnacl";
import bs58 from "bs58";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deterministic keypairs for testing (from seeds)
function deriveKeypair(seed) {
  const hash = crypto.createHash("sha256").update(seed).digest();
  return nacl.sign.keyPair.fromSeed(hash);
}

// Canonical JSON serialization (matches SDK)
function stableCanonicalize(obj) {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const items = obj.map((item) => stableCanonicalize(item));
    return `[${items.join(",")}]`;
  }
  if (typeof obj === "object") {
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((key) => {
      const value = obj[key];
      return `${JSON.stringify(key)}:${stableCanonicalize(value)}`;
    });
    return `{${pairs.join(",")}}`;
  }
  return JSON.stringify(obj);
}

function sha256(canonical) {
  const hash = crypto.createHash("sha256");
  hash.update(canonical, "utf8");
  return hash.digest("hex");
}

function computeInitialHash(intentId, createdAtMs) {
  return sha256(`${intentId}:${createdAtMs}`);
}

function computeRoundHash(round) {
  const { round_hash, ...roundWithoutHash } = round;
  return sha256(stableCanonicalize(roundWithoutHash));
}

function computeTranscriptHash(transcript) {
  const { final_hash, ...transcriptWithoutHash } = transcript;
  return sha256(stableCanonicalize(transcriptWithoutHash));
}

function signEnvelopeHash(envelopeHash, keypair) {
  const hashBytes = Buffer.from(envelopeHash, "hex");
  const sigBytes = nacl.sign.detached(hashBytes, keypair.secretKey);
  return bs58.encode(Buffer.from(sigBytes));
}

// Test keypairs (deterministic from seeds)
const buyerKeypair = deriveKeypair("buyer-test-seed-v1");
const sellerKeypair = deriveKeypair("seller-test-seed-v1");

const buyerPubKeyB58 = bs58.encode(Buffer.from(buyerKeypair.publicKey));
const sellerPubKeyB58 = bs58.encode(Buffer.from(sellerKeypair.publicKey));

// Base timestamp
const baseTime = 1000000000000; // 2001-09-09 01:46:40 UTC

// Helper to create a round
function createRound(roundNumber, roundType, agentId, pubKey, timestamp, previousHash, envelopeHash) {
  const round = {
    round_number: roundNumber,
    round_type: roundType,
    message_hash: envelopeHash.substring(0, 64), // Simulated message hash
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

// PACT-101: Policy violation (POLICY_MAX_PRICE_EXCEEDED)
function createPACT101() {
  const intentId = "intent-pact101-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt).substring(0, 64)}`;
  
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId, price: 0.0002 }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00015 }));
  
  const rounds = [
    createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0),
    createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, rounds[0].round_hash, envelopeHash1),
  ];
  
  // Failure at negotiation stage (ASK exceeds max_price)
  const failureEvent = {
    code: "PACT-101",
    stage: "negotiation",
    fault_domain: "policy",
    terminality: "terminal",
    evidence_refs: [
      transcriptId,
      rounds[1].envelope_hash,
      rounds[1].round_hash,
    ],
    timestamp: createdAt + 2000,
    transcript_hash: "", // Will be computed
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
  
  // Compute failure_event transcript_hash (transcript up to failure, excluding failure_event)
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  
  // Compute final_hash
  transcript.final_hash = computeTranscriptHash(transcript);
  
  return transcript;
}

// PACT-202: KYA expiry mid-negotiation
function createPACT202() {
  const intentId = "intent-pact202-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt).substring(0, 64)}`;
  
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00005 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00006 }));
  
  const rounds = [
    createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0),
    createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, rounds[0].round_hash, envelopeHash1),
    createRound(2, "BID", "buyer", buyerPubKeyB58, createdAt + 2000, rounds[1].round_hash, envelopeHash2),
  ];
  
  // Failure at admission stage (KYA expired during negotiation)
  const failureEvent = {
    code: "PACT-202",
    stage: "admission",
    fault_domain: "identity",
    terminality: "terminal",
    evidence_refs: [
      transcriptId,
      rounds[2].round_hash,
      "credential-snapshot-hash-abc123",
    ],
    timestamp: createdAt + 5000,
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
    identity_snapshot_hash: sha256(stableCanonicalize({ buyer: "test-buyer", kya_expires_at: createdAt + 2500 })),
    rounds,
    failure_event: failureEvent,
  };
  
  const transcriptUpToFailure = { ...transcript, failure_event: undefined };
  failureEvent.transcript_hash = sha256(stableCanonicalize(transcriptUpToFailure));
  transcript.final_hash = computeTranscriptHash(transcript);
  
  return transcript;
}

// PACT-303: Strategic deadlock
function createPACT303() {
  const intentId = "intent-pact303-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt).substring(0, 64)}`;
  
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.0001 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00008 }));
  const envelopeHash3 = sha256(stableCanonicalize({ type: "COUNTER", intent_id: intentId, price: 0.00009 }));
  const envelopeHash4 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00008 })); // Repeated bid (deadlock)
  
  const rounds = [
    createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0),
    createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, rounds[0].round_hash, envelopeHash1),
    createRound(2, "BID", "buyer", buyerPubKeyB58, createdAt + 2000, rounds[1].round_hash, envelopeHash2),
    createRound(3, "COUNTER", "seller", sellerPubKeyB58, createdAt + 3000, rounds[2].round_hash, envelopeHash3),
    createRound(4, "BID", "buyer", buyerPubKeyB58, createdAt + 4000, rounds[3].round_hash, envelopeHash4),
  ];
  
  const failureEvent = {
    code: "PACT-303",
    stage: "negotiation",
    fault_domain: "negotiation",
    terminality: "terminal",
    evidence_refs: [
      transcriptId,
      rounds[3].round_hash,
      rounds[4].round_hash,
    ],
    timestamp: createdAt + 5000,
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

// PACT-404: Settlement timeout
function createPACT404() {
  const intentId = "intent-pact404-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt).substring(0, 64)}`;
  
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00005 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "ACCEPT", intent_id: intentId }));
  
  const rounds = [
    createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0),
    createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, rounds[0].round_hash, envelopeHash1),
    createRound(2, "ACCEPT", "buyer", buyerPubKeyB58, createdAt + 2000, rounds[1].round_hash, envelopeHash2),
  ];
  
  const failureEvent = {
    code: "PACT-404",
    stage: "settlement",
    fault_domain: "settlement",
    terminality: "non_terminal",
    evidence_refs: [
      transcriptId,
      rounds[2].round_hash,
      "settlement-handle-timeout-xyz789",
    ],
    timestamp: createdAt + 10000, // Timeout after 10 seconds
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

// PACT-505: Recursive sub-agent failure
function createPACT505() {
  const intentId = "intent-pact505-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt).substring(0, 64)}`;
  
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  
  const rounds = [
    createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0),
  ];
  
  const failureEvent = {
    code: "PACT-505",
    stage: "discovery",
    fault_domain: "recursive",
    terminality: "terminal",
    evidence_refs: [
      transcriptId,
      rounds[0].round_hash,
      "sub-agent-failure-log-def456",
      "dependency-error-stack-trace-ghi789",
    ],
    timestamp: createdAt + 2000,
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

// Generate all fixtures
const fixtures = {
  "PACT-101-policy-violation.json": createPACT101(),
  "PACT-202-kya-expiry.json": createPACT202(),
  "PACT-303-strategic-deadlock.json": createPACT303(),
  "PACT-404-settlement-timeout.json": createPACT404(),
  "PACT-505-recursive-failure.json": createPACT505(),
};

// Write fixtures
const fixturesDir = path.join(__dirname, "failures");
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true });
}

for (const [filename, transcript] of Object.entries(fixtures)) {
  const filepath = path.join(fixturesDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2), "utf8");
  console.log(`✅ Generated: ${filepath}`);
}

console.log(`\n✅ Generated ${Object.keys(fixtures).length} fixtures in ${fixturesDir}`);
