/**
 * Passport v1 Policy Gating
 * 
 * Deterministic policy gating using Passport v1 state keyed by signer_public_key_b58.
 * Pure and deterministic: no Date.now, no randomness, no network, no FS.
 */

import type { PassportState } from "@pact/passport/src/v1/types";
import type { CounterpartyConstraints } from "./types";
import { stableCanonicalize, hashMessageSync } from "../protocol/canonical";

/**
 * Evidence emitted when passport gating occurs (CLAIMED, not TRUSTED)
 */
export interface PassportGatingEvidence {
  passport_v1_state_hash: string; // Hash of canonical JSON of the state
  passport_v1_referenced_fields: string[]; // Array of field names that were checked
  passport_v1_signer_key: string; // Signer public key (base58)
}

/**
 * Check passport v1 constraints against passport state.
 * 
 * @param passportState Passport v1 state (or null if missing)
 * @param constraints Passport v1 constraints from policy
 * @param signerKey Signer public key (base58) for evidence
 * @returns null if pass, or evidence + reason if fail
 */
export function checkPassportV1Constraints(
  passportState: PassportState | null | undefined,
  constraints: CounterpartyConstraints["passport_v1"],
  signerKey: string
): { evidence: PassportGatingEvidence; reason: string } | null {
  // If no constraints defined, pass
  if (!constraints) {
    return null;
  }

  // If passport is missing but constraints are required, fail
  if (passportState === null || passportState === undefined) {
    const referencedFields: string[] = [];
    if (constraints.min_score !== undefined) referencedFields.push("score");
    if (constraints.min_successful_settlements !== undefined) referencedFields.push("counters.successful_settlements");
    if (constraints.max_disputes_lost !== undefined) referencedFields.push("counters.disputes_lost");
    if (constraints.max_sla_violations !== undefined) referencedFields.push("counters.sla_violations");
    if (constraints.max_policy_aborts !== undefined) referencedFields.push("counters.policy_aborts");

    // Generate evidence with null state hash (state is missing)
    const evidence: PassportGatingEvidence = {
      passport_v1_state_hash: "", // Empty hash indicates missing state
      passport_v1_referenced_fields: referencedFields,
      passport_v1_signer_key: signerKey,
    };

    return {
      evidence,
      reason: "Passport v1 required but missing",
    };
  }

  // Check constraints
  const violations: string[] = [];
  const referencedFields: string[] = [];

  // Check min_score
  if (constraints.min_score !== undefined) {
    referencedFields.push("score");
    if (passportState.score < constraints.min_score) {
      violations.push(`score ${passportState.score} < min ${constraints.min_score}`);
    }
  }

  // Check min_successful_settlements
  if (constraints.min_successful_settlements !== undefined) {
    referencedFields.push("counters.successful_settlements");
    if (passportState.counters.successful_settlements < constraints.min_successful_settlements) {
      violations.push(
        `successful_settlements ${passportState.counters.successful_settlements} < min ${constraints.min_successful_settlements}`
      );
    }
  }

  // Check max_disputes_lost
  if (constraints.max_disputes_lost !== undefined) {
    referencedFields.push("counters.disputes_lost");
    if (passportState.counters.disputes_lost > constraints.max_disputes_lost) {
      violations.push(
        `disputes_lost ${passportState.counters.disputes_lost} > max ${constraints.max_disputes_lost}`
      );
    }
  }

  // Check max_sla_violations
  if (constraints.max_sla_violations !== undefined) {
    referencedFields.push("counters.sla_violations");
    if (passportState.counters.sla_violations > constraints.max_sla_violations) {
      violations.push(
        `sla_violations ${passportState.counters.sla_violations} > max ${constraints.max_sla_violations}`
      );
    }
  }

  // Check max_policy_aborts
  if (constraints.max_policy_aborts !== undefined) {
    referencedFields.push("counters.policy_aborts");
    if (passportState.counters.policy_aborts > constraints.max_policy_aborts) {
      violations.push(
        `policy_aborts ${passportState.counters.policy_aborts} > max ${constraints.max_policy_aborts}`
      );
    }
  }

  // If no violations, pass
  if (violations.length === 0) {
    return null;
  }

  // Generate evidence with state hash
  const canonical = stableCanonicalize(passportState);
  const hash = hashMessageSync(canonical);
  const stateHash = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const evidence: PassportGatingEvidence = {
    passport_v1_state_hash: stateHash,
    passport_v1_referenced_fields: referencedFields,
    passport_v1_signer_key: signerKey,
  };

  return {
    evidence,
    reason: `Passport v1 constraints violated: ${violations.join("; ")}`,
  };
}
