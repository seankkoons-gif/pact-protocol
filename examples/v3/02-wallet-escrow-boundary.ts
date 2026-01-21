#!/usr/bin/env tsx
/**
 * Example: Wallet Escrow Boundary
 * 
 * What this example demonstrates and why it matters:
 * 
 * This example shows the execution boundary between PACT (negotiation protocol) and
 * external execution systems (wallets, escrow contracts). It demonstrates:
 * 
 * 1. Wallet usage: PACT uses wallets to sign intents and provide proofs, but does NOT
 *    custody assets or manage keys. Wallets are external boundaries.
 * 
 * 2. Escrow as external boundary: Escrow (locking funds until conditions are met) is
 *    NOT part of PACT. It's implemented by external smart contracts or services.
 *    PACT only provides the intent and proof that conditions are met.
 * 
 * 3. Execution boundary separation: PACT negotiates terms and coordinates settlement.
 *    Execution (escrow, payment, delivery) happens outside PACT through pluggable
 *    interfaces. This keeps PACT chain-agnostic and execution-backend-agnostic.
 * 
 * This matters because it shows PACT is a protocol layer, not an execution layer.
 * Integrators choose their execution backends (on-chain escrow, payment processors,
 * custom services) while PACT provides the negotiation and coordination logic.
 */

import {
  acquire,
  EthersWallet,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  MockSettlementProvider,
  ReceiptStore,
  InMemoryProviderDirectory,
  publicKeyToB58,
} from "@pact/sdk";
import { startProviderServer } from "@pact/provider-adapter";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

// ============================================================================
// EXECUTION BOUNDARY: EscrowClient is NOT part of PACT
// ============================================================================
// This interface represents an external escrow service (on-chain smart contract,
// payment processor, custom service). PACT does NOT implement this.
// 
// PACT only provides: Intent (what to transact) + Proof (that conditions are met)
// Execution (locking/releasing funds) is the integrator's responsibility.
// ============================================================================

interface EscrowClient {
  // In production: Calls smart contract lock() or payment processor hold()
  lock(params: { buyerAddress: string; sellerAddress: string; amount: number; intentId: string; proof: string }): Promise<{ escrowId: string; txHash?: string }>;
  // In production: Calls smart contract release() or payment processor capture()
  release(params: { escrowId: string; proof: string }): Promise<{ txHash?: string }>;
  // In production: Calls smart contract refund() or payment processor refund()
  refund(params: { escrowId: string; reason: string }): Promise<{ txHash?: string }>;
}

// Mock implementation (in production: Web3.js/Ethers.js calls to smart contracts or REST API calls)

class MockEscrowClient implements EscrowClient {
  private escrows = new Map<string, { buyerAddress: string; sellerAddress: string; amount: number; intentId: string }>();

