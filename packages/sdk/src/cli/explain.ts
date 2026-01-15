#!/usr/bin/env tsx
/**
 * PACT Explain CLI
 * 
 * Prints human-readable explanation of a transcript's decision-making process.
 * 
 * Usage:
 *   pnpm pact explain <transcript.json>
 *   tsx packages/sdk/src/cli/explain.ts <transcript.json>
 * 
 * This command:
 * - Never mutates state (read-only)
 * - Only reads transcript file
 * - Prints human-readable output
 * - Produces deterministic output (same transcript → same output)
 */

import * as fs from "fs";
import * as path from "path";
import type { AcquireExplain, ProviderDecision } from "../client/explain";

function formatTimestamp(ms?: number): string {
  if (!ms) return "N/A";
  return new Date(ms).toISOString();
}

function formatDecision(decision: ProviderDecision, index: number): void {
  const status = decision.ok ? "✅" : "❌";
  const providerShort = decision.provider_id ? decision.provider_id.substring(0, 8) + "..." : decision.pubkey_b58.substring(0, 8) + "...";
  
  console.log(`  ${index + 1}. ${status} ${providerShort} [${decision.step}]`);
  console.log(`     Code: ${decision.code}`);
  console.log(`     Reason: ${decision.reason}`);
  if (decision.ts_ms) {
    console.log(`     Timestamp: ${formatTimestamp(decision.ts_ms)}`);
  }
  if (decision.meta && Object.keys(decision.meta).length > 0) {
    console.log(`     Meta: ${JSON.stringify(decision.meta, null, 2).split("\n").join("\n     ")}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error("Usage: pact explain <transcript.json>");
    console.error("");
    console.error("Examples:");
    console.error("  pact explain .pact/transcripts/intent-123.json");
    console.error("  pact explain transcript.json");
    console.error("");
    console.error("This command prints the decision log from the transcript's explain field.");
    process.exit(1);
  }
  
  const transcriptPath = args[0];
  
  // Validate file exists
  if (!fs.existsSync(transcriptPath)) {
    console.error(`Error: File not found: ${transcriptPath}`);
    console.error(`Hint: Use an absolute path or a path relative to the current directory.`);
    process.exit(1);
  }
  
  // Validate file is JSON
  if (!transcriptPath.endsWith(".json")) {
    console.error(`Error: File must be a .json file: ${transcriptPath}`);
    console.error(`Hint: Transcript files must have .json extension.`);
    process.exit(1);
  }
  
  // Load transcript
  let transcript: any;
  try {
    const content = fs.readFileSync(transcriptPath, "utf-8");
    transcript = JSON.parse(content);
  } catch (error: any) {
    if (error.code === "ENOENT") {
      console.error(`Error: File not found: ${transcriptPath}`);
    } else if (error instanceof SyntaxError) {
      console.error(`Error: Invalid JSON in transcript file: ${transcriptPath}`);
      console.error(`Details: ${error.message}`);
    } else {
      console.error(`Error: Failed to load transcript: ${error.message}`);
    }
    process.exit(1);
  }
  
  // Validate transcript structure
  if (!transcript.intent_id || !transcript.intent_type) {
    console.error(`Error: Invalid transcript format: missing required fields (intent_id, intent_type)`);
    console.error(`Hint: Ensure the file is a valid PACT transcript JSON file.`);
    process.exit(1);
  }
  
  console.log("=== PACT Transcript Explanation ===\n");
  console.log(`File: ${path.resolve(transcriptPath)}\n`);
  
  // Check if explain field exists
  if (!transcript.explain) {
    console.error("Error: Transcript does not contain explain field.");
    console.error("");
    console.error("Hint: Run acquire() with explain: 'coarse' or explain: 'full' to generate explanations.");
    console.error("Example:");
    console.error("  const result = await acquire({");
    console.error("    input: {");
    console.error("      // ... other input fields");
    console.error("      explain: 'coarse',  // or 'full' for detailed explanations");
    console.error("    },");
    console.error("    // ... other params");
    console.error("  });");
    process.exit(1);
  }
  
  const explain: AcquireExplain = transcript.explain;
  
  // Summary
  console.log("Summary:");
  console.log(`  Intent Type: ${explain.intentType}`);
  console.log(`  Settlement Mode: ${explain.settlement}`);
  console.log(`  Regime: ${explain.regime}`);
  console.log(`  Fanout: ${explain.fanout}`);
  console.log(`  Providers Considered: ${explain.providers_considered || 0}`);
  console.log(`  Providers Eligible: ${explain.providers_eligible || 0}`);
  if (explain.selected_provider_id) {
    console.log(`  Selected Provider: ${explain.selected_provider_id}`);
  }
  console.log(`  Explain Level: ${explain.level}`);
  console.log("");
  
  // Decision log
  if (!explain.log || explain.log.length === 0) {
    console.log("No decision log entries found.");
    process.exit(0);
  }
  
  console.log("Decision Log:");
  console.log(`  Total Decisions: ${explain.log.length}\n`);
  
  // Group decisions by step
  const byStep: Record<string, ProviderDecision[]> = {};
  for (const decision of explain.log) {
    if (!byStep[decision.step]) {
      byStep[decision.step] = [];
    }
    byStep[decision.step].push(decision);
  }
  
  // Print decisions grouped by step
  const stepOrder = ["directory", "identity", "capabilities", "quote", "policy", "selection", "settlement"];
  for (const step of stepOrder) {
    if (byStep[step] && byStep[step].length > 0) {
      console.log(`\n${step.toUpperCase()} Phase:`);
      byStep[step].forEach((decision, idx) => {
        formatDecision(decision, idx);
      });
    }
  }
  
  // Print any decisions not in standard steps
  for (const [step, decisions] of Object.entries(byStep)) {
    if (!stepOrder.includes(step)) {
      console.log(`\n${step.toUpperCase()} Phase:`);
      decisions.forEach((decision, idx) => {
        formatDecision(decision, idx);
      });
    }
  }
  
  console.log("");
  
  // Final outcome
  if (transcript.outcome) {
    console.log("Final Outcome:");
    if (transcript.outcome.ok) {
      console.log(`  ✅ Success`);
      if (transcript.receipt) {
        console.log(`  Agreed Price: ${transcript.receipt.agreed_price.toFixed(8)}`);
      }
    } else {
      console.log(`  ❌ Failed`);
      console.log(`  Code: ${transcript.outcome.code || "N/A"}`);
      console.log(`  Reason: ${transcript.outcome.reason || "N/A"}`);
    }
  }
  
  console.log("");
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
