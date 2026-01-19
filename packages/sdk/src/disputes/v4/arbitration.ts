/**
 * Pact v4 Arbitration Verifier and Hooks
 * 
 * Compliance-grade arbitration infrastructure for Pact v4 transcripts.
 * Implements deterministic validation, signature verification, and failure taxonomy mapping.
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import { stableCanonicalize } from "../../protocol/canonical";
import { hashMessageSync } from "../../protocol/canonical";
import type { TranscriptV4 } from "../../transcript/v4/replay";

/**
 * Arbiter decision outcome enum.
 */
export type ArbiterDecision = "RELEASE" | "REFUND" | "SPLIT" | "REJECT_ARBITRATION";

/**
 * Canonical reason code enum (non-free-text).
 */
export type ArbiterReasonCode =
  | "QUALITY_MISMATCH"
  | "SLA_VIOLATION"
  | "POLICY_VIOLATION_CONFIRMED"
  | "PROVIDER_NON_DELIVERY"
  | "BUYER_NON_PAYMENT"
  | "RAIL_TIMEOUT_CONFIRMED"
  | "INSUFFICIENT_EVIDENCE"
  | "IDENTITY_SNAPSHOT_INVALID"
  | "DEADLOCK_CONFIRMED"
  | "RECURSIVE_DEPENDENCY_FAILURE";

/**
 * Evidence reference (pointer into transcript sections/receipts).
 */
export interface EvidenceRef {
  type: "round_hash" | "receipt_hash" | "policy_section" | "evidence_bundle";
  ref: string;
  section?: string; // For policy_section type
  bundle_id?: string; // For evidence_bundle type
  entry_refs?: number[]; // For evidence_bundle type
}

/**
 * Pact v4 Arbiter Decision artifact (conforms to pact_arbiter_decision_v4.json schema).
 */
export interface ArbiterDecisionV4 {
  decision_id: string;
  transcript_hash: string;
  decision: ArbiterDecision;
  amounts?: {
    buyer_amount: number;
    provider_amount: number;
    currency?: string;
  };
  reason_codes: ArbiterReasonCode[];
  evidence_refs: EvidenceRef[];
  arbiter_id: string;
  arbiter_pubkey: string;
  issued_at: number;
  signature: {
    signer_public_key_b58: string;
    signature_b58: string;
    signed_at_ms: number;
    scheme: "ed25519";
  };
  schema_version: "pact-arbiter-decision/4.0";
  notes?: string;
}

/**
 * Validation result for decision artifact.
 */
export interface DecisionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Map arbitration reason codes to Pact Failure Taxonomy codes.
 */
export function mapReasonCodeToFailureCode(reasonCode: ArbiterReasonCode): string {
  const mapping: Record<ArbiterReasonCode, string> = {
    POLICY_VIOLATION_CONFIRMED: "PACT-101",
    IDENTITY_SNAPSHOT_INVALID: "PACT-201",
    DEADLOCK_CONFIRMED: "PACT-303",
    RAIL_TIMEOUT_CONFIRMED: "PACT-404",
    PROVIDER_NON_DELIVERY: "PACT-404",
    BUYER_NON_PAYMENT: "PACT-404",
    RECURSIVE_DEPENDENCY_FAILURE: "PACT-505",
    QUALITY_MISMATCH: "PACT-404",
    SLA_VIOLATION: "PACT-404",
    INSUFFICIENT_EVIDENCE: "PACT-303",
  };
  return mapping[reasonCode];
}

/**
 * Compute canonical JSON serialization of decision (sorted keys, no whitespace).
 * Excludes signature field for signature computation.
 */
export function canonicalizeDecision(decision: ArbiterDecisionV4): string {
  // Create copy excluding signature
  const { signature: _, ...decisionWithoutSignature } = decision;
  return stableCanonicalize(decisionWithoutSignature);
}

/**
 * Compute decision_id from transcript_hash + arbiter_id + issued_at.
 * Format: "decision-" + SHA-256(transcript_hash + arbiter_id + issued_at.toString()) (hex).
 */
export function computeDecisionId(
  transcriptHash: string,
  arbiterId: string,
  issuedAt: number
): string {
  const input = `${transcriptHash}${arbiterId}${issuedAt}`;
  const hashBytes = hashMessageSync(input);
  const hashHex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `decision-${hashHex}`;
}

/**
 * Verify decision artifact signature.
 * Returns true if signature is valid.
 */
export function verifyDecisionSignature(decision: ArbiterDecisionV4): boolean {
  try {
    // Verify signature scheme
    if (decision.signature.scheme !== "ed25519") {
      return false;
    }

    // Verify public key matches arbiter_pubkey
    if (decision.signature.signer_public_key_b58 !== decision.arbiter_pubkey) {
      return false;
    }

    // Verify signed_at_ms matches issued_at
    if (decision.signature.signed_at_ms !== decision.issued_at) {
      return false;
    }

    // Canonicalize decision (excluding signature)
    const canonicalJson = canonicalizeDecision(decision);

    // Decode public key and signature
    const publicKeyBytes = bs58.decode(decision.arbiter_pubkey);
    const signatureBytes = bs58.decode(decision.signature.signature_b58);

    // Hash canonical JSON (SHA-256)
    const hashBytes = hashMessageSync(canonicalJson);

    // Verify Ed25519 signature
    return nacl.sign.detached.verify(hashBytes, signatureBytes, publicKeyBytes);
  } catch (error) {
    // Invalid base58, invalid public key, etc.
    return false;
  }
}

