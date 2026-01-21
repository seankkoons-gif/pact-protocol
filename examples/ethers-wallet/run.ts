#!/usr/bin/env tsx
/**
 * Example: Ethers Wallet
 * 
 * Demonstrates using EthersWalletAdapter with acquire().
 * Shows wallet injection, address retrieval, and transcript recording.
 * 
 * This example does NOT send transactions - signing only.
 */

import {
  acquire,
  EthersWalletAdapter,
  createDefaultPolicy,
  validatePolicyJson,
  generateKeyPair,
  publicKeyToB58,
  MockSettlementProvider,
  ReceiptStore,
  InMemoryProviderDirectory,
} from "@pact/sdk";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

async function main() {
  console.log("=== PACT Example: Ethers Wallet ===\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Create wallet adapter with a dev private key
  // WARNING: This is a development key - never use in production!
  const devPrivateKey = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
  
  // Use static factory method for ESM compatibility
  const wallet = await EthersWalletAdapter.create(devPrivateKey);

  // Get wallet address and chain (no network call - deterministic)
  const walletAddressBytes = wallet.getAddress();
  const walletChain = wallet.getChain();
  // Convert address bytes to hex string for display
  const walletAddressHex = "0x" + Array.from(walletAddressBytes)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
  console.log(`Wallet Chain: ${walletChain}`);
  console.log(`Wallet Address: ${walletAddressHex}\n`);

  // Create in-memory provider directory and register a provider
  const directory = new InMemoryProviderDirectory();
  directory.registerProvider({
    provider_id: sellerId,
    intentType: "weather.data",
    pubkey_b58: sellerId,
    region: "us-east",
    credentials: ["sla_verified"],
    baseline_latency_ms: 50,
  });

  // Create settlement provider
  const settlement = new MockSettlementProvider();
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);

  // Create receipt store
  const store = new ReceiptStore();

  // Create and validate policy
  const policy = createDefaultPolicy();
  const validated = validatePolicyJson(policy);
  if (!validated.ok) {
    console.error("❌ Policy validation failed:", validated.errors);
    process.exit(1);
  }

  // Run acquisition with wallet injected
  console.log("Running acquisition with ethers wallet...\n");
  const nowFn = () => Date.now();
  const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.0001,
      saveTranscript: true,
      transcriptDir: path.join(repoRoot, ".pact", "transcripts"),
      wallet: {
        provider: "ethers",
        params: {
          privateKey: devPrivateKey,
        },
      },
    },
    buyerKeyPair: buyerKeyPair,
    sellerKeyPair: sellerKeyPair,
    buyerId: buyerId,
    sellerId: sellerId,
    policy: validated.policy,
    settlement,
    store,
    directory,
    sellerKeyPairsByPubkeyB58: {
      [sellerId]: sellerKeyPair,
    },
    now: nowFn,
  });

  // Print results
  if (result.ok && result.receipt) {
    console.log("✅ Acquisition successful!\n");

    // Print wallet address
    console.log(`Wallet Chain: ${walletChain}`);
    console.log(`Wallet Address: ${walletAddressHex}`);

    // Print receipt
    console.log("\nReceipt:");
    console.log(JSON.stringify(result.receipt, null, 2));

    // Print transcript path
    if (result.transcriptPath) {
      console.log(`\n📄 Transcript: ${result.transcriptPath}`);
      
      // Show wallet metadata from transcript
      const fs = await import("fs");
      const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
      if (transcript.wallet) {
        console.log("\nWallet metadata in transcript:");
        console.log(JSON.stringify(transcript.wallet, null, 2));
      }
    }

    // Show balances
    const buyerBalance = settlement.getBalance(buyerId);
    const sellerBalance = settlement.getBalance(sellerId);
    console.log(`\n💰 Balances:`);
    console.log(`  Buyer:  ${buyerBalance.toFixed(8)}`);
    console.log(`  Seller: ${sellerBalance.toFixed(8)}`);

    console.log("\n=== Example Complete ===");
    process.exit(0);
  } else {
    console.error("\n❌ Acquisition failed!");
    console.error(`Code: ${result.code}`);
    console.error(`Reason: ${result.reason}`);
    
    if (result.transcriptPath) {
      console.error(`\n📄 Transcript: ${result.transcriptPath}`);
    }
    
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});

