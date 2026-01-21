#!/usr/bin/env tsx
/**
 * Example: Weather API Agent (Real-World Use Case)
 * 
 * This example demonstrates a real-world scenario where a buyer agent negotiates
 * with multiple weather data providers to get the best price for specific constraints.
 * 
 * Real-World Scenario:
 * - Buyer: Autonomous agent needs weather data for NYC with strict latency/freshness
 * - Multiple Providers: Various weather APIs with different pricing and capabilities
 * - Negotiation: Buyer negotiates price based on constraints (latency, freshness, trust)
 * - Selection: PACT selects the best provider based on policy (price, trust, constraints)
 * 
 * Key Features:
 * - Multiple providers with different pricing strategies
 * - Constraint-based negotiation (latency, freshness, trust requirements)
 * - Provider selection based on policy (min reputation, max failure rate)
 * - Transcript shows why each provider was selected/rejected
 * - Settlement coordinates payment (mock settlement for demo)
 * 
 * This demonstrates how PACT enables real-world agent-to-agent negotiation
 * for data services with verifiable, explainable outcomes.
 */

import {
  acquire,
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

// Simulate multiple weather data providers with different characteristics
const WEATHER_PROVIDERS = [
  {
    id: "weather-api-premium",
    name: "Premium Weather API",
    baseline_latency_ms: 20,
    baseline_price: 0.00015, // Higher price, better service
    credentials: ["sla_verified", "high_uptime"],
  },
  {
    id: "weather-api-standard",
    name: "Standard Weather API",
    baseline_latency_ms: 45,
    baseline_price: 0.0001, // Standard price
    credentials: ["sla_verified"],
  },
  {
    id: "weather-api-budget",
    name: "Budget Weather API",
    baseline_latency_ms: 80,
    baseline_price: 0.00005, // Lower price, slower service
    credentials: [],
  },
];

async function main() {
  console.log("=== PACT Example: Weather API Agent (Real-World Use Case) ===\n");
  console.log("Scenario: Autonomous agent negotiates weather data prices with multiple providers\n");

  // Generate keypairs
  const buyerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);

  // Create multiple provider servers and keypairs
  const providers = WEATHER_PROVIDERS.map((providerConfig) => {
    const sellerKeyPair = generateKeyPair();
    const sellerId = publicKeyToB58(sellerKeyPair.publicKey);
    return {
      ...providerConfig,
      sellerKeyPair,
      sellerId,
    };
  });

  const servers = providers.map((provider) =>
    startProviderServer({
      port: 0,
      sellerKeyPair: provider.sellerKeyPair,
      sellerId: provider.sellerId,
    })
  );

  try {
    // Create provider directory and register all providers
    const directory = new InMemoryProviderDirectory();
    providers.forEach((provider, idx) => {
      directory.registerProvider({
        provider_id: provider.sellerId,
        intentType: "weather.data",
        pubkey_b58: provider.sellerId,
        endpoint: servers[idx].url,
        credentials: provider.credentials as string[],
        baseline_latency_ms: provider.baseline_latency_ms,
      });
    });

    console.log(`✅ Registered ${providers.length} weather data providers:\n`);
    providers.forEach((provider, idx) => {
      console.log(`  ${idx + 1}. ${provider.name}`);
      console.log(`     ID: ${provider.id}`);
      console.log(`     Latency: ${provider.baseline_latency_ms}ms`);
      console.log(`     Base Price: $${provider.baseline_price.toFixed(6)}`);
      console.log(`     Credentials: ${provider.credentials.join(", ") || "none"}\n`);
    });

    // Create receipt store with history for multiple providers
    const store = new ReceiptStore();
    
    // Add historical receipts for provider selection (some have good history, some don't)
    providers.forEach((provider, idx) => {
      // Premium provider: 20 successful transactions
      if (idx === 0) {
        for (let i = 0; i < 20; i++) {
          store.ingest({
            receipt_id: `receipt-${provider.id}-${i}`,
            intent_id: `intent-${i}`,
            intent_type: "weather.data",
            buyer_agent_id: buyerId,
            seller_agent_id: provider.sellerId,
            agreed_price: provider.baseline_price,
            fulfilled: true,
            timestamp_ms: Date.now() - (20 - i) * 3600000, // 1 hour intervals
          });
        }
      }
      // Standard provider: 10 successful transactions
      else if (idx === 1) {
        for (let i = 0; i < 10; i++) {
          store.ingest({
            receipt_id: `receipt-${provider.id}-${i}`,
            intent_id: `intent-${i}`,
            intent_type: "weather.data",
            buyer_agent_id: buyerId,
            seller_agent_id: provider.sellerId,
            agreed_price: provider.baseline_price,
            fulfilled: true,
            timestamp_ms: Date.now() - (10 - i) * 3600000,
          });
        }
      }
      // Budget provider: 3 successful transactions (lower trust)
      else {
        for (let i = 0; i < 3; i++) {
          store.ingest({
            receipt_id: `receipt-${provider.id}-${i}`,
            intent_id: `intent-${i}`,
            intent_type: "weather.data",
            buyer_agent_id: buyerId,
            seller_agent_id: provider.sellerId,
            agreed_price: provider.baseline_price,
            fulfilled: true,
            timestamp_ms: Date.now() - (3 - i) * 3600000,
          });
        }
      }
    });

    // Create settlement provider
    const settlement = new MockSettlementProvider();
    settlement.credit(buyerId, 1.0); // Buyer has $1.00
    providers.forEach((provider) => {
      settlement.credit(provider.sellerId, 0.1); // Each provider has $0.10
    });

    // Create policy with strict requirements for weather data
    const policy = createDefaultPolicy();
    policy.counterparty.min_reputation = 0.5; // Require some reputation
    policy.counterparty.require_credentials = ["sla_verified"]; // Require SLA verification
    policy.counterparty.max_failure_rate = 0.1; // Max 10% failure rate
    policy.sla.max_latency_ms = 50; // Must be < 50ms latency
    policy.sla.max_freshness_sec = 10; // Must be < 10s freshness
    policy.economics.reference_price.use_receipt_history = true; // Use historical pricing

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

    // Run acquisition with strict requirements
    console.log("🔍 Buyer requirements:");
    console.log("  Intent: weather.data (NYC)");
    console.log("  Max price: $0.0002");
    console.log("  Latency: < 50ms");
    console.log("  Freshness: < 10s");
    console.log("  Min reputation: 0.5");
    console.log("  Required credentials: sla_verified\n");

    const result = await acquire({
      input: {
        intentType: "weather.data",
        scope: "NYC",
        constraints: {
          latency_ms: 50,
          freshness_sec: 10,
        },
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
      },
      buyerKeyPair,
      sellerKeyPair: providers[0].sellerKeyPair, // Use first provider's keypair for server
      buyerId,
      sellerId: providers[0].sellerId,
      policy: validated.policy,
      settlement,
      store,
      directory,
      sellerKeyPairsByPubkeyB58: Object.fromEntries(
        providers.map((p) => [p.sellerId, p.sellerKeyPair])
      ),
      nowFn: () => Date.now(),
    });

    // Display results
    if (result.ok && result.receipt) {
      console.log("✅ Negotiation successful!\n");
      console.log(`📊 Selected Provider: ${providers.find((p) => p.sellerId === result.receipt?.seller_agent_id)?.name || "Unknown"}`);
      console.log(`💰 Agreed Price: $${result.receipt.agreed_price.toFixed(8)}`);
      console.log(`✅ Fulfilled: ${result.receipt.fulfilled ? "Yes" : "No"}\n`);

      if (result.transcriptPath && fs.existsSync(result.transcriptPath)) {
        const transcript = JSON.parse(fs.readFileSync(result.transcript_path!, "utf-8"));

        // Show provider selection decisions
        if (transcript.explain?.decisions) {
          console.log("📋 Provider Selection Decisions:\n");
          transcript.explain.decisions.forEach((decision: any) => {
            const provider = providers.find((p) => p.sellerId === decision.provider_id);
            const status = decision.code === "ACCEPTED" ? "✅ SELECTED" : "❌ REJECTED";
            console.log(`  ${status}: ${provider?.name || decision.provider_id}`);
            console.log(`    Reason: ${decision.reason || decision.code}\n`);
          });
        }

        // Show negotiation rounds
        if (transcript.negotiation_rounds && transcript.negotiation_rounds.length > 0) {
          console.log("📊 Negotiation Rounds:\n");
          transcript.negotiation_rounds.forEach((round: any) => {
            console.log(`  Round ${round.round}:`);
            console.log(`    Ask: $${round.ask_price?.toFixed(8) || "N/A"}`);
            console.log(`    Counter: $${round.counter_price?.toFixed(8) || "N/A"}`);
            console.log(`    Accepted: ${round.accepted ? "Yes" : "No"}\n`);
          });
        }

        console.log(`📄 Full transcript: ${result.transcript_path}`);
      }
    } else {
      console.log("❌ Negotiation failed:");
      console.log(`   Code: ${result.code}`);
      console.log(`   Reason: ${result.reason}`);
      
      if (result.transcriptPath && fs.existsSync(result.transcriptPath)) {
        const transcript = JSON.parse(fs.readFileSync(result.transcriptPath, "utf-8"));
        
        // Show why providers were rejected
        if (transcript.explain?.decisions) {
          console.log("\n📋 Provider Rejection Reasons:\n");
          transcript.explain.decisions.forEach((decision: any) => {
            const provider = providers.find((p) => p.sellerId === decision.provider_id);
            console.log(`  ${provider?.name || decision.provider_id}: ${decision.reason || decision.code}\n`);
          });
        }
      }
    }

  } finally {
    // Clean up all servers
    await Promise.all(servers.map((server) => server.close()));
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
