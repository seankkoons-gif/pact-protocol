/**
 * GC View Renderer
 * 
 * Generates a deterministic, human-readable summary for General Counsel review.
 * Outputs a single JSON document that can be read in <5 minutes.
 */

import type { TranscriptV4, FailureEvent } from "../util/transcript_types.js";
import type { JudgmentArtifact } from "../dbl/blame_resolver_v1.js";
import type { Sha256Async } from "../util/replay.js";
import { replayTranscriptV4 } from "../util/replay.js";
import { resolveBlameV1 } from "../dbl/blame_resolver_v1.js";
import { stableCanonicalize } from "../util/canonical_pure.js";
import { isAcceptedConstitutionHash } from "../util/constitution_hashes.js";

/** Human-readable description from FailureEvent (type has no message; use code/stage). */
function failureEventDescription(f?: FailureEvent): string {
  if (!f) return "";
  return [f.code, f.stage].filter(Boolean).join(" - ") || "";
}

/** Canonicalize constitution content (LF, trim trailing whitespace per line). */
function canonicalizeConstitutionContent(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}

/** Transcript hash excluding final_hash (same as SDK). Uses hashFn when provided (async path). */
async function computeTranscriptHashAsync(
  transcript: TranscriptV4,
  hashFn: (obj: unknown) => Promise<string>
): Promise<string> {
  const { final_hash: _fh, ...rest } = transcript;
  return hashFn(rest);
}

/**
 * Determine which constitution rules are applied based on verification results.
 * Maps to rule IDs from Constitution v1: DET-1, INT-1, INT-2, INT-3, LVSH-1, EVD-1, EVD-2, DBL-1, DBL-2, PAS-1, GC-1
 */
function determineRulesApplied(
  integrity: GCView["integrity"],
  judgment: JudgmentArtifact | null,
  evidenceIndex: GCView["evidence_index"],
  _hasPolicy: boolean,
  passportGatingUsed: boolean
): string[] {
  const rules: string[] = [];
  
  // DET-1: Determinism Rule - always applied (verification is deterministic)
  rules.push("DET-1");
  
  // INT-1: Hash Chain Integrity - applied if hash chain is validated
  if (integrity.hash_chain === "VALID" || integrity.hash_chain === "INVALID") {
    rules.push("INT-1");
  }
  
  // INT-2: Signature Verification - applied if signatures are verified
  if (integrity.signatures_verified.total > 0) {
    rules.push("INT-2");
  }
  
  // INT-3: Final/Container Hash Validation - applied if final hash validation occurs
  if (integrity.final_hash_validation === "MATCH" || 
      integrity.final_hash_validation === "MISMATCH" || 
      integrity.final_hash_validation === "UNVERIFIABLE") {
    rules.push("INT-3");
  }
  
  // LVSH-1: Last Valid Signed Hash - applied if judgment exists (LVSH computed)
  if (judgment?.lastValidHash) {
    rules.push("LVSH-1");
  }
  
  // EVD-1: Trusted Evidence - applied if trusted evidence is used
  if (evidenceIndex.trusted.length > 0) {
    rules.push("EVD-1");
  }
  
  // EVD-2: Claimed Evidence - applied if claimed evidence exists
  if (evidenceIndex.claimed.length > 0) {
    rules.push("EVD-2");
  }
  
  // DBL-1: Default Blame Logic - applied if judgment exists
  if (judgment) {
    rules.push("DBL-1");
  }
  
  // DBL-2: Required Next Actor - applied if judgment has requiredNextActor
  if (judgment?.requiredNextActor) {
    rules.push("DBL-2");
  }
  
  // PAS-1: Passport & Reputation - applied if passport gating was used
  if (passportGatingUsed) {
    rules.push("PAS-1");
  }
  
  // GC-1: GC View Interpretation - always applied (GC View is being generated)
  rules.push("GC-1");
  
  // Sort for determinism
  return rules.sort();
}

