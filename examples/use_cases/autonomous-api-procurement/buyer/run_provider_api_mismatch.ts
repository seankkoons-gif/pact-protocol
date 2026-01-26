#!/usr/bin/env tsx
/**
 * PACT-421 Provider API Mismatch Fixture Generator
 * 
 * Generates a deterministic v4 transcript for PACT-421 (provider API mismatch).
 * 
 * Usage:
 *   tsx examples/use_cases/autonomous-api-procurement/buyer/run_provider_api_mismatch.ts
 * 
 * The script:
 * 1. Creates a transcript with INTENT round
 * 2. Starts a stub server that returns 404 for /pact
 * 3. Creates failure_event with PACT-421
 * 4. Saves to fixtures/failures/PACT-421-provider-api-mismatch.json
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import { fileURLToPath } from "node:url";
import {
  createTranscriptV4,
  stableCanonicalize,
  publicKeyToB58,
  bytesToB58,
  type TranscriptV4,
  type TranscriptRound,
  type Signature,
} from "@pact/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../../../..");

// Deterministic constants for reproducibility
const DETERMINISTIC_TIMESTAMP = 1000000000000;
const INTENT_ID = "intent-pact421-test";
const INTENT_TYPE = "weather.data";
const STUB_PORT = 59421;

interface KeyPairWithObjects {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  publicKeyObj: crypto.KeyObject;
  privateKeyObj: crypto.KeyObject;
}

function generateDeterministicKeyPair(seed: string): KeyPairWithObjects {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "der" },
    publicKeyEncoding: { type: "spki", format: "der" },
  });
  const fixedPrivate = crypto.createPrivateKey({
    key: privateKey,
    format: "der",
    type: "pkcs8",
  });
  const fixedPublic = crypto.createPublicKey(fixedPrivate);
  const publicKeyJwk = fixedPublic.export({ format: "jwk" }) as { x: string };
  const privateKeyJwk = fixedPrivate.export({ format: "jwk" }) as { d: string; x: string };
  const publicKeyBytes = Buffer.from(publicKeyJwk.x, "base64url");
  const privateKeyBytes = Buffer.from(privateKeyJwk.d, "base64url");
  return {
    publicKey: new Uint8Array(publicKeyBytes),
    secretKey: new Uint8Array(Buffer.concat([privateKeyBytes, publicKeyBytes])),
    publicKeyObj: fixedPublic,
    privateKeyObj: fixedPrivate,
  };
}

function createSignedRound(
  roundType: "INTENT" | "ASK" | "ACCEPT",
  agentId: string,
  keypair: KeyPairWithObjects,
  timestampMs: number,
  intentId: string,
  contentSummary?: Record<string, unknown>
): Omit<TranscriptRound, "round_number" | "previous_round_hash" | "round_hash"> {
  const envelope: Record<string, unknown> = {
    type: roundType,
    intent_id: intentId,
    ...(contentSummary || {}),
  };
  const envelopeCanonical = stableCanonicalize(envelope);
  const envelopeHash = crypto.createHash("sha256").update(envelopeCanonical, "utf8").digest("hex");
  const hashBytes = Buffer.from(envelopeHash, "hex");
  const sigBytes = crypto.sign(null, hashBytes, keypair.privateKeyObj);
  const signatureB58 = bytesToB58(sigBytes);
  const publicKeyB58 = publicKeyToB58(keypair.publicKey);

  const signature: Signature = {
    signer_public_key_b58: publicKeyB58,
    signature_b58: signatureB58,
    signed_at_ms: timestampMs,
    scheme: "ed25519",
  };

  return {
    round_type: roundType,
    message_hash: envelopeHash,
    envelope_hash: envelopeHash,
    signature,
    timestamp_ms: timestampMs,
    agent_id: agentId,
    public_key_b58: publicKeyB58,
    content_summary: contentSummary || {},
  };
}

function computeInitialHash(intentId: string, createdAtMs: number): string {
  const combined = `${intentId}:${createdAtMs}`;
  return crypto.createHash("sha256").update(combined, "utf8").digest("hex");
}

/**
 * Start a stub server that only serves /health and returns 404 for /pact.
 */
