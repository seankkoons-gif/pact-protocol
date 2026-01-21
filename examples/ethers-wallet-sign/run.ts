#!/usr/bin/env tsx
/**
 * Example: Ethers Wallet Signing
 * 
 * Demonstrates using EthersWalletAdapter with acquire() and WalletAction signing.
 * Shows wallet creation, WalletAction signing, and transcript recording with signature metadata.
 * 
 * This example uses a deterministic private key for testing purposes.
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
  console.log("=== PACT Example: Ethers Wallet Signing ===\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const sellerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  const sellerId = publicKeyToB58(sellerKeyPair.publicKey);

  // Create Ethers wallet adapter with a deterministic private key for testing
  // WARNING: This is a development key - never use in production!
  const devPrivateKey = "0x59c6995e998f97a5a0044976f094538c5f4f7e2f3c0d6b5e0c3e2d1b1a0f0001";
  const wallet = await EthersWalletAdapter.create(devPrivateKey);

  // Get wallet address and capabilities
  const addressInfo = await wallet.getAddress();
  const capabilities = wallet.capabilities();
  console.log(`Wallet Chain: ${addressInfo.chain}`);
  console.log(`Wallet Address: ${addressInfo.value}`);
  console.log(`Capabilities:`, JSON.stringify(capabilities, null, 2));
  console.log();

  // Sign a WalletAction deterministically
  const walletAction = {
    action: "authorize" as const,
    asset_symbol: "USDC",
    amount: 0.0001,
    from: addressInfo.value,
    to: sellerId, // Will be set to actual seller after acquisition
    memo: "PACT acquisition authorization",
    idempotency_key: "test-example-001",
  };

  console.log("Signing WalletAction:");
  console.log(JSON.stringify(walletAction, null, 2));
  console.log();

  const signature = await wallet.sign(walletAction);
  console.log(`✅ WalletAction signed successfully`);
  console.log(`Signature scheme: ${signature.scheme}`);
  console.log(`Payload hash: ${signature.payload_hash}`);
  console.log(`Signature (hex): ${signature.signer}`);
  console.log();

  // Verify the signature
  const isValid = wallet.verify(signature, walletAction);
  console.log(`Signature verification: ${isValid ? "✅ Valid" : "❌ Invalid"}\n`);

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

  // Run acquisition with Ethers wallet injected and signing enabled
  console.log("Running acquisition with Ethers wallet and WalletAction signing...\n");
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
        requires_signature: true, // Enable wallet signing
        signature_action: {
          action: "authorize",
          asset_symbol: "USDC",
          memo: "PACT acquisition authorization",
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

    // Print wallet info
    console.log(`Wallet Chain: ${addressInfo.chain}`);
    console.log(`Wallet Address: ${addressInfo.value}`);
    console.log(`Capabilities:`, JSON.stringify(capabilities, null, 2));

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
        
        // Highlight signature metadata
        if (transcript.wallet.signature_metadata) {
          console.log("\n✅ Wallet signature metadata recorded:");
          console.log(`  Chain: ${transcript.wallet.signature_metadata.chain}`);
          console.log(`  Scheme: ${transcript.wallet.signature_metadata.scheme}`);
          console.log(`  Signer: ${transcript.wallet.signature_metadata.signer}`);
          console.log(`  Payload Hash: ${transcript.wallet.signature_metadata.payload_hash}`);
          console.log(`  Signature (hex): ${transcript.wallet.signature_metadata.signature_hex.substring(0, 20)}...`);
        }
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



