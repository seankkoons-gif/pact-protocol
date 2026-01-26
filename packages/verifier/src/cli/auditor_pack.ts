#!/usr/bin/env node
/**
 * Auditor Pack Generator
 * 
 * Creates a portable, self-contained evidence package for claims/regulators.
 * All derived files are deterministically generated from the transcript + constitution.
 * 
 * Usage:
 *   pact-verifier auditor-pack --transcript <path> --out <file.zip>
 *   pact-verifier auditor-pack --transcript <path> --out <file.zip> --include-passport --transcripts-dir <dir>
 *   pact-verifier auditor-pack --transcript <path> --out <file.zip> --include-contention --transcripts-dir <dir>
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, isAbsolute, dirname, basename, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { renderGCView } from "../gc_view/renderer.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import type { TranscriptV4 } from "../util/transcript_types.js";
import { stableCanonicalize } from "../util/canonical.js";
import {
  getTranscriptSigners,
  extractTranscriptSummary,
  computePassportDelta,
  applyDelta,
  getTranscriptStableId,
  type PassportState,
} from "../util/passport_v1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Version constants
const PACKAGE_VERSION = "auditor_pack/1.0";
const VERIFIER_VERSION = "0.2.0"; // Should match package.json

// EPIPE handler for pipe safety
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

interface AuditorPackArgs {
  transcript?: string;
  out?: string;
  includePassport?: boolean;
  includeContention?: boolean;
  transcriptsDir?: string;
}

function parseArgs(): AuditorPackArgs {
  const args: AuditorPackArgs = {};
  let i = 2;
  while (i < process.argv.length) {
    const arg = process.argv[i];
    if (arg === "--transcript" && i + 1 < process.argv.length) {
      args.transcript = process.argv[++i];
    } else if (arg === "--out" && i + 1 < process.argv.length) {
      args.out = process.argv[++i];
    } else if (arg === "--include-passport") {
      args.includePassport = true;
    } else if (arg === "--include-contention") {
      args.includeContention = true;
    } else if (arg === "--transcripts-dir" && i + 1 < process.argv.length) {
      args.transcriptsDir = process.argv[++i];
    }
    i++;
  }
  return args;
}

function printUsage(): void {
  console.error("Usage: pact-verifier auditor-pack --transcript <path> --out <file.zip>");
  console.error("");
  console.error("Options:");
  console.error("  --transcript <path>      Path to transcript JSON file (required)");
  console.error("  --out <file.zip>         Output ZIP file path (required)");
  console.error("  --include-passport       Include passport snapshot (requires --transcripts-dir)");
  console.error("  --include-contention     Include contention report (requires --transcripts-dir)");
  console.error("  --transcripts-dir <dir>  Directory containing transcripts for passport/contention");
  console.error("");
  console.error("Examples:");
  console.error("  pact-verifier auditor-pack --transcript tx.json --out evidence.zip");
  console.error("  pact-verifier auditor-pack --transcript tx.json --out evidence.zip --include-passport --transcripts-dir ./transcripts");
}

function loadTranscript(path: string): TranscriptV4 {
  let resolvedPath: string;
  if (isAbsolute(path)) {
    resolvedPath = path;
  } else {
    resolvedPath = resolve(process.cwd(), path);
  }

  if (!existsSync(resolvedPath)) {
    throw new Error(`Transcript file not found: ${path}`);
  }

  const content = readFileSync(resolvedPath, "utf-8");
  return JSON.parse(content);
}

function sha256File(content: string | Buffer): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

function loadConstitution(): { content: string; version: string; hash: string } {
  // Try to find constitution file
  const paths = [
    resolve(__dirname, "..", "resources", "CONSTITUTION_v1.md"),
    resolve(__dirname, "..", "..", "resources", "CONSTITUTION_v1.md"),
    resolve(__dirname, "..", "..", "..", "..", "docs", "CONSTITUTION_v1.md"),
    resolve(__dirname, "..", "..", "..", "..", "packages", "verifier", "resources", "CONSTITUTION_v1.md"),
  ];

  for (const p of paths) {
    if (existsSync(p)) {
      const content = readFileSync(p, "utf8");
      const canonical = content.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
      const hash = sha256File(canonical);
      return { content: canonical, version: "constitution/1.0", hash };
    }
  }

  throw new Error("Could not find CONSTITUTION_v1.md");
}

/**
 * Generate insurer summary (simplified inline version)
 */