  async lock(params: { buyerAddress: string; sellerAddress: string; amount: number; intentId: string; proof: string }): Promise<{ escrowId: string; txHash?: string }> {
    const escrowId = `escrow-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    this.escrows.set(escrowId, { buyerAddress: params.buyerAddress, sellerAddress: params.sellerAddress, amount: params.amount, intentId: params.intentId });
    console.log(`  🔒 EscrowClient.lock() - Escrow ID: ${escrowId}, Amount: ${params.amount}`);
    console.log(`     Proof: ${params.proof.substring(0, 20)}... [In production: Smart contract lock()]`);
    return { escrowId, txHash: `0x${Math.random().toString(16).substring(2)}` };
  }

  async release(params: { escrowId: string; proof: string }): Promise<{ txHash?: string }> {
    if (!this.escrows.has(params.escrowId)) throw new Error(`Escrow ${params.escrowId} not found`);
    console.log(`  🔓 EscrowClient.release() - Escrow ID: ${params.escrowId}`);
    console.log(`     Proof: ${params.proof.substring(0, 20)}... [In production: Smart contract release()]`);
    this.escrows.delete(params.escrowId);
    return { txHash: `0x${Math.random().toString(16).substring(2)}` };
  }

  async refund(params: { escrowId: string; reason: string }): Promise<{ txHash?: string }> {
    if (!this.escrows.has(params.escrowId)) throw new Error(`Escrow ${params.escrowId} not found`);
    console.log(`  💰 EscrowClient.refund() - Escrow ID: ${params.escrowId}, Reason: ${params.reason}`);
    this.escrows.delete(params.escrowId);
    return { txHash: `0x${Math.random().toString(16).substring(2)}` };
  }
}

// ============================================================================
// Main Example Flow
// ============================================================================

async function main() {
  console.log("=== PACT Example: Wallet Escrow Boundary ===\n");
  console.log("Demonstrates execution boundary: PACT (negotiation) vs external (wallets, escrow)\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Create wallet adapter (external boundary - NOT part of PACT core)
  const devPrivateKey = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
  const wallet = await EthersWallet.create(devPrivateKey);
  const addressInfo = await wallet.getAddress();
  const walletAddress = addressInfo.value;
  console.log(`📱 Wallet (External): ${addressInfo.chain}:${walletAddress} [PACT uses for signing, NOT custody]\n`);

  // Create escrow client (external boundary - NOT part of PACT)
  const escrow = new MockEscrowClient();
  console.log(`🔒 EscrowClient (External): [NOT part of PACT - integrator implements]\n`);

  // Start HTTP provider server (required for negotiated regime)
  const server = startProviderServer({
    port: 0,
    sellerKeyPair: sellerKeyPair,
    sellerId: sellerId,
  });

  try {
    // Create in-memory provider directory and register a provider with HTTP endpoint
    const directory = new InMemoryProviderDirectory();
    directory.registerProvider({
      provider_id: sellerId,
      intentType: "weather.data",
      pubkey_b58: sellerId,
      endpoint: server.url,
      credentials: [],
      baseline_latency_ms: 25,
    });

    // Setup: store, settlement, policy
    const store = new ReceiptStore();
    // Add some historical receipts to trigger negotiated regime
    // (negotiated regime requires tradeCount >= 5)
    for (let i = 0; i < 5; i++) {
      store.ingest({
        receipt_id: `receipt-${i}`,
        intent_id: `intent-${i}`,
        intent_type: "weather.data",
        buyer_agent_id: buyerId,
        seller_agent_id: sellerId,
        agreed_price: 0.0001,
        fulfilled: true,
        timestamp_ms: 1000 + i * 1000, // Deterministic timestamps
      });
    }

    // Create settlement provider (in-memory, for demonstration)
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0); // Buyer has enough for maxPrice
    settlement.credit(sellerId, 0.1); // Seller has enough for bond

    // Create and validate policy
    const policy = createDefaultPolicy();
    // Lower min_reputation for example (providers with limited history)
    policy.counterparty.min_reputation = 0.0;
    const validated = validatePolicyJson(policy);
    if (!validated.ok) {
      console.error("❌ Policy validation failed:", validated.errors);
      process.exit(1);
    }

    const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
    if (!fs.existsSync(transcriptDir)) fs.mkdirSync(transcriptDir, { recursive: true });

    // Step 1: Negotiate price (PACT protocol layer)
    console.log("Step 1: Negotiate price (PACT protocol layer)");
    // Create deterministic clock (for reproducibility)
    let now = 1000;
    const nowFn = () => {
      const current = now;
      now += 100;
      return current;
    };
    const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.0002,
      saveTranscript: true,
      transcriptDir: transcriptDir,
      negotiation: { strategy: "banded_concession", params: { band_pct: 0.1, max_rounds: 3 } },
      wallet: { provider: "ethers", params: { privateKey: devPrivateKey }, requires_signature: true, signature_action: { action: "authorize", asset_symbol: "USDC", memo: "PACT authorization" } },
    },
    buyerKeyPair,
    sellerKeyPair,
    buyerId,
    sellerId,
    policy: validated.policy,
    settlement,
    store,
    directory,
    sellerKeyPairsByPubkeyB58: { [sellerId]: sellerKeyPair },
    now: nowFn,
  });

    if (!result.ok || !result.receipt) {
      console.error(`\n❌ Acquisition failed: ${result.code} - ${result.reason}`);
      if (result.transcriptPath) {
        console.error(`📄 Transcript saved to: ${result.transcriptPath}`);
      }
      process.exit(1);
    }
    console.log(`  ✅ Agreed price: ${result.receipt.agreed_price.toFixed(8)}\n`);

    // Step 2: Wallet signs intent (External boundary)
    console.log("Step 2: Wallet signs intent (External boundary)");
    if (result.transcriptPath) {
      const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
      if (transcript.wallet?.signature_metadata) {
        console.log(`  ✅ Wallet signature recorded [PACT provides proof, NOT wallet keys]\n`);
      }
    }

    // Step 3: Lock funds in escrow (External boundary - NOT part of PACT)
    console.log("Step 3: Lock funds in escrow (External boundary)");
    console.log("  [EscrowClient.lock() called by integrator, NOT by PACT]");
    const intentId = result.receipt.intent_id;
    const proof = result.transcriptPath ? `transcript:${path.basename(result.transcriptPath)}` : `receipt:${result.receipt.receipt_id}`;
    const escrowResult = await escrow.lock({
      buyerAddress: walletAddress,
      sellerAddress: sellerId,
      amount: result.receipt.agreed_price,
      intentId: intentId,
      proof: proof, // PACT provides this proof
    });
    console.log(`  ✅ Funds locked\n`);

    // Step 4: PACT completes acquisition (Protocol layer)
    console.log("Step 4: PACT completes acquisition (Protocol layer)");
    console.log(`  ✅ Receipt ID: ${result.receipt.receipt_id}, Fulfilled: ${result.receipt.fulfilled}\n`);

    // Step 5: Release funds from escrow (External boundary - NOT part of PACT)
    console.log("Step 5: Release funds from escrow (External boundary)");
    console.log("  [EscrowClient.release() called by integrator, NOT by PACT]");
    const fulfillmentProof = `receipt:${result.receipt.receipt_id}:fulfilled:${result.receipt.fulfilled}`;
    await escrow.release({ escrowId: escrowResult.escrowId, proof: fulfillmentProof });
    console.log(`  ✅ Funds released\n`);

    // Summary
    console.log("=== Summary ===");
    console.log("📊 PACT Protocol Layer: Negotiates, coordinates, provides proofs");
    console.log("🔒 External Boundaries: Wallets, escrow, payments (integrator's responsibility)");
    console.log("💡 Key Insight: PACT is protocol layer, execution is external\n");

    if (result.transcriptPath) console.log(`📄 Transcript: ${result.transcriptPath}\n`);
    process.exit(0);
  } finally {
    // Clean up: close provider server
    await server.close();
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
