#!/usr/bin/env node
/**
 * Generate Pact v4 Success Fixtures
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

const fixturesDir = path.join(__dirname, "..", "fixtures", "success");
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

function createRound(roundNumber, roundType, agentId, pubKey, timestamp, previousHash, envelopeHash, contentSummary = {}) {
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
    content_summary: contentSummary,
  };
  round.round_hash = computeRoundHash(round);
  return round;
}

// Success case 1: Simple success (INTENT -> ASK -> ACCEPT)
function createSuccess1() {
  const intentId = "intent-success1-test";
  const createdAt = baseTime;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.00005 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "ACCEPT", intent_id: intentId }));
  
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0, { intent_type: "weather.data" });
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1, { price: 0.00005 });
  const round2 = createRound(2, "ACCEPT", "buyer", buyerPubKeyB58, createdAt + 2000, round1.round_hash, envelopeHash2, { price: 0.00005 });
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
  
  transcript.final_hash = computeTranscriptHash(transcript);
  
  return transcript;
}

// Success case 2: Negotiated success (INTENT -> ASK -> BID -> COUNTER -> ACCEPT)
function createSuccess2() {
  const intentId = "intent-success2-test";
  const createdAt = baseTime + 1000000;
  const transcriptId = `transcript-${sha256(intentId + createdAt)}`;
  const initialHash = computeInitialHash(intentId, createdAt);
  const envelopeHash0 = sha256(stableCanonicalize({ type: "INTENT", intent_id: intentId }));
  const envelopeHash1 = sha256(stableCanonicalize({ type: "ASK", intent_id: intentId, price: 0.0001 }));
  const envelopeHash2 = sha256(stableCanonicalize({ type: "BID", intent_id: intentId, price: 0.00008 }));
  const envelopeHash3 = sha256(stableCanonicalize({ type: "COUNTER", intent_id: intentId, price: 0.00009 }));
  const envelopeHash4 = sha256(stableCanonicalize({ type: "ACCEPT", intent_id: intentId }));
  
  const round0 = createRound(0, "INTENT", "buyer", buyerPubKeyB58, createdAt, initialHash, envelopeHash0, { intent_type: "weather.data" });
  const round1 = createRound(1, "ASK", "seller", sellerPubKeyB58, createdAt + 1000, round0.round_hash, envelopeHash1, { price: 0.0001 });
  const round2 = createRound(2, "BID", "buyer", buyerPubKeyB58, createdAt + 2000, round1.round_hash, envelopeHash2, { price: 0.00008 });
  const round3 = createRound(3, "COUNTER", "seller", sellerPubKeyB58, createdAt + 3000, round2.round_hash, envelopeHash3, { price: 0.00009 });
  const round4 = createRound(4, "ACCEPT", "buyer", buyerPubKeyB58, createdAt + 4000, round3.round_hash, envelopeHash4, { price: 0.00009 });
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
  
  transcript.final_hash = computeTranscriptHash(transcript);
  
  return transcript;
}

const fixtures = {
  "SUCCESS-001-simple.json": createSuccess1(),
  "SUCCESS-002-negotiated.json": createSuccess2(),
};

for (const [filename, transcript] of Object.entries(fixtures)) {
  const filepath = path.join(fixturesDir, filename);
  fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2), "utf8");
  console.log(`✅ Generated: ${filename}`);
}

console.log(`\n✅ Generated ${Object.keys(fixtures).length} success fixtures in ${fixturesDir}`);