async function generateInsurerSummary(
  transcript: TranscriptV4,
  gcView: Awaited<ReturnType<typeof renderGCView>>,
  judgment: Awaited<ReturnType<typeof resolveBlameV1>>
): Promise<Record<string, unknown>> {
  type Tier = "A" | "B" | "C";

  function tierFromPassport(score: number): Tier {
    if (score >= 0.20) return "A";
    if (score >= -0.10) return "B";
    return "C";
  }

  function extractSigners(t: TranscriptV4): { buyer: string | null; provider: string | null } {
    const intentRound = t.rounds.find((r) => r.round_type === "INTENT");
    const buyerKey = intentRound?.signature?.signer_public_key_b58 || intentRound?.public_key_b58 || null;

    const providerRound = t.rounds.find((r) => {
      const roundKey = r.signature?.signer_public_key_b58 || r.public_key_b58;
      return roundKey && roundKey !== buyerKey &&
        (r.round_type === "ASK" || r.round_type === "COUNTER" || r.round_type === "ACCEPT");
    });
    const providerKey = providerRound?.signature?.signer_public_key_b58 || providerRound?.public_key_b58 || null;

    return { buyer: buyerKey, provider: providerKey };
  }

  function computePassportScoreDelta(faultDomain: string, outcome: string, isProvider: boolean): number {
    if (outcome === "COMPLETED" || outcome.includes("SUCCESS")) {
      return 0.01;
    }
    if (faultDomain === "NO_FAULT") {
      return 0.01;
    }
    if (isProvider && (faultDomain === "PROVIDER_AT_FAULT" || faultDomain === "PROVIDER_RAIL_AT_FAULT")) {
      return -0.05;
    }
    if (!isProvider && (faultDomain === "BUYER_AT_FAULT" || faultDomain === "BUYER_RAIL_AT_FAULT")) {
      return -0.05;
    }
    return 0;
  }

  const signers = extractSigners(transcript);
  const outcome = gcView.executive_summary.status;
  const faultDomain = gcView.responsibility.judgment.fault_domain;
  const confidence = judgment.confidence;

  const buyerScore = computePassportScoreDelta(faultDomain, outcome, false);
  const providerScore = computePassportScoreDelta(faultDomain, outcome, true);

  const riskFactors: string[] = [];
  const surcharges: string[] = [];

  if (outcome.includes("FAILED") || outcome.includes("TIMEOUT")) {
    riskFactors.push(outcome);
  }
  if (faultDomain !== "NO_FAULT") {
    riskFactors.push(faultDomain);
  }
  if (confidence < 0.7) {
    surcharges.push("LOW_CONFIDENCE");
  }

  const buyerTier = tierFromPassport(buyerScore);
  const providerTier = tierFromPassport(providerScore);

  let coverage: "COVERED" | "COVERED_WITH_SURCHARGE" | "ESCROW_REQUIRED" | "EXCLUDED" = "COVERED";
  if (gcView.integrity.hash_chain === "INVALID") {
    coverage = "EXCLUDED";
  } else if (buyerTier === "C" || providerTier === "C") {
    coverage = "ESCROW_REQUIRED";
  } else if (surcharges.length > 0 || buyerTier === "B" || providerTier === "B") {
    coverage = "COVERED_WITH_SURCHARGE";
  }

  return {
    version: "insurer_summary/1.0",
    constitution_hash: gcView.constitution.hash.substring(0, 16) + "...",
    integrity: gcView.integrity.hash_chain === "VALID" ? "VALID" : "INVALID",
    outcome,
    fault_domain: faultDomain,
    confidence,
    buyer: signers.buyer ? {
      signer: signers.buyer.substring(0, 12) + "...",
      passport_score: buyerScore,
      tier: buyerTier,
    } : null,
    provider: signers.provider ? {
      signer: signers.provider.substring(0, 12) + "...",
      passport_score: providerScore,
      tier: providerTier,
    } : null,
    risk_factors: riskFactors,
    surcharges,
    coverage,
  };
}