export interface GCView {
  version: "gc_view/1.0";
  constitution: {
    version: "constitution/1.0";
    hash: string;
    rules_applied: string[];
  };
  gc_takeaways: {
    approval_risk: "LOW" | "MEDIUM" | "HIGH";
    why: string[];
    open_questions: string[];
    recommended_remediation: string[];
  };
  chain_of_custody: {
    transcript_hash: string;
    evidence_bundle_hash?: string;
    signature_verification: {
      verified: number;
      total: number;
      status: "VERIFIED" | "PARTIAL" | "FAILED" | "UNVERIFIED";
    };
    artifacts_trusted: boolean;
    artifacts_claimed: number;
  };
  subject: {
    transcript_id_or_hash: string;
    intent_fingerprint?: string;
    parties: Array<{
      role: "buyer" | "provider";
      signer_pubkey: string;
      agent_label?: string;
    }>;
    asset?: string;
    amount?: string;
  };
  executive_summary: {
    status: "COMPLETED" | "ABORTED_POLICY" | "FAILED_TIMEOUT" | "FAILED_INTEGRITY" | "DISPUTED" | "FAILED_PROVIDER_UNREACHABLE" | "FAILED_PROVIDER_API_MISMATCH";
    what_happened: string;
    money_moved: boolean;
    settlement_attempted: boolean;
    final_outcome: string;
  };
  integrity: {
    hash_chain: "VALID" | "INVALID";
    signatures_verified: { verified: number; total: number };
    final_hash_mismatch: boolean | null;
    /** MATCH = recompute matches claimed; MISMATCH = differ; UNVERIFIABLE = missing container/material. */
    final_hash_validation: "MATCH" | "MISMATCH" | "UNVERIFIABLE";
    notes: string[];
  };
  policy: {
    policy_hash: string | null;
    policy_status: "SATISFIED" | "FAILED" | "UNKNOWN";
    passport_gating_used: boolean;
    passport_state_hashes: string[];
    policy_failures: Array<{
      code: string;
      message: string;
      evidence_refs: string[];
    }>;
  };
  /** Optional audit tier metadata (informational only; default T1). Does not affect verification. */
  audit?: {
    tier: "T1" | "T2" | "T3";
    sla?: string;
    note: string;
  };
  responsibility: {
    dbl_version: "dbl/2.0";
    judgment: {
      fault_domain?: string;
      required_next_actor?: string;
      required_action?: string;
      terminal?: boolean;
      responsible_signer_pubkey?: string;
      confidence: number;
    };
    last_valid_signed_hash: string;
    blame_explanation: string;
  };
  responsibility_trace: string[];
  evidence_index: {
    trusted: Array<{ id: string; type: string; hash: string; path?: string }>;
    claimed: Array<{ id: string; type: string; hash: string; path?: string }>;
    missing_expected: string[];
  };
  timeline: Array<{
    event: string;
    round: number;
    signer: string;
    hash: string;
    timestamp_ms?: number;
  }>;
  appendix: {
    transcript_path?: string;
    bundle_path?: string;
    tool_versions: { verifier: string; passport: "passport/1.0" };
  };
}

/**
 * Extract parties from transcript rounds.
 */
function extractParties(transcript: TranscriptV4): GCView["subject"]["parties"] {
  const parties: GCView["subject"]["parties"] = [];
  const seenSigners = new Set<string>();
  
  // Find buyer and provider from rounds
  for (const round of transcript.rounds) {
    const signerKey = round.signature?.signer_public_key_b58 || round.public_key_b58;
    if (!signerKey || seenSigners.has(signerKey)) continue;
    
    seenSigners.add(signerKey);
    
    // Determine role from agent_id or round type
    let role: "buyer" | "provider" = "buyer";
    if (round.agent_id === "seller" || round.agent_id === "provider") {
      role = "provider";
    } else if (round.round_type === "INTENT" && round.agent_id === "buyer") {
      role = "buyer";
    } else if (round.round_type === "ASK" || round.round_type === "BID") {
      // ASK is from provider, BID is from buyer
      role = round.round_type === "ASK" ? "provider" : "buyer";
    }
    
    parties.push({
      role,
      signer_pubkey: signerKey,
      agent_label: round.agent_id !== signerKey ? round.agent_id : undefined,
    });
  }
  
  // Sort by role (buyer first), then by signer_pubkey for determinism
  return parties.sort((a, b) => {
    if (a.role !== b.role) {
      return a.role === "buyer" ? -1 : 1;
    }
    return a.signer_pubkey.localeCompare(b.signer_pubkey);
  });
}

/**
 * Determine executive summary status from transcript.
 */
function determineStatus(transcript: TranscriptV4, replayResult: Awaited<ReturnType<typeof replayTranscriptV4>>): GCView["executive_summary"]["status"] {
  // PACT-420/421 are deterministic provider failures that occur BEFORE any cryptographic exchange.
  // They should be reported based on failure_event, not integrity status.
  // Handle these BEFORE integrity checks.
  if (transcript.failure_event) {
    const code = transcript.failure_event.code || "";
    if (code === "PACT-420") {
      return "FAILED_PROVIDER_UNREACHABLE";
    }
    if (code === "PACT-421") {
      return "FAILED_PROVIDER_API_MISMATCH";
    }
  }

  // Check for critical integrity failures (hash chain broken or signatures invalid)
  const hashChainBroken = replayResult.errors.some((e) => e.type === "HASH_CHAIN_BROKEN");
  const signatureInvalid = replayResult.errors.some((e) => e.type === "SIGNATURE_INVALID");
  // Only fail integrity if hash chain is broken or signatures are invalid
  // Final hash mismatch alone doesn't fail the transaction (it's a warning)
  if (hashChainBroken || signatureInvalid || (!replayResult.ok && replayResult.integrity_status === "INVALID")) {
    return "FAILED_INTEGRITY";
  }
  
  // If only final_hash_mismatch, still allow transaction to be COMPLETED (it's a data integrity warning, not a critical failure)
  // The integrity section will show final_hash_mismatch: true
  
  if (transcript.failure_event) {
    const code = transcript.failure_event.code || "";
    if (code.startsWith("PACT-101") || code === "PASSPORT_REQUIRED") {
      return "ABORTED_POLICY";
    }
    if (code.startsWith("PACT-404") || code.includes("TIMEOUT")) {
      return "FAILED_TIMEOUT";
    }
    if (code.startsWith("PACT-3") || code.includes("DISPUTE")) {
      return "DISPUTED";
    }
  }
  
  // Check if transaction completed (has ACCEPT and no failure)
  const hasAccept = transcript.rounds.some((r) => r.round_type === "ACCEPT");
  if (hasAccept && !transcript.failure_event) {
    return "COMPLETED";
  }
  
  // Default to completed if no failure event
  return transcript.failure_event ? "FAILED_TIMEOUT" : "COMPLETED";
}