function startStubServer(port: number): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } else if (req.url === "/pact") {
        // Return 404 for /pact - simulating API mismatch
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("Not Found");
      }
    });
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  PACT-421 Provider API Mismatch Fixture Generator");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Generate deterministic keypair
  const buyerKeypair = generateDeterministicKeyPair("pact-421-buyer-seed");
  const buyerPubkeyB58 = publicKeyToB58(buyerKeypair.publicKey);
  console.log(`  Buyer pubkey: ${buyerPubkeyB58}\n`);

  // Start stub server
  console.log(`  Starting stub server on port ${STUB_PORT}...`);
  const server = await startStubServer(STUB_PORT);
  console.log(`  ✓ Stub server running (only /health, no /pact)\n`);

  try {
    // Create transcript
    let transcript = createTranscriptV4({
      intent_id: INTENT_ID,
      intent_type: INTENT_TYPE,
      created_at_ms: DETERMINISTIC_TIMESTAMP,
      policy: {
        policy_version: "pact-policy/4.0",
        policy_id: "policy-pact421-test",
        rules: [],
      },
      strategy: { strategy_id: "default", price_algo: "default" },
      identity: { buyer_pubkey: buyerPubkeyB58 },
    });

    // Create INTENT round
    const initialHash = computeInitialHash(INTENT_ID, DETERMINISTIC_TIMESTAMP);
    const intentRoundData = createSignedRound(
      "INTENT",
      "buyer",
      buyerKeypair,
      DETERMINISTIC_TIMESTAMP,
      INTENT_ID,
      { intent_type: INTENT_TYPE }
    );

    const intentRoundWithoutHash: Omit<TranscriptRound, "round_hash"> = {
      round_number: 0,
      ...intentRoundData,
      previous_round_hash: initialHash,
    };

    const roundCanonical = stableCanonicalize(intentRoundWithoutHash);
    const roundHash = crypto.createHash("sha256").update(roundCanonical, "utf8").digest("hex");

    const intentRound: TranscriptRound = {
      ...intentRoundWithoutHash,
      round_hash: roundHash,
    };

    transcript.rounds = [intentRound];

    // Attempt to contact stub server's /pact endpoint (will get 404)
    console.log(`  Contacting stub server at http://127.0.0.1:${STUB_PORT}/pact...`);
    let apiMismatchError: string | null = null;
    try {
      const response = await fetch(`http://127.0.0.1:${STUB_PORT}/pact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "INTENT" }),
      });

      if (response.status === 404) {
        apiMismatchError = `Provider API mismatch - /pact endpoint not found: ${await response.text()}`;
        console.log(`  ✓ Received 404 as expected\n`);
      } else {
        console.error(`  ❌ Expected 404, got: ${response.status}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`  ❌ Unexpected error: ${error.message}`);
      process.exit(1);
    }

    if (!apiMismatchError) {
      console.error("  ❌ Expected 404 error but got success!");
      process.exit(1);
    }

    // Add failure_event
    const transcriptUpToFailure = {
      ...transcript,
    };
    delete (transcriptUpToFailure as any).failure_event;
    delete (transcriptUpToFailure as any).final_hash;
    const transcriptHashUpToFailure = crypto
      .createHash("sha256")
      .update(stableCanonicalize(transcriptUpToFailure), "utf8")
      .digest("hex");

    transcript.failure_event = {
      code: "PACT-421",
      stage: "negotiation",
      fault_domain: "PROVIDER_AT_FAULT",
      terminality: "terminal",
      evidence_refs: [
        transcript.transcript_id,
        roundHash,
        `abort_reason:${apiMismatchError}`,
      ],
      timestamp: DETERMINISTIC_TIMESTAMP + 1000,
      transcript_hash: transcriptHashUpToFailure,
    };

    // Compute final_hash
    const finalCanonical = stableCanonicalize(transcript);
    transcript.final_hash = crypto.createHash("sha256").update(finalCanonical, "utf8").digest("hex");

    // Write to fixtures
    const fixturePath = path.join(repoRoot, "fixtures", "failures", "PACT-421-provider-api-mismatch.json");
    fs.writeFileSync(fixturePath, JSON.stringify(transcript, null, 2));
    console.log(`  📄 Fixture saved: ${fixturePath}`);

    // Verify with gc_view
    console.log("\n  Verifying with gc_view...");
    const { execSync } = await import("node:child_process");
    try {
      const result = execSync(
        `node packages/verifier/dist/cli/gc_view.js --transcript "${fixturePath}" | jq -r '.executive_summary.status'`,
        { cwd: repoRoot, encoding: "utf8" }
      );
      const status = result.trim();
      if (status === "FAILED_PROVIDER_API_MISMATCH") {
        console.log(`  ✓ Status: ${status}\n`);
      } else {
        console.error(`  ❌ Expected FAILED_PROVIDER_API_MISMATCH, got: ${status}`);
        process.exit(1);
      }
    } catch (error: any) {
      console.error(`  ❌ gc_view failed: ${error.message}`);
      process.exit(1);
    }

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ PACT-421 Fixture Generated Successfully");
    console.log("═══════════════════════════════════════════════════════════\n");
  } finally {
    // Stop stub server
    server.close();
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