/**
 * Load all transcripts from a directory
 */
function loadTranscriptsFromDir(dir: string): TranscriptV4[] {
  const transcripts: TranscriptV4[] = [];
  const resolvedDir = isAbsolute(dir) ? dir : resolve(process.cwd(), dir);

  if (!existsSync(resolvedDir)) {
    return transcripts;
  }

  const files = readdirSync(resolvedDir);
  for (const file of files) {
    if (file.endsWith(".json")) {
      const filePath = join(resolvedDir, file);
      try {
        const stat = statSync(filePath);
        if (stat.isFile()) {
          const content = readFileSync(filePath, "utf8");
          const parsed = JSON.parse(content);
          if (parsed.transcript_version === "pact-transcript/4.0") {
            transcripts.push(parsed);
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  return transcripts;
}

/**
 * Generate passport snapshot for signers in this transcript
 */
function generatePassportSnapshot(
  transcript: TranscriptV4,
  allTranscripts: TranscriptV4[]
): Record<string, unknown> {
  const signers = getTranscriptSigners(transcript);
  const states: Record<string, PassportState> = {};

  for (const signer of signers) {
    // Filter transcripts involving this signer
    const signerTranscripts = allTranscripts.filter((t) =>
      getTranscriptSigners(t).includes(signer)
    );

    // Sort by stable ID for determinism
    signerTranscripts.sort((a, b) =>
      getTranscriptStableId(a).localeCompare(getTranscriptStableId(b))
    );

    // Initialize state
    let state: PassportState = {
      version: "passport/1.0",
      agent_id: signer,
      score: 0,
      counters: {
        total_settlements: 0,
        successful_settlements: 0,
        disputes_lost: 0,
        disputes_won: 0,
        sla_violations: 0,
        policy_aborts: 0,
      },
    };

    // Apply deltas
    for (const t of signerTranscripts) {
      const summary = extractTranscriptSummary(t);
      const delta = computePassportDelta({
        transcript_summary: summary,
        dbl_judgment: null,
        agent_id: signer,
      });
      state = applyDelta(state, delta);
    }

    states[signer] = state;
  }

  return {
    version: "passport_snapshot/1.0",
    transcript_id: transcript.transcript_id,
    signers: signers.map((s) => s.substring(0, 16) + "..."),
    states,
  };
}

/**
 * Generate contention report for this transcript's intent
 */
function generateContentionReport(
  transcript: TranscriptV4,
  allTranscripts: TranscriptV4[]
): Record<string, unknown> {
  // Compute intent fingerprint
  const intentRound = transcript.rounds.find((r) => r.round_type === "INTENT");
  if (!intentRound) {
    return {
      version: "contention_report/1.0",
      transcript_id: transcript.transcript_id,
      intent_fingerprint: null,
      related_transcripts: [],
      double_commit_detected: false,
    };
  }

  const buyerKey = intentRound.signature?.signer_public_key_b58 || intentRound.public_key_b58;
  const fingerprintInput = stableCanonicalize({
    intent_type: transcript.intent_type,
    buyer_signer: buyerKey,
    policy_hash: transcript.policy_hash,
  });
  const intentFingerprint = sha256File(fingerprintInput);

  // Find related transcripts with same fingerprint
  const related: Array<{ transcript_id: string; status: string }> = [];
  let terminalCount = 0;

  for (const t of allTranscripts) {
    const tIntentRound = t.rounds.find((r) => r.round_type === "INTENT");
    if (!tIntentRound) continue;

    const tBuyerKey = tIntentRound.signature?.signer_public_key_b58 || tIntentRound.public_key_b58;
    const tFingerprintInput = stableCanonicalize({
      intent_type: t.intent_type,
      buyer_signer: tBuyerKey,
      policy_hash: t.policy_hash,
    });
    const tFingerprint = sha256File(tFingerprintInput);

    if (tFingerprint === intentFingerprint) {
      const hasAccept = t.rounds.some((r) => r.round_type === "ACCEPT");
      const isTerminal = hasAccept || !!t.failure_event;
      const status = hasAccept ? "COMPLETED" : (t.failure_event ? "FAILED" : "PENDING");

      related.push({ transcript_id: t.transcript_id, status });
      if (isTerminal) terminalCount++;
    }
  }

  return {
    version: "contention_report/1.0",
    transcript_id: transcript.transcript_id,
    intent_fingerprint: intentFingerprint.substring(0, 16) + "...",
    related_transcripts: related,
    double_commit_detected: terminalCount > 1,
  };
}

/**
 * Generate README.txt content
 */
function generateReadme(transcript: TranscriptV4): string {
  return `PACT AUDITOR PACK
=================

This archive contains a complete, self-verifiable evidence package for
a Pact v4 transaction.

CONTENTS
--------
- manifest.json         Package metadata and integrity summary
- checksums.sha256      SHA-256 checksums for all files
- constitution/         The rulebook (CONSTITUTION_v1.md)
- input/                Original transcript
- derived/              Computed artifacts (GC view, judgment, etc.)

HOW TO VERIFY
-------------

1. Verify file integrity:
   $ sha256sum -c checksums.sha256

2. (Optional) Re-verify with pact-verifier:
   $ pact-verifier gc-view --transcript input/transcript.json
   Compare the output with derived/gc_view.json

3. Check key fields in manifest.json:
   - integrity.hash_chain should be "VALID"
   - integrity.signatures_verified should show all signatures verified
   - outcome shows the transaction result

WHAT THE FIELDS MEAN
--------------------
- hash_chain: "VALID" means the cryptographic chain is intact
- signatures_verified: X/Y means X of Y signatures were verified
- outcome: The final status (COMPLETED, FAILED_*, ABORTED_*)
- fault_domain: Who is responsible (NO_FAULT, BUYER_AT_FAULT, PROVIDER_AT_FAULT)

For more information, see the Pact Constitution document in
constitution/CONSTITUTION_v1.md.

---
Transcript ID: ${transcript.transcript_id}
Generated by: @pact/verifier ${VERIFIER_VERSION}
`;
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const args = parseArgs();

  if (!args.transcript || !args.out) {
    printUsage();
    process.exit(1);
  }

  // Validate options
  if ((args.includePassport || args.includeContention) && !args.transcriptsDir) {
    console.error("Error: --include-passport and --include-contention require --transcripts-dir");
    process.exit(1);
  }

  try {
    // Load transcript
    const transcript = loadTranscript(args.transcript);
    const transcriptJson = JSON.stringify(transcript, null, 2);
    const transcriptHash = sha256File(transcriptJson);

    // Load constitution
    const constitution = loadConstitution();

    // Generate derived artifacts
    const gcView = await renderGCView(transcript);
    const judgment = await resolveBlameV1(transcript);
    const insurerSummary = await generateInsurerSummary(transcript, gcView, judgment);

    // Optional artifacts
    let passportSnapshot: Record<string, unknown> | null = null;
    let contentionReport: Record<string, unknown> | null = null;

    if (args.includePassport && args.transcriptsDir) {
      const allTranscripts = loadTranscriptsFromDir(args.transcriptsDir);
      passportSnapshot = generatePassportSnapshot(transcript, allTranscripts);
    }

    if (args.includeContention && args.transcriptsDir) {
      const allTranscripts = loadTranscriptsFromDir(args.transcriptsDir);
      contentionReport = generateContentionReport(transcript, allTranscripts);
    }

    // Build included artifacts list
    const includedArtifacts = [
      "constitution/CONSTITUTION_v1.md",
      "input/transcript.json",
      "derived/gc_view.json",
      "derived/judgment.json",
      "derived/insurer_summary.json",
    ];
    if (passportSnapshot) includedArtifacts.push("derived/passport_snapshot.json");
    if (contentionReport) includedArtifacts.push("derived/contention_report.json");
    includedArtifacts.push("README.txt");

    // Build manifest
    const manifest = {
      package_version: PACKAGE_VERSION,
      created_at_ms: Date.now(),
      constitution_version: constitution.version,
      constitution_hash: constitution.hash,
      transcript_id: transcript.transcript_id,
      transcript_hash: transcriptHash,
      tool_version: `@pact/verifier ${VERIFIER_VERSION}`,
      included_artifacts: includedArtifacts,
      integrity: {
        hash_chain: gcView.integrity.hash_chain,
        signatures_verified: gcView.integrity.signatures_verified,
      },
      outcome: gcView.executive_summary.status,
      responsibility: {
        fault_domain: gcView.responsibility.judgment.fault_domain,
        required_next_actor: gcView.responsibility.judgment.required_next_actor,
        required_action: gcView.responsibility.judgment.required_action,
        terminal: gcView.responsibility.judgment.terminal,
        confidence: judgment.confidence,
      },
    };

    // Create ZIP
    const zip = new JSZip();

    // Add files to zip
    const files: Array<{ path: string; content: string }> = [
      { path: "constitution/CONSTITUTION_v1.md", content: constitution.content },
      { path: "input/transcript.json", content: transcriptJson },
      { path: "derived/gc_view.json", content: JSON.stringify(gcView, null, 2) },
      { path: "derived/judgment.json", content: JSON.stringify(judgment, null, 2) },
      { path: "derived/insurer_summary.json", content: JSON.stringify(insurerSummary, null, 2) },
      { path: "README.txt", content: generateReadme(transcript) },
      { path: "manifest.json", content: JSON.stringify(manifest, null, 2) },
    ];

    if (passportSnapshot) {
      files.push({ path: "derived/passport_snapshot.json", content: JSON.stringify(passportSnapshot, null, 2) });
    }
    if (contentionReport) {
      files.push({ path: "derived/contention_report.json", content: JSON.stringify(contentionReport, null, 2) });
    }

    // Compute checksums and add files
    const checksums: Array<{ hash: string; path: string }> = [];

    for (const file of files) {
      zip.file(file.path, file.content);
      checksums.push({ hash: sha256File(file.content), path: file.path });
    }

    // Sort checksums by path for stable output
    checksums.sort((a, b) => a.path.localeCompare(b.path));

    // Create checksums file
    const checksumsContent = checksums
      .map(({ hash, path }) => `${hash}  ${path}`)
      .join("\n") + "\n";

    // Add checksums to zip (after computing, so it includes itself... wait, that's circular)
    // Actually, we should compute checksum of checksums file itself and add it last
    // But that's circular. Let's add checksums file without its own hash.
    zip.file("checksums.sha256", checksumsContent);

    // Generate ZIP buffer
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    // Write ZIP file
    const outPath = isAbsolute(args.out) ? args.out : resolve(process.cwd(), args.out);
    writeFileSync(outPath, zipBuffer);

    // Output to stderr (keep stdout clean)
    console.error(`Auditor pack created: ${outPath}`);
    console.error(`  Transcript: ${transcript.transcript_id}`);
    console.error(`  Outcome: ${gcView.executive_summary.status}`);
    console.error(`  Integrity: hash_chain=${gcView.integrity.hash_chain}, signatures=${gcView.integrity.signatures_verified.verified}/${gcView.integrity.signatures_verified.total}`);

  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