/**
 * Generate "what happened" summary.
 */
function generateWhatHappened(transcript: TranscriptV4, status: GCView["executive_summary"]["status"]): string {
  const intentType = transcript.intent_type || "transaction";
  const rounds = transcript.rounds;
  
  if (status === "COMPLETED") {
    const acceptRound = rounds.find((r) => r.round_type === "ACCEPT");
    if (acceptRound) {
      return `Transaction completed successfully. Parties reached agreement on ${intentType} and settlement was executed.`;
    }
    return `Transaction completed successfully for ${intentType}.`;
  }
  
  if (status === "ABORTED_POLICY") {
    const detail = failureEventDescription(transcript.failure_event) || "Policy constraints were not satisfied.";
    return `Transaction aborted due to policy violation. ${detail}`;
  }
  
  if (status === "FAILED_TIMEOUT") {
    const detail = failureEventDescription(transcript.failure_event) || "Settlement deadline was not met.";
    return `Transaction failed due to timeout or SLA violation. ${detail}`;
  }
  
  if (status === "FAILED_PROVIDER_UNREACHABLE") {
    const detail = failureEventDescription(transcript.failure_event) || "Network failure or provider endpoint unavailable.";
    return `Provider unreachable during quote request; negotiation could not be completed. ${detail}`;
  }
  
  if (status === "FAILED_PROVIDER_API_MISMATCH") {
    const detail = failureEventDescription(transcript.failure_event) || "HTTP 404 on /pact route.";
    return `Provider API mismatch - /pact endpoint not found; provider endpoint exists but does not implement Pact protocol. ${detail}`;
  }
  
  if (status === "DISPUTED") {
    const detail = failureEventDescription(transcript.failure_event) || "Parties disagreed on outcome.";
    return `Transaction resulted in dispute. ${detail}`;
  }
  
  if (status === "FAILED_INTEGRITY") {
    return `Transaction failed integrity checks. Hash chain or signature verification failed.`;
  }
  
  return `Transaction status: ${status}`;
}

/**
 * Determine if settlement was attempted (ACCEPT round or settlement failure).
 */
function determineSettlementAttempted(transcript: TranscriptV4): boolean {
  // Settlement is attempted if:
  // 1. There's an ACCEPT round (agreement reached, settlement phase begins)
  // 2. OR failure_event indicates settlement stage failure
  const hasAccept = transcript.rounds.some((r) => r.round_type === "ACCEPT");
  const hasSettlementFailure = transcript.failure_event?.stage === "settlement";
  
  return hasAccept || hasSettlementFailure;
}

/**
 * Determine if money moved (ONLY if settlement commit/finalization is present).
 * 
 * Money moves ONLY when:
 * - Settlement commit/finalization is present (indicated by successful completion
 *   after ACCEPT with no failure_event, or explicit settlement commit indicators)
 * - NOT just because settlement was attempted
 */
function determineMoneyMoved(transcript: TranscriptV4, status: GCView["executive_summary"]["status"]): boolean {
  // Check for explicit settlement commit/finalization indicators in content_summary
  const hasExplicitCommit = transcript.rounds.some((r) => {
    const summary = r.content_summary;
    if (!summary || typeof summary !== "object") return false;
    
    // Look for explicit settlement commit/finalization indicators
    return (
      "settlement_commit" in summary ||
      "settlement_finalized" in summary ||
      "settlement_complete" in summary ||
      "payment_committed" in summary ||
      "handle_id" in summary // Settlement handle indicates settlement was initiated and may have committed
    );
  });
  
  // If explicit commit indicators are present, money moved
  if (hasExplicitCommit) {
    return true;
  }
  
  // If status is COMPLETED and there's an ACCEPT with no failure_event,
  // settlement likely finalized successfully
  const hasAccept = transcript.rounds.some((r) => r.round_type === "ACCEPT");
  const hasFailure = !!transcript.failure_event;
  
  if (status === "COMPLETED" && hasAccept && !hasFailure) {
    // Transaction completed successfully after ACCEPT - settlement finalized
    return true;
  }
  
  // Otherwise, money did not move
  return false;
}

/**
 * Extract asset and amount from transcript.
 */
function extractAssetAndAmount(transcript: TranscriptV4): { asset?: string; amount?: string } {
  // Look in content_summary of rounds for asset/amount info
  for (const round of transcript.rounds) {
    const summary = round.content_summary;
    if (!summary || typeof summary !== "object") continue;
    
    if ("asset" in summary && typeof summary.asset === "string") {
      return { asset: summary.asset };
    }
    if ("amount" in summary) {
      return { amount: String(summary.amount) };
    }
    if ("price" in summary) {
      return { amount: String(summary.price) };
    }
  }
  
  return {};
}

/**
 * Extract evidence references from transcript and judgment.
 * hashFn is used for deterministic ids (runtime-agnostic when sha256Async provided).
 */
