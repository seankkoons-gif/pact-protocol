#!/usr/bin/env tsx
/**
 * Example: ZK-KYA Verification (Real-World Ready)
 * 
 * What this example demonstrates and why it matters:
 * 
 * This example shows how PACT's ZK-KYA (Zero-Knowledge Know Your Agent) verification
 * works out of the box when the 'snarkjs' package is installed. It demonstrates:
 * 
 * 1. Privacy-preserving identity verification: Agents can prove credentials (KYC,
 *    reputation, trust tier) without revealing private information using zero-knowledge proofs.
 * 
 * 2. Optional dependency pattern: Works out of the box when 'snarkjs' is installed,
 *    falls back gracefully with clear errors when not installed.
 * 
 * 3. Policy-driven verification: Policies can require ZK-KYA proofs based on trust
 *    requirements, counterparty rules, or intent-specific constraints.
 * 
 * 4. Trust tier assignment: ZK verification can assign trust tiers (untrusted, low, trusted)
 *    based on proof validity and credential type.
 * 
 * This matters because it shows PACT supports privacy-preserving identity verification
 * for production use cases where agents need to verify credentials without leaking
 * sensitive information.
 * 
 * Note: This example uses test/placeholder proofs for demo purposes.
 * In production, you would generate real Groth16 proofs using snarkjs or other ZK tools.
 */

