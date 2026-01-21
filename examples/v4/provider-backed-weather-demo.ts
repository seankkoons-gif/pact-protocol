#!/usr/bin/env tsx
/**
 * PACT v4 Provider-Backed Weather Demo
 * 
 * Demonstrates provider-backed acquisition using the real SDK acquire() path:
 * - Loads providers from providers.jsonl
 * - Calls local weather provider (http://127.0.0.1:3000)
 * - Uses SDK acquire() function (truth path for v4 transcripts)
 * - Saves pact-transcript/4.0 transcript to .pact/transcripts
 * 
 * Run:
 *   Terminal A: pnpm example:provider:weather
 *   Terminal B: pnpm demo:v4:provider
 */

import { 
  acquire,
  createDefaultPolicy,
  MockSettlementProvider,
  ReceiptStore,
  JsonlProviderDirectory,
  generateKeyPair,
  publicKeyToB58,
} from "@pact/sdk";
import * as path from "node:path";
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");

/**
 * Simple health check - verify provider endpoint is reachable.
 */
async function checkProviderHealth(endpoint: string): Promise<boolean> {
  try {
    const healthUrl = new URL(endpoint);
    // Try to fetch from the endpoint (any path should return something if server is up)
    const response = await fetch(`${healthUrl.origin}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000), // 3 second timeout
    });
    return response.ok || response.status === 404; // 404 is OK, server is responding
  } catch (error: any) {
    // If it's a timeout or connection error, provider is not reachable
    if (error.name === "AbortError" || error.code === "ECONNREFUSED") {
      return false;
    }
    // For other errors (like 404 on /health), assume server is up
    return true;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  PACT v4 Provider-Backed Weather Demo");
  console.log("  Institution-Grade Autonomous Commerce Infrastructure");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Load provider directory from providers.jsonl
  const providersPath = path.join(repoRoot, "providers.jsonl");
  if (!fs.existsSync(providersPath)) {
    console.error(`❌ Error: providers.jsonl not found at ${providersPath}`);
    console.error("   Run: pnpm example:provider:weather (in another terminal)");
    process.exit(1);
  }

  const directory = new JsonlProviderDirectory({ path: providersPath });
  const providers = directory.listProviders("weather.data");
  
  if (providers.length === 0) {
    console.error("❌ Error: No providers found for intentType 'weather.data'");
    console.error(`   Check ${providersPath} for provider entries`);
    process.exit(1);
  }

  // Pick first provider (typically the weather provider)
  const provider = providers[0];
  console.log("📋 Setup:");
  console.log(`   ✓ Provider ID: ${provider.provider_id}`);
  console.log(`   ✓ Endpoint: ${provider.endpoint}`);
  console.log(`   ✓ Intent Type: ${provider.intentType}\n`);

  // Check provider health (warning only - let acquire() handle failures to produce v4 transcript)
  console.log("🔍 Checking provider health...");
  const isHealthy = await checkProviderHealth(provider.endpoint);
  if (!isHealthy) {
    console.log(`   ⚠️  Warning: Provider may not be reachable at ${provider.endpoint}`);
    console.log("   Will attempt acquisition anyway (will produce v4 transcript with failure evidence)");
    console.log("   Start provider with: pnpm example:provider:weather (in another terminal)\n");
  } else {
    console.log("   ✓ Provider is reachable\n");
  }

  // Generate keypair for buyer
  const buyerKeyPair = generateKeyPair();
  const buyerId = publicKeyToB58(buyerKeyPair.publicKey);
  
  // For HTTP providers, we don't need the seller's secret key (provider signs its own messages)
  // But acquire() still requires a sellerKeyPair parameter - we'll generate a dummy one
  // The actual seller ID used will be the provider's pubkey_b58 (set below)
  const sellerKeyPair = generateKeyPair();
  
  // Use provider's pubkey_b58 as seller ID (this is what acquire() will use internally)
  const sellerId = provider.pubkey_b58;

  // Create policy with max price constraint
  const policy = createDefaultPolicy();
  policy.price = {
    max_price: 0.05,
    max_total_spend: 100.0,
  };

  // Set up settlement provider (mock in-memory)
  const settlement = new MockSettlementProvider();
  settlement.credit(buyerId, 1.0);
  settlement.credit(sellerId, 0.1);

  // Set up receipt store
  const store = new ReceiptStore();

  // Ensure transcript directory exists
  const transcriptDir = path.join(repoRoot, ".pact", "transcripts");
  if (!fs.existsSync(transcriptDir)) {
    fs.mkdirSync(transcriptDir, { recursive: true });
  }

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  🔄 Negotiation Starting...");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log("  Intent: weather.data (NYC)");
  console.log("  Max price: $0.05 (enforced by Policy)");
  console.log("  Settlement: mock (in-memory)");
  console.log("  Provider: HTTP endpoint\n");

  // Run acquisition with provider directory
  const result = await acquire({
    input: {
      intentType: "weather.data",
      scope: "NYC",
      constraints: { latency_ms: 50, freshness_sec: 10 },
      maxPrice: 0.05,
      saveTranscript: true,
      transcriptDir,
    },
    buyerKeyPair,
    sellerKeyPair,
    buyerId,
    sellerId,
    policy,
    settlement,
    store,
    directory, // Provider directory for discovery
  });

  // Print results
  console.log("═══════════════════════════════════════════════════════════");
  if (result.ok) {
    console.log("  ✅ Negotiation Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  📊 Result:");
    console.log(`     Outcome: ✅ Success`);
    console.log(`     Agreed Price: $${result.receipt.agreed_price}`);
    console.log(`     Settlement: ${result.plan.settlement}`);
    console.log(`     Regime: ${result.plan.regime}`);
    console.log(`     Selected Provider: ${result.plan.selected_provider_id || sellerId}\n`);

    // Load and verify transcript
    if (result.transcriptPath) {
      const transcriptContent = fs.readFileSync(result.transcriptPath, "utf-8");
      const transcript = JSON.parse(transcriptContent);
      const absolutePath = path.resolve(result.transcriptPath);
      
      console.log("  📄 Transcript:");
      console.log(`     Transcript Version: ${transcript.transcript_version || "N/A"}`);
      console.log(`     Transcript ID: ${transcript.transcript_id || "N/A"}`);
      console.log(`     Rounds: ${transcript.rounds?.length || 0}`);
      
      // Verify transcript is v4 format
      if (transcript.transcript_version === "pact-transcript/4.0") {
        console.log("     ✓ Transcript is v4 format\n");
        console.log("✅ Transcript saved:", absolutePath);
        
        // Check for provider_discovery/provider_evaluation evidence
        const hasDiscoveryEvidence = transcript.evidence?.some((e: any) => 
          e.phase === "provider_discovery" || e.evidence_type === "provider_discovery"
        );
        const hasEvaluationEvidence = transcript.evidence?.some((e: any) => 
          e.phase === "provider_evaluation" || e.evidence_type === "provider_evaluation"
        );
        
        if (hasDiscoveryEvidence || hasEvaluationEvidence) {
          console.log("     ✓ Provider discovery/evaluation evidence found in transcript\n");
        }
      } else {
        console.log(`     ⚠️  Warning: Transcript version is ${transcript.transcript_version}, expected pact-transcript/4.0\n`);
        console.log("✅ Transcript saved:", absolutePath);
      }
    } else {
      console.log("     ⚠️  Warning: No transcript path returned\n");
    }

    console.log("═══════════════════════════════════════════════════════════");
    console.log("  🎉 Demo Complete!");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  Next steps:");
    if (result.transcriptPath) {
      const absolutePath = path.resolve(result.transcriptPath);
      console.log(`    • Judge: pnpm judge:v4 ${absolutePath}`);
      console.log(`    • Replay: pnpm replay:v4 ${absolutePath}`);
      console.log(`    • Evidence bundle: pnpm evidence:bundle ${absolutePath}\n`);
    }

    process.exit(0);
  } else {
    console.log("  ❌ Negotiation Failed");
    console.log("═══════════════════════════════════════════════════════════\n");
    console.log("  📊 Failure:");
    console.log(`     Code: ${result.code}`);
    console.log(`     Reason: ${result.reason}\n`);

    // Load and verify transcript on failure
    if (result.transcriptPath) {
      const absolutePath = path.resolve(result.transcriptPath);
      
      try {
        const transcriptContent = fs.readFileSync(result.transcriptPath, "utf-8");
        const transcript = JSON.parse(transcriptContent);
        
        console.log("  📄 Transcript saved (includes failure event):");
        console.log(`     Transcript Version: ${transcript.transcript_version || "N/A"}`);
        console.log(`     Transcript ID: ${transcript.transcript_id || "N/A"}`);
        
        // Verify transcript is v4 format
        if (transcript.transcript_version === "pact-transcript/4.0") {
          console.log("     ✓ Transcript is v4 format");
          
          // Check for provider_discovery/provider_evaluation evidence
          const discoveryEvidence = transcript.evidence?.filter((e: any) => 
            e.phase === "provider_discovery" || e.evidence_type === "provider_discovery"
          ) || [];
          const evaluationEvidence = transcript.evidence?.filter((e: any) => 
            e.phase === "provider_evaluation" || e.evidence_type === "provider_evaluation"
          ) || [];
          
          if (discoveryEvidence.length > 0) {
            console.log(`     ✓ Provider discovery evidence found (${discoveryEvidence.length} entries)`);
          }
          if (evaluationEvidence.length > 0) {
            console.log(`     ✓ Provider evaluation evidence found (${evaluationEvidence.length} entries)`);
          }
        }
        
        console.log("");
        console.log("✅ Transcript saved:", absolutePath);
        console.log("");
        
        // Show next steps even on failure
        console.log("  Next steps:");
        console.log(`    • Judge: pnpm judge:v4 ${absolutePath}`);
        console.log(`    • Replay: pnpm replay:v4 ${absolutePath}`);
        console.log(`    • Evidence bundle: pnpm evidence:bundle ${absolutePath}\n`);
      } catch (error) {
        // If transcript read fails, still print path
        console.log("  📄 Transcript saved (includes failure event):");
        console.log("✅ Transcript saved:", absolutePath);
        console.log("");
      }
    } else {
      console.log("  ⚠️  Warning: No transcript path returned (transcript may not have been saved)\n");
    }

    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