async function extractEvidenceIndex(
  transcript: TranscriptV4,
  judgment: JudgmentArtifact | null,
  hashFn: (obj: unknown) => Promise<string>
): Promise<GCView["evidence_index"]> {
  const trusted: GCView["evidence_index"]["trusted"] = [];
  const claimed: GCView["evidence_index"]["claimed"] = [];
  const missingExpected: string[] = [];

  for (const round of transcript.rounds) {
    if (round.round_hash) {
      trusted.push({
        id: `round-${round.round_number}`,
        type: "round_hash",
        hash: round.round_hash,
      });
    }
  }

  if (judgment?.evidenceRefs) {
    for (const ref of judgment.evidenceRefs) {
      if (!trusted.some((e) => e.hash === ref)) {
        const idHash = (await hashFn(ref)).slice(0, 8);
        trusted.push({
          id: `evidence-${idHash}`,
          type: "evidence_ref",
          hash: ref,
        });
      }
    }
  }

  if (transcript.failure_event) {
    const failure = transcript.failure_event as Record<string, unknown>;
    if ("evidence_refs" in failure && Array.isArray(failure.evidence_refs)) {
      for (const ref of failure.evidence_refs as string[]) {
        const idHash = (await hashFn(ref)).slice(0, 8);
        claimed.push({
          id: `claimed-${idHash}`,
          type: "claimed_evidence",
          hash: ref,
        });
      }
    }
  }

  if (judgment?.claimedEvidenceRefs) {
    for (const ref of judgment.claimedEvidenceRefs) {
      if (!claimed.some((e) => e.hash === ref)) {
        const idHash = (await hashFn(ref)).slice(0, 8);
        claimed.push({
          id: `claimed-${idHash}`,
          type: "claimed_evidence",
          hash: ref,
        });
      }
    }
  }

  trusted.sort((a, b) => a.id.localeCompare(b.id));
  claimed.sort((a, b) => a.id.localeCompare(b.id));

  return { trusted, claimed, missing_expected: missingExpected };
}

/**
 * Build timeline from transcript rounds.
 */
function buildTimeline(transcript: TranscriptV4): GCView["timeline"] {
  const timeline: GCView["timeline"] = [];
  
  for (const round of transcript.rounds) {
    const signerKey = round.signature?.signer_public_key_b58 || round.public_key_b58 || "";
    const roundHash = round.round_hash || round.envelope_hash || "";
    
    timeline.push({
      event: round.round_type,
      round: round.round_number,
      signer: signerKey,
      hash: roundHash,
      timestamp_ms: round.timestamp_ms,
    });
  }
  
  return timeline;
}

/**
 * Check if a string is a valid hash (64 hex characters).
 */
function isValidHash(s: string): boolean {
  return /^[0-9a-f]{64}$/i.test(s);
}

/**
 * Normalize policy_hash: must be a valid hash string or null.
 */
function normalizePolicyHash(policyHash: unknown): string | null {
  if (typeof policyHash !== "string") {
    return null;
  }
  // If it's a valid hash (64 hex chars), use it; otherwise null
  return isValidHash(policyHash) ? policyHash : null;
}

/**
 * Determine policy status from transaction status and policy failures.
 */
function determinePolicyStatus(
  status: GCView["executive_summary"]["status"],
  policyFailures: GCView["policy"]["policy_failures"]
): "SATISFIED" | "FAILED" | "UNKNOWN" {
  if (status === "ABORTED_POLICY" || policyFailures.length > 0) {
    return "FAILED";
  }
  if (status === "COMPLETED") {
    return "SATISFIED";
  }
  return "UNKNOWN";
}

/**
 * Extract policy failures from transcript.
 */
function extractPolicyFailures(transcript: TranscriptV4): GCView["policy"]["policy_failures"] {
  const failures: GCView["policy"]["policy_failures"] = [];
  
  if (transcript.failure_event) {
    const failure = transcript.failure_event;
    const code = failure.code || "";
    
    if (code.startsWith("PACT-1") || code === "PASSPORT_REQUIRED") {
      failures.push({
        code,
        message: failureEventDescription(failure) || `Policy violation: ${code}`,
        evidence_refs: [],
      });
    }
  }
  
  return failures;
}

/**
 * Check if passport gating was used.
 */