/**
 * Validate decision artifact schema and semantic constraints.
 * Returns validation result with errors and warnings.
 */
export function validateDecisionArtifact(
  decision: ArbiterDecisionV4,
  transcript?: TranscriptV4
): DecisionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate schema_version
  if (decision.schema_version !== "pact-arbiter-decision/4.0") {
    errors.push(`Invalid schema_version: ${decision.schema_version}. Expected 'pact-arbiter-decision/4.0'.`);
  }

  // Validate decision_id format
  if (!/^decision-[a-f0-9]{64}$/.test(decision.decision_id)) {
    errors.push(`Invalid decision_id format: ${decision.decision_id}. Expected 'decision-' prefix followed by 64 hex chars.`);
  }

  // Validate decision_id matches computed value
  const computedId = computeDecisionId(decision.transcript_hash, decision.arbiter_id, decision.issued_at);
  if (decision.decision_id !== computedId) {
    errors.push(`decision_id mismatch: expected ${computedId}, got ${decision.decision_id}.`);
  }

  // Validate transcript_hash format
  if (!/^transcript-[a-f0-9]{64}$/.test(decision.transcript_hash)) {
    errors.push(`Invalid transcript_hash format: ${decision.transcript_hash}. Expected 'transcript-' prefix followed by 64 hex chars.`);
  }

  // Validate transcript_hash matches transcript (if provided)
  if (transcript && transcript.transcript_id !== decision.transcript_hash) {
    errors.push(`transcript_hash mismatch: expected ${transcript.transcript_id}, got ${decision.transcript_hash}.`);
  }

  // Validate decision enum
  if (!["RELEASE", "REFUND", "SPLIT", "REJECT_ARBITRATION"].includes(decision.decision)) {
    errors.push(`Invalid decision: ${decision.decision}. Must be RELEASE, REFUND, SPLIT, or REJECT_ARBITRATION.`);
  }

  // Validate amounts required for SPLIT
  if (decision.decision === "SPLIT" && !decision.amounts) {
    errors.push("amounts field is required when decision is SPLIT.");
  }

  // Validate amounts not present for non-SPLIT decisions
  if (decision.decision !== "SPLIT" && decision.amounts) {
    warnings.push("amounts field should not be present for non-SPLIT decisions.");
  }

  // Validate reason_codes not empty
  if (decision.reason_codes.length === 0) {
    errors.push("reason_codes array must not be empty.");
  }

  // Validate evidence_refs
  if (decision.evidence_refs.length === 0) {
    warnings.push("evidence_refs array is empty. Decision should reference specific transcript sections.");
  }

  // Validate issued_at > 0
  if (decision.issued_at <= 0) {
    errors.push(`Invalid issued_at: ${decision.issued_at}. Must be positive Unix timestamp (milliseconds).`);
  }

  // Validate issued_at > transcript.created_at_ms (if transcript provided)
  if (transcript && decision.issued_at <= transcript.created_at_ms) {
    errors.push(`issued_at (${decision.issued_at}) must be after transcript.created_at_ms (${transcript.created_at_ms}).`);
  }

  // Verify signature
  if (!verifyDecisionSignature(decision)) {
    errors.push("Decision signature verification failed.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Attach decision artifact reference to transcript.
 * Returns updated transcript with arbiter_decision_ref field.
 * 
 * Note: This does NOT modify the transcript hash chain because arbiter_decision_ref
 * is appended after the terminal failure_event and does not modify prior rounds.
 */
export function attachDecisionReference(
  transcript: TranscriptV4,
  decisionId: string
): TranscriptV4 {
  return {
    ...transcript,
    arbiter_decision_ref: decisionId,
  };
}

/**
 * Redacted evidence view hook (interface, not yet implemented).
 * Returns redacted evidence bundle hash for partner/auditor views.
 */
export interface RedactedEvidenceView {
  bundle_id: string;
  redaction_mask: {
    entries: Array<{
      entry_index: number;
      redaction_reason: string;
      redacted_hash: string;
    }>;
  };
  auditor_view?: string; // Unredacted bundle hash (for auditors)
}

/**
 * Generate redacted evidence view (stub - full implementation deferred).
 */
export function generateRedactedEvidenceView(
  _decision: ArbiterDecisionV4,
  _redactionRules?: string[]
): RedactedEvidenceView | null {
  // Full redaction implementation deferred to future versions
  // This hook is provided as an interface for future implementation
  return null;
}