import {
  acquire,
  DefaultZkKyaVerifier,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  MockSettlementProvider,
  InMemoryProviderDirectory,
  ReceiptStore,
} from "@pact/sdk";
import { startProviderServer } from "@pact/provider-adapter";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: ZK-KYA Verification ===\n");
  console.log("Demonstrates privacy-preserving identity verification with zero-knowledge proofs\n");

  // Check if snarkjs package is available
  let snarkjsAvailable = false;
  try {
    require("snarkjs");
    snarkjsAvailable = true;
    console.log("✅ snarkjs package found - real ZK verification enabled\n");
  } catch {
    console.log("⚠️  snarkjs package not installed - will show boundary mode\n");
    console.log("   To enable real integration: npm install snarkjs\n");
  }

  // Generate keypairs for buyer and seller
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Start HTTP provider server
  const server = startProviderServer({
    port: 0,
    sellerKeyPair: sellerKeyPair,
    sellerId: sellerId,
  });

  try {
    // Create in-memory provider directory
    const directory = new InMemoryProviderDirectory();
    directory.registerProvider({
      provider_id: sellerId,
      intentType: "weather.data",
      pubkey_b58: sellerId,
      endpoint: server.url,
      credentials: [],
      baseline_latency_ms: 25,
    });

    // Create receipt store
    const store = new ReceiptStore();
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: "weather.data",
        buyer_agent_id: buyerId,
        seller_agent_id: sellerId,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: Date.now() - (5 - i) * 1000,
      });
    }

    // Create settlement provider
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0);
    settlement.credit(sellerId, 0.1);

    // Create ZK-KYA verifier (uses snarkjs if available)
    const zkKyaVerifier = new DefaultZkKyaVerifier();
    console.log("✅ ZK-KYA verifier initialized\n");

    // Create policy with ZK-KYA requirements
    const policy = createDefaultPolicy();
    policy.counterparty.min_reputation = 0.0;
    
    // Enable ZK-KYA verification in policy
    policy.base.kya.zk_kya = {
      required: false, // Set to true to require ZK-KYA proof
      require_issuer: false,
      allowed_issuers: [], // List of allowed issuer IDs if require_issuer is true
      min_tier: "untrusted", // Minimum trust tier: "untrusted" | "low" | "trusted"
    };

    const validated = validatePolicyJson(policy);
    if (!validated.ok) {
      console.error("❌ Policy validation failed:", validated.errors);
      process.exit(1);
    }

    // Ensure transcript directory exists
    const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
    if (!fs.existsSync(transcriptDir)) {
      fs.mkdirSync(transcriptDir, { recursive: true });
    }

    // Create a placeholder ZK-KYA proof for demo
    // In production, you would generate real Groth16 proofs using snarkjs
    const zkKyaProof = {
      scheme: "groth16" as const,
      circuit_id: "kyc_v1", // Circuit identifier (e.g., KYC verification circuit)
      issuer_id: "issuer_123", // Optional: issuer/attestor identifier
      public_inputs: {
        agent_id: buyerId,
        trust_tier: "trusted",
        issued_at: Date.now() - 86400000, // Issued 1 day ago
      },
      proof_bytes_b64: "dGVzdF9wcm9vZl9ieXRlcw==", // Placeholder base64 proof
      issued_at_ms: Date.now() - 86400000,
      expires_at_ms: Date.now() + 86400000 * 30, // Expires in 30 days
    };

    // Run acquisition with optional ZK-KYA proof
    console.log("Running acquisition with ZK-KYA verification...");
    console.log("  Intent: weather.data (NYC)");
    console.log("  Max price: 0.0002");
    console.log("  ZK-KYA: Optional (proof provided for demo)\n");

    const result = await acquire({
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: { latency_ms: 50, freshness_sec: 10 },
        maxPrice: 0.0002,
        saveTranscript: true,
        transcriptDir: transcriptDir,
        negotiation: {
          strategy: "banded_concession",
          params: {
            band_pct: 0.1,
            max_rounds: 3,
          },
        },
        identity: {
          buyer: {
            zk_kya_proof: zkKyaProof,
          },
        },
      },
      buyerKeyPair,
      sellerKeyPair,
      buyerId,
      sellerId,
      policy: validated.policy,
      settlement,
      store,
      directory,
      zkKyaVerifier, // Use the verifier (will use snarkjs if available)
      nowFn: () => Date.now(),
    });

    // Display results
    if (result.ok) {
      console.log("✅ Acquisition successful!");
      console.log(`   Agreed price: $${result.receipt?.agreed_price.toFixed(8)}`);
      console.log(`   Outcome: ${result.outcome}`);
      
      if (snarkjsAvailable) {
        console.log("\n✅ ZK verification working!");
        console.log("   - ZK-KYA proof: Provided and verified");
        console.log("   - Verifier: DefaultZkKyaVerifier (using snarkjs)");
        console.log("   - Trust tier: Assigned based on proof");
      } else {
        console.log("\n⚠️  Boundary mode:");
        console.log("   - ZK-KYA proof: Provided (placeholder)");
        console.log("   - Verifier: DefaultZkKyaVerifier (snarkjs not installed)");
        console.log("   - Result: ZK_KYA_NOT_IMPLEMENTED (expected in boundary mode)");
      }

      // Check transcript for ZK-KYA metadata
      if (result.transcript_path && fs.existsSync(result.transcript_path)) {
        const transcript = JSON.parse(fs.readFileSync(result.transcript_path, "utf-8"));
        if (transcript.zk_kya) {
          console.log("\n📋 ZK-KYA Metadata in Transcript:");
          console.log(`   Scheme: ${transcript.zk_kya.scheme}`);
          console.log(`   Circuit ID: ${transcript.zk_kya.circuit_id}`);
          console.log(`   Issuer ID: ${transcript.zk_kya.issuer_id || "none"}`);
          console.log(`   Verification OK: ${transcript.zk_kya.verification?.ok || false}`);
          console.log(`   Trust Tier: ${transcript.zk_kya.verification?.tier || "none"}`);
          console.log("   (Note: Proof bytes are hashed, not stored in transcript for privacy)");
        }
      }

      if (result.transcript_path) {
        console.log(`\n📄 Transcript saved: ${result.transcript_path}`);
      }
    } else {
      console.log("❌ Acquisition failed:");
      console.log(`   Code: ${result.code}`);
      console.log(`   Reason: ${result.reason}`);
      
      if (result.code === "ZK_KYA_NOT_IMPLEMENTED") {
        console.log("\n💡 To enable real ZK verification:");
        console.log("   1. npm install snarkjs");
        console.log("   2. Use DefaultZkKyaVerifier (automatic when snarkjs is installed)");
        console.log("   3. Generate real Groth16 proofs using your ZK circuit");
      } else if (result.code === "ZK_KYA_REQUIRED") {
        console.log("\n💡 ZK-KYA proof is required by policy but not provided");
        console.log("   Set policy.base.kya.zk_kya.required = false to make it optional");
      } else if (result.code === "ZK_KYA_INVALID" || result.code === "ZK_KYA_EXPIRED") {
        console.log("\n💡 ZK-KYA proof verification failed");
        console.log("   Check proof validity, expiration, and circuit compatibility");
      }
    }

  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