function checkPassportGating(transcript: TranscriptV4): boolean {
  // Check failure event for passport-related codes
  if (transcript.failure_event?.code === "PASSPORT_REQUIRED") {
    return true;
  }
  
  // Check rounds for passport evidence
  for (const round of transcript.rounds) {
    const summary = round.content_summary;
    if (summary && typeof summary === "object") {
      if ("passport_v1_state_hash" in summary || "passport_v1_referenced_fields" in summary) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Extract passport state hashes from transcript.
 */
function extractPassportStateHashes(transcript: TranscriptV4): string[] {
  const hashes: string[] = [];
  
  for (const round of transcript.rounds) {
    const summary = round.content_summary;
    if (summary && typeof summary === "object" && "passport_v1_state_hash" in summary) {
      const hash = summary.passport_v1_state_hash;
      if (typeof hash === "string" && !hashes.includes(hash)) {
        hashes.push(hash);
      }
    }
  }
  
  return hashes.sort(); // Deterministic ordering
}

/**
 * Generate GC takeaways (approval risk assessment).
 */
function generateGCTakeaways(
  status: GCView["executive_summary"]["status"],
  integrity: GCView["integrity"],
  judgment: JudgmentArtifact | null,
  policyFailures: GCView["policy"]["policy_failures"],
  constitution: { version: "constitution/1.0"; hash: string }
): GCView["gc_takeaways"] {
  let approval_risk: "LOW" | "MEDIUM" | "HIGH" = "LOW";
  const why: string[] = [];
  const open_questions: string[] = [];
  const recommended_remediation: string[] = [];
  
  // Determine approval risk
  // integrity INVALID => HIGH. UNVERIFIABLE alone must NOT raise above LOW when verified + NO_FAULT.
  if (integrity.hash_chain === "INVALID") {
    approval_risk = "HIGH";
    why.push("Integrity validation failed - hash chain broken");
    open_questions.push("Was the transcript tampered with?");
    recommended_remediation.push("Investigate integrity failure - do not approve transaction");
  } else if (status === "DISPUTED") {
    approval_risk = "HIGH";
    why.push("Transaction resulted in dispute - requires resolution");
    if (judgment?.dblDetermination === "INDETERMINATE" || judgment?.dblDetermination === "INDETERMINATE_TAMPER") {
      open_questions.push("Can fault be determined from available evidence?");
    }
    if (judgment?.dblDetermination === "INDETERMINATE_TAMPER") {
      open_questions.push("Integrity/tamper: fault cannot be assigned to agent; underwriter scrutiny required.");
    }
    recommended_remediation.push("Resolve dispute before approval");
  } else if (status === "FAILED_TIMEOUT") {
    approval_risk = "MEDIUM";
    why.push("Transaction failed due to timeout or SLA violation");
    open_questions.push("Was the timeout due to system issues or counterparty delay?");
    recommended_remediation.push("Review timeout cause and consider retry");
  } else if (status === "FAILED_PROVIDER_UNREACHABLE") {
    approval_risk = "MEDIUM";
    why.push("Provider unreachable during quote request - network failure or provider endpoint unavailable");
    open_questions.push("Was this a temporary network issue or provider infrastructure failure?");
    open_questions.push("Should retry be attempted with a different provider?");
    recommended_remediation.push("Retry with same or alternative provider after verifying network connectivity");
  } else if (status === "FAILED_PROVIDER_API_MISMATCH") {
    approval_risk = "MEDIUM";
    why.push("Provider API mismatch - /pact endpoint not found");
    open_questions.push("Does the provider implement the Pact protocol correctly?");
    open_questions.push("Is the provider endpoint URL configured correctly?");
    recommended_remediation.push("Verify provider implements /pact endpoint and retry with correct configuration");
  } else if (status === "ABORTED_POLICY") {
    approval_risk = "MEDIUM";
    why.push("Transaction aborted due to policy violation");
    if (policyFailures.length > 0) {
      why.push(`Policy failure code: ${policyFailures[0].code}`);
    }
    open_questions.push("Was policy enforcement correct?");
    recommended_remediation.push("Review policy constraints and transaction parameters");
  } else if (status === "COMPLETED") {
    if (judgment?.dblDetermination === "NO_FAULT") {
      approval_risk = "LOW";
      why.push("Transaction completed successfully with no-fault determination");
      if (integrity.hash_chain === "VALID" && integrity.signatures_verified.verified === integrity.signatures_verified.total) {
        why.push("All integrity checks passed");
      } else if (integrity.final_hash_validation === "MISMATCH") {
        why.push("Hash chain and signatures are valid (final_hash mismatch is a container-level warning)");
      }
    } else if (judgment?.dblDetermination && (judgment.dblDetermination as string) !== "NO_FAULT") {
      approval_risk = "MEDIUM";
      why.push(`Transaction completed but DBL indicates: ${judgment.dblDetermination}`);
      open_questions.push("Should completed transaction with fault be approved?");
      recommended_remediation.push("Review fault determination and consider remediation");
    } else {
      approval_risk = "LOW";
      why.push("Transaction completed successfully");
      if (integrity.hash_chain === "VALID" && integrity.signatures_verified.verified === integrity.signatures_verified.total) {
        why.push("All integrity checks passed");
      }
    }
  }
  
  // Check for transcript_hash mismatch and adjust risk accordingly
  // If signatures verify AND mismatch is only in claimed evidence → MEDIUM
  // If mismatch is in trusted evidence or integrity invalid → HIGH
  const hasTranscriptHashMismatch = integrity.notes.some((note) =>
    typeof note === "string" && note.includes("transcript_hash did not match")
  );
  
  if (hasTranscriptHashMismatch) {
    const signaturesValid = integrity.signatures_verified.verified === integrity.signatures_verified.total && integrity.signatures_verified.total > 0;
    const hashChainValid = integrity.hash_chain === "VALID";
    
    // Failure-event transcript_hash mismatch is "claimed" evidence (not cryptographically verified)
    // If signatures + hash chain are valid, this is a claimed evidence mismatch → MEDIUM
    if (signaturesValid && hashChainValid) {
      // Only raise to MEDIUM if not already HIGH
      if (approval_risk !== "HIGH") {
        approval_risk = "MEDIUM";
        why.push("Claimed evidence hash mismatch detected (signatures and hash chain are valid)");
      }
    } else {
      // If integrity is invalid or signatures don't verify, this is trusted evidence issue → HIGH
      approval_risk = "HIGH";
      why.push("Evidence hash mismatch in trusted evidence or integrity validation failed");
    }
  }
  
  // Add integrity notes as open questions if present (only if they're meaningful)
  // Dedupe: if a note mentions transcript_hash mismatch, reference it instead of repeating verbatim
  if (integrity.notes.length > 0) {
    let hasTranscriptHashMismatchNote = false;
    
    for (const note of integrity.notes) {
      if (note && typeof note === "string" && note.trim().length > 0) {
        // If this is a transcript_hash mismatch note, don't add it verbatim
        // Instead, add a reference if we haven't already
        if (note.includes("transcript_hash did not match")) {
          hasTranscriptHashMismatchNote = true;
        } else {
          // For other notes, add them as-is
          open_questions.push(note);
        }
      }
    }
    
    // Add reference to transcript_hash mismatch if present (once, not verbatim)
    if (hasTranscriptHashMismatchNote && !open_questions.some((q) => q.includes("claimed evidence hash mismatch"))) {
      open_questions.push("A claimed evidence hash mismatch exists (see integrity.notes).");
    }
  }
  
  // Add judgment notes as open questions if present
  // Only include mismatch-related notes when final_hash_validation === "MISMATCH"
  if (judgment?.notes && typeof judgment.notes === "string" && judgment.notes.trim().length > 0) {
    const judgmentNote = judgment.notes.trim();
    const isMismatchNote = judgmentNote.toLowerCase().includes("final hash mismatch") ||
                           judgmentNote.toLowerCase().includes("container final hash") ||
                           judgmentNote.toLowerCase().includes("lvsh computed");
    if (!isMismatchNote || integrity.final_hash_validation === "MISMATCH") {
      open_questions.push(judgmentNote);
    }
  }
  
  // Only mention final hash mismatch in open_questions when validation === "MISMATCH"
  if (integrity.final_hash_validation === "MISMATCH" && integrity.hash_chain === "VALID" && integrity.signatures_verified.verified === integrity.signatures_verified.total) {
    const hasMismatchInJudgment = judgment?.notes?.toLowerCase().includes("final hash mismatch") ||
                                  judgment?.notes?.toLowerCase().includes("container final hash");
    if (!hasMismatchInJudgment) {
      open_questions.push("Final hash mismatch detected - container hash doesn't match computed hash (hash chain and signatures are valid)");
    }
  }
  
  // If validation === "UNVERIFIABLE", add transcript-only message
  if (integrity.final_hash_validation === "UNVERIFIABLE") {
    open_questions.push("Final/container hash not verifiable in transcript-only mode; LVSH computed from signed rounds.");
  }
  
  // Check constitution hash - add warning if non-standard
  const constitutionHash = constitution.hash;
  if (!isAcceptedConstitutionHash(constitutionHash)) {
    open_questions.push(`NON-STANDARD RULES: constitution hash mismatch (hash: ${constitutionHash.substring(0, 16)}...). This transcript uses non-standard rules that are not recognized.`);
  }
  
  // Sort for determinism
  why.sort();
  open_questions.sort();
  recommended_remediation.sort();
  
  return {
    approval_risk,
    why,
    open_questions,
    recommended_remediation,
  };
}

/**
 * Generate chain of custody information.
 */
async function generateChainOfCustody(
  transcript: TranscriptV4,
  replayResult: Awaited<ReturnType<typeof replayTranscriptV4>>,
  evidenceIndex: GCView["evidence_index"],
  hashFn: (obj: unknown) => Promise<string>,
  bundlePath?: string
): Promise<GCView["chain_of_custody"]> {
  const transcriptHash = transcript.final_hash || transcript.transcript_id || "";

  let evidenceBundleHash: string | undefined;
  if (bundlePath) {
    evidenceBundleHash = await hashFn({ bundle_path: bundlePath, transcript_hash: transcriptHash });
  }
  
  // Determine signature verification status
  const verified = replayResult.signature_verifications;
  const total = transcript.rounds.length;
  let signatureStatus: "VERIFIED" | "PARTIAL" | "FAILED" | "UNVERIFIED";
  
  if (total === 0) {
    signatureStatus = "UNVERIFIED";
  } else if (verified === total) {
    signatureStatus = "VERIFIED";
  } else if (verified === 0) {
    // Check if signatures are missing/mocked (all rounds have signatures but none verify)
    const hasSignatures = transcript.rounds.every(
      (r) => r.signature?.signature_b58 && r.signature?.signer_public_key_b58
    );
    signatureStatus = hasSignatures ? "FAILED" : "UNVERIFIED";
  } else {
    signatureStatus = "PARTIAL";
  }
  
  // Determine if artifacts are trusted (all evidence is trusted, none claimed)
  const artifactsTrusted = evidenceIndex.trusted.length > 0 && evidenceIndex.claimed.length === 0;
  const artifactsClaimed = evidenceIndex.claimed.length;
  
  return {
    transcript_hash: transcriptHash,
    evidence_bundle_hash: evidenceBundleHash,
    signature_verification: {
      verified,
      total,
      status: signatureStatus,
    },
    artifacts_trusted: artifactsTrusted,
    artifacts_claimed: artifactsClaimed,
  };
}

/**
 * Generate responsibility trace from DBL judgment.
 * Integrity line: VALID (signatures + hash chain), INVALID (hash chain/signature failure), or VALID + final hash UNVERIFIABLE.
 */
function generateResponsibilityTrace(
  transcript: TranscriptV4,
  judgment: JudgmentArtifact | null,
  integrity: GCView["integrity"]
): string[] {
  const trace: string[] = [];
  
  if (!judgment) {
    trace.push("DBL judgment not available");
    return trace;
  }
  
  // Add last valid signed hash
  if (judgment.lastValidHash) {
    trace.push(`Last valid signed hash: ${judgment.lastValidHash}`);
  }
  
  // Add last valid round
  trace.push(`Last valid round: ${judgment.lastValidRound}`);
  
  // Add last valid summary
  if (judgment.lastValidSummary) {
    trace.push(`Last valid state: ${judgment.lastValidSummary}`);
  }
  
  // Add failure code if present
  if (judgment.failureCode) {
    trace.push(`Failure code: ${judgment.failureCode}`);
  }
  
  // Add failure stage from transcript if available
  if (transcript.failure_event) {
    const failure = transcript.failure_event as Record<string, unknown>;
    if ("stage" in failure && typeof failure.stage === "string") {
      trace.push(`Failure stage: ${failure.stage.toUpperCase()}`);
    }
  }
  
  // Add required next actor
  if (judgment.requiredNextActor) {
    trace.push(`Required next actor: ${judgment.requiredNextActor}`);
  }
  
  // Add DBL determination
  if (judgment.dblDetermination) {
    trace.push(`DBL determination: ${judgment.dblDetermination}`);
  }
  
  // Add confidence
  trace.push(`Confidence: ${(judgment.confidence * 100).toFixed(0)}%`);
  
  // Add passport impact if non-zero
  if (judgment.passportImpact !== 0) {
    trace.push(`Passport impact: ${judgment.passportImpact > 0 ? "+" : ""}${judgment.passportImpact}`);
  }
  
  // Add evidence refs count
  if (judgment.evidenceRefs && judgment.evidenceRefs.length > 0) {
    trace.push(`Trusted evidence refs: ${judgment.evidenceRefs.length}`);
  }
  
  // Add claimed evidence refs count if present
  if (judgment.claimedEvidenceRefs && judgment.claimedEvidenceRefs.length > 0) {
    trace.push(`Claimed evidence refs: ${judgment.claimedEvidenceRefs.length}`);
  }
  
  // Integrity line: never use SDK "TAMPERED". Use one of:
  // - Integrity: VALID (signatures + hash chain)
  // - Integrity: INVALID (hash chain/signature failure)
  // - Integrity: VALID, final hash UNVERIFIABLE
  const sigOk = integrity.signatures_verified.verified === integrity.signatures_verified.total && integrity.signatures_verified.total > 0;
  if (integrity.hash_chain === "INVALID" || !sigOk) {
    trace.push("Integrity: INVALID (hash chain/signature failure)");
  } else if (integrity.final_hash_validation === "UNVERIFIABLE") {
    trace.push("Integrity: VALID, final hash UNVERIFIABLE");
  } else {
    trace.push("Integrity: VALID (signatures + hash chain)");
  }
  
  // Return trace in deterministic order
  // Items are added in logical order, but we sort for complete determinism
  // However, we preserve the first 3 items (hash, round, state) as they're most important
  if (trace.length > 3) {
    const first = trace.slice(0, 3);
    const rest = trace.slice(3).sort();
    return [...first, ...rest];
  }
  
  return trace;
}

/**
 * Generate GC View from transcript.
 */
export async function renderGCView(
  transcript: TranscriptV4,
  options: {
    transcriptPath?: string;
    bundlePath?: string;
    constitutionPath?: string;
    /** When provided with constitutionContent, used for constitution hash (browser/runtime-agnostic). */
    constitutionContent?: string;
    /** When provided, passed to replay and used for hashing (no Node crypto). */
    sha256Async?: Sha256Async;
  } = {}
): Promise<GCView> {
  const replayOptions = options.sha256Async ? { sha256Async: options.sha256Async } : undefined;
  const replayResult = await replayTranscriptV4(transcript as any, replayOptions);

  let judgment: JudgmentArtifact | null = null;
  try {
    judgment = await resolveBlameV1(transcript, replayOptions);
  } catch (error) {
    // Judgment computation failed, continue without it
  }
  
  // Determine status
  const status = determineStatus(transcript, replayResult);
  
  // Extract parties
  const parties = extractParties(transcript);
  
  // Extract asset/amount
  const { asset, amount } = extractAssetAndAmount(transcript);
  
  // Get transcript identifier
  const transcriptId = transcript.final_hash || transcript.transcript_id || "";
  
  // Extract policy failures
  const policyFailures = extractPolicyFailures(transcript);

  const hashFn: (obj: unknown) => Promise<string> =
    options.sha256Async != null
      ? (obj) => options.sha256Async!(stableCanonicalize(obj))
      : async (obj) => {
          const canonical = stableCanonicalize(obj);
          const crypto = await import("node:crypto");
          const h = crypto.createHash("sha256");
          h.update(canonical, "utf8");
          return h.digest("hex");
        };

  const evidenceIndex = await extractEvidenceIndex(transcript, judgment, hashFn);

  const hashChainBroken = replayResult.errors.some((e) => e.type === "HASH_CHAIN_BROKEN");
  let finalHashValidation: "MATCH" | "MISMATCH" | "UNVERIFIABLE";
  let finalHashMismatch: boolean | null;
  const transcriptOnly = !options.bundlePath;
  const hasClaimedFinalHash = transcript.final_hash !== undefined && transcript.final_hash !== null && String(transcript.final_hash).length > 0;
  const canRecompute = transcript.rounds.length > 0;

  if (transcriptOnly || !hasClaimedFinalHash || !canRecompute) {
    finalHashValidation = "UNVERIFIABLE";
    finalHashMismatch = null;
  } else {
    const computed = await computeTranscriptHashAsync(transcript, hashFn);
    const claimed = String(transcript.final_hash!);
    if (computed === claimed) {
      finalHashValidation = "MATCH";
      finalHashMismatch = false;
    } else {
      finalHashValidation = "MISMATCH";
      finalHashMismatch = true;
    }
  }

  const integrity: GCView["integrity"] = {
    hash_chain: hashChainBroken ? "INVALID" : "VALID",
    signatures_verified: {
      verified: replayResult.signature_verifications,
      total: transcript.rounds.length,
    },
    final_hash_mismatch: finalHashMismatch,
    final_hash_validation: finalHashValidation,
    notes: [...replayResult.warnings],
  };

  let constitution: { version: "constitution/1.0"; hash: string };
  if (options.constitutionContent != null && options.sha256Async != null) {
    const canonicalContent = canonicalizeConstitutionContent(options.constitutionContent);
    const hash = await options.sha256Async(canonicalContent);
    constitution = { version: "constitution/1.0", hash };
  } else {
    const { loadConstitution } = await import("../load_constitution_node.js");
    constitution = loadConstitution(options.constitutionPath);
  }
  
  // Determine which rules are applied
  const hasPolicy = !!transcript.policy_hash;
  const passportGatingUsed = checkPassportGating(transcript);
  const rulesApplied = determineRulesApplied(integrity, judgment, evidenceIndex, hasPolicy, passportGatingUsed);
  
  // Build GC view
  const gcView: GCView = {
    version: "gc_view/1.0",
    constitution: {
      version: constitution.version,
      hash: constitution.hash,
      rules_applied: rulesApplied,
    },
    gc_takeaways: generateGCTakeaways(status, integrity, judgment, policyFailures, {
      version: constitution.version,
      hash: constitution.hash,
    }),
    chain_of_custody: await generateChainOfCustody(transcript, replayResult, evidenceIndex, hashFn, options.bundlePath),
    subject: {
      transcript_id_or_hash: transcriptId,
      intent_fingerprint: transcript.intent_id || undefined,
      parties,
      asset,
      amount,
    },
    executive_summary: {
      status,
      what_happened: generateWhatHappened(transcript, status),
      money_moved: determineMoneyMoved(transcript, status),
      settlement_attempted: determineSettlementAttempted(transcript),
      final_outcome: judgment?.recommendation || status,
    },
    integrity,
    policy: {
      policy_hash: normalizePolicyHash(transcript.policy_hash),
      policy_status: determinePolicyStatus(status, policyFailures),
      passport_gating_used: checkPassportGating(transcript),
      passport_state_hashes: extractPassportStateHashes(transcript),
      policy_failures: policyFailures,
    },
    ...(transcript.metadata?.audit_tier != null || transcript.metadata?.audit_sla != null
      ? {
          audit: {
            tier: (transcript.metadata?.audit_tier as "T1" | "T2" | "T3") ?? "T1",
            sla: transcript.metadata?.audit_sla as string | undefined,
            note: "Tier affects audit schedule, not transaction admissibility.",
          },
        }
      : {}),
    responsibility: {
      dbl_version: "dbl/2.0",
      judgment: {
        fault_domain: judgment?.dblDetermination || undefined,
        required_next_actor: judgment?.requiredNextActor || "NONE",
        required_action: judgment?.requiredAction || "NONE",
        terminal: judgment?.terminal ?? false,
        responsible_signer_pubkey: judgment ? extractResponsibleSigner(transcript, judgment) : undefined,
        confidence: judgment?.confidence ?? 0,
      },
      last_valid_signed_hash: judgment?.lastValidHash || transcript.rounds[transcript.rounds.length - 1]?.round_hash || "",
      blame_explanation: judgment?.recommendation || "No judgment available",
    },
    responsibility_trace: generateResponsibilityTrace(transcript, judgment, integrity),
    evidence_index: evidenceIndex,
    timeline: buildTimeline(transcript),
    appendix: {
      transcript_path: options.transcriptPath,
      bundle_path: options.bundlePath,
      tool_versions: {
        verifier: "0.1.0",
        passport: "passport/1.0",
      },
    },
  };
  
  return gcView;
}

/**
 * Extract responsible signer pubkey from judgment.
 */
function extractResponsibleSigner(transcript: TranscriptV4, judgment: JudgmentArtifact): string | undefined {
  // If judgment indicates buyer/provider fault, find their signer key
  if (judgment.dblDetermination === "BUYER_AT_FAULT" || judgment.dblDetermination === "BUYER_RAIL_AT_FAULT") {
    // Find buyer signer key
    for (const round of transcript.rounds) {
      if (round.agent_id === "buyer" || round.round_type === "INTENT") {
        return round.signature?.signer_public_key_b58 || round.public_key_b58;
      }
    }
  }
  
  if (judgment.dblDetermination === "PROVIDER_AT_FAULT" || judgment.dblDetermination === "PROVIDER_RAIL_AT_FAULT") {
    // Find provider signer key
    for (const round of transcript.rounds) {
      if (round.agent_id === "seller" || round.agent_id === "provider" || round.round_type === "ASK") {
        return round.signature?.signer_public_key_b58 || round.public_key_b58;
      }
    }
  }
  
  return undefined;
}
