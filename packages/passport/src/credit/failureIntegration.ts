/**
 * Credit Failure Taxonomy Integration
 * 
 * Integrates credit checks with Pact v4 failure taxonomy to emit proper failure events.
 */

import type { CreditDecision } from "./types";
import type { FailureEvent } from "../types";

/**
 * Map credit denial to failure event.
 * 
 * If credit is denied, this function returns a failure event that should be
 * emitted in the transcript. The failure event follows the Pact v4 failure taxonomy.
 */
export function mapCreditDenialToFailureEvent(
  creditDecision: CreditDecision,
  agentId: string,
  transcriptHash: string,
  timestamp: number
): FailureEvent | null {
  // If credit is allowed, no failure event
  if (creditDecision.allowed) {
    return null;
  }

  // Determine failure code based on reason codes
  let failureCode = "PACT-101"; // Default: policy violation
  let faultDomain = "policy";
  let stage = "commitment"; // Credit checks happen at commitment stage

  // Check for specific reason codes
  if (creditDecision.reason_codes.includes("PACT-1xx_VIOLATION")) {
    failureCode = "PACT-101";
    faultDomain = "policy";
    stage = "admission"; // Kill switch triggered at admission
  } else if (creditDecision.reason_codes.includes("IDENTITY_FAILURE")) {
    failureCode = "PACT-201";
    faultDomain = "identity";
    stage = "admission";
  } else if (creditDecision.reason_codes.includes("TIER_TOO_LOW")) {
    failureCode = "PACT-101";
    faultDomain = "policy";
    stage = "commitment";
  } else if (
    creditDecision.reason_codes.includes("OUTSTANDING_EXPOSURE_EXCEEDED") ||
    creditDecision.reason_codes.includes("PER_INTENT_EXPOSURE_EXCEEDED") ||
    creditDecision.reason_codes.includes("PER_COUNTERPARTY_EXPOSURE_EXCEEDED")
  ) {
    failureCode = "PACT-101";
    faultDomain = "policy";
    stage = "commitment";
  } else if (creditDecision.reason_codes.includes("KILL_SWITCH_TRIGGERED")) {
    failureCode = "PACT-101";
    faultDomain = "policy";
    stage = "admission";
  }

  // Build evidence references
  const evidenceRefs: string[] = [
    `credit_decision:${agentId}:${transcriptHash}`,
    ...creditDecision.reason_codes.map((code) => `credit_denial:${code}`),
  ];

  return {
    code: failureCode,
    stage,
    fault_domain: faultDomain,
    terminality: "terminal",
    evidence_refs: evidenceRefs,
    timestamp,
    transcript_hash: transcriptHash,
  };
}

/**
 * Check if a failure code should trigger credit kill switch.
 * 
 * This function determines if a failure code (from failure taxonomy) should
 * trigger a credit kill switch when encountered in a transcript.
 */
export function shouldTriggerCreditKillSwitch(failureCode: string): boolean {
  // PACT-1xx: Policy violations (trigger kill switch)
  if (failureCode.startsWith("PACT-1")) {
    return true;
  }

  // PACT-2xx: Identity failures (trigger kill switch)
  if (failureCode.startsWith("PACT-2")) {
    return true;
  }

  // PACT-4xx: Settlement failures (may downgrade, not hard kill unless excessive)
  // This is handled separately in computeCreditTerms

  return false;
}
