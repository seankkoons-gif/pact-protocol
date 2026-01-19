/**
 * Credit Risk Engine
 * 
 * Deterministic credit terms computation and credit extension checks.
 */

import type { PassportStorage } from "../storage";
import type {
  CreditTerms,
  CreditDecision,
  CreditTier,
  PerCounterpartyExposure,
} from "./types";

// Kill switch window defaults (in milliseconds)
const KILL_SWITCH_WINDOW_POLICY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const KILL_SWITCH_WINDOW_IDENTITY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const KILL_SWITCH_WINDOW_DISPUTE_MS = 60 * 24 * 60 * 60 * 1000; // 60 days
const SETTLEMENT_FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const SETTLEMENT_FAILURE_HARD_KILL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Settlement failure thresholds
const SETTLEMENT_FAILURE_DOWNGRADE_THRESHOLD = 3; // 3+ failures in 7 days → downgrade
const SETTLEMENT_FAILURE_HARD_KILL_THRESHOLD = 10; // 10+ failures in 30 days → hard kill

/**
 * Compute credit tier from Passport score and confidence.
 */
function computeTier(score: number, confidence: number): CreditTier {
  // Tier C: score < 70 OR confidence < 0.6
  if (score < 70 || confidence < 0.6) {
    return "C";
  }

  // Tier A: score >= 85 AND confidence >= 0.8
  if (score >= 85 && confidence >= 0.8) {
    return "A";
  }

  // Tier B: score >= 70 AND score < 85 AND confidence >= 0.7
  if (score >= 70 && score < 85 && confidence >= 0.7) {
    return "B";
  }

  // Default to Tier C if no match
  return "C";
}

/**
 * Get credit terms for a tier.
 */
function getTierTerms(tier: CreditTier): Omit<CreditTerms, "tier" | "disabled_until" | "reason"> {
  switch (tier) {
    case "A":
      return {
        max_outstanding_exposure_usd: 5000,
        max_per_intent_usd: 2000,
        max_per_counterparty_usd: 1000,
        collateral_ratio: 0.2, // 20% collateral
        required_escrow: false,
      };
    case "B":
      return {
        max_outstanding_exposure_usd: 1000,
        max_per_intent_usd: 500,
        max_per_counterparty_usd: 200,
        collateral_ratio: 0.5, // 50% collateral
        required_escrow: true,
      };
    case "C":
      return {
        max_outstanding_exposure_usd: 0,
        max_per_intent_usd: 0,
        max_per_counterparty_usd: 0,
        collateral_ratio: 1.0, // 100% collateral (no credit)
        required_escrow: true,
      };
  }
}

/**
 * Check kill switch status for an agent.
 */
function checkKillSwitch(
  agentId: string,
  storage: PassportStorage,
  asOf: number
): { disabled_until?: number; reason?: string } {
  // Check for PACT-1xx violations (policy violations)
  const policyFailures = storage.getRecentFailures(
    agentId,
    KILL_SWITCH_WINDOW_POLICY_MS,
    "PACT-1%"
  );
  if (policyFailures.length > 0) {
    return {
      disabled_until: asOf + KILL_SWITCH_WINDOW_POLICY_MS,
      reason: "PACT-1xx_VIOLATION",
    };
  }

  // Check for PACT-2xx violations (identity failures)
  const identityFailures = storage.getRecentFailures(
    agentId,
    KILL_SWITCH_WINDOW_IDENTITY_MS,
    "PACT-2%"
  );
  if (identityFailures.length > 0) {
    return {
      disabled_until: asOf + KILL_SWITCH_WINDOW_IDENTITY_MS,
      reason: "IDENTITY_FAILURE",
    };
  }

  // Check for excessive PACT-4xx failures (settlement failures)
  const recentSettlementFailures = storage.getRecentFailures(
    agentId,
    SETTLEMENT_FAILURE_WINDOW_MS,
    "PACT-4%"
  );
  const longTermSettlementFailures = storage.getRecentFailures(
    agentId,
    SETTLEMENT_FAILURE_HARD_KILL_WINDOW_MS,
    "PACT-4%"
  );

  // Hard kill if 10+ failures in 30 days
  if (longTermSettlementFailures.length >= SETTLEMENT_FAILURE_HARD_KILL_THRESHOLD) {
    return {
      disabled_until: asOf + SETTLEMENT_FAILURE_HARD_KILL_WINDOW_MS,
      reason: "SETTLEMENT_FAILURES_EXCESSIVE",
    };
  }

  // Note: Downgrade for 3+ failures in 7 days is handled in tier computation
  // (not a hard kill, just tier reduction)

  return {};
}

/**
 * Check dispute losses (may downgrade tier, not hard kill).
 */
function checkDisputeLosses(
  agentId: string,
  storage: PassportStorage,
  asOf: number
): { downgrade?: boolean; reason?: string } {
  // Check for dispute losses (agent at fault)
  // Note: We need to determine if agent is buyer or seller from dispute outcome
  // For now, we check for any dispute outcomes and let the caller determine fault
  const disputeLosses = storage.getRecentDisputes(agentId, KILL_SWITCH_WINDOW_DISPUTE_MS);

  // Filter for losses (this is simplified - in production, we'd need to check agent role)
  // For now, we'll check if there are any disputes and let the caller handle it
  if (disputeLosses.length > 0) {
    // In a real implementation, we'd check if agent is at fault
    // For now, we'll return a flag that indicates potential downgrade
    return {
      downgrade: true,
      reason: "DISPUTE_LOSS",
    };
  }

  return {};
}

/**
 * Compute credit terms for an agent.
 */
export function computeCreditTerms(
  agentId: string,
  storage: PassportStorage,
  passportScore: number,
  passportConfidence: number,
  asOf: number = Date.now()
): CreditTerms {
  // Compute base tier from Passport score and confidence
  let tier = computeTier(passportScore, passportConfidence);

  // Check kill switch status
  const killSwitch = checkKillSwitch(agentId, storage, asOf);
  if (killSwitch.disabled_until) {
    // Kill switch triggered - downgrade to Tier C
    tier = "C";
  } else {
    // Check for settlement failures (may downgrade tier)
    const recentSettlementFailures = storage.getRecentFailures(
      agentId,
      SETTLEMENT_FAILURE_WINDOW_MS,
      "PACT-4%"
    );
    if (recentSettlementFailures.length >= SETTLEMENT_FAILURE_DOWNGRADE_THRESHOLD) {
      // Downgrade by one tier
      if (tier === "A") {
        tier = "B";
      } else if (tier === "B") {
        tier = "C";
      }
    }

    // Check for dispute losses (may downgrade tier)
    const disputeCheck = checkDisputeLosses(agentId, storage, asOf);
    if (disputeCheck.downgrade) {
      // Downgrade by one tier
      if (tier === "A") {
        tier = "B";
      } else if (tier === "B") {
        tier = "C";
      }
    }
  }

  // Get tier terms
  const tierTerms = getTierTerms(tier);

  // Return credit terms
  return {
    tier,
    ...tierTerms,
    disabled_until: killSwitch.disabled_until,
    reason: killSwitch.reason,
  };
}

/**
 * Check if credit can be extended to an agent.
 */
export function canExtendCredit(
  agentId: string,
  counterpartyId: string,
  amountUsd: number,
  storage: PassportStorage,
  passportScore: number,
  passportConfidence: number,
  asOf: number = Date.now()
): CreditDecision {
  const reasonCodes: string[] = [];

  // Compute credit terms
  const terms = computeCreditTerms(agentId, storage, passportScore, passportConfidence, asOf);

  // Check kill switch
  if (terms.disabled_until && terms.disabled_until > asOf) {
    reasonCodes.push(terms.reason || "KILL_SWITCH_TRIGGERED");
    return {
      allowed: false,
      required_collateral_usd: amountUsd, // 100% collateral required
      reason_codes: reasonCodes,
    };
  }

  // Check tier eligibility (Tier C = no credit)
  if (terms.tier === "C") {
    reasonCodes.push("TIER_TOO_LOW");
    return {
      allowed: false,
      required_collateral_usd: amountUsd, // 100% collateral required
      reason_codes: reasonCodes,
    };
  }

  // Get current exposure
  const exposure = storage.getCreditExposure(agentId);
  const outstandingUsd = exposure?.outstanding_usd || 0;
  const perCounterpartyJson = exposure?.per_counterparty_json || "{}";
  let perCounterparty: PerCounterpartyExposure = {};
  try {
    perCounterparty = JSON.parse(perCounterpartyJson);
  } catch {
    perCounterparty = {};
  }
  const perCounterpartyUsd = perCounterparty[counterpartyId] || 0;

  // Compute credit exposure for this commitment
  const requiredCollateralUsd = amountUsd * terms.collateral_ratio;
  const creditExposureUsd = amountUsd - requiredCollateralUsd;

  // Check outstanding exposure cap
  const newOutstandingUsd = outstandingUsd + creditExposureUsd;
  if (newOutstandingUsd > terms.max_outstanding_exposure_usd) {
    reasonCodes.push("OUTSTANDING_EXPOSURE_EXCEEDED");
  }

  // Check per-intent exposure cap
  if (creditExposureUsd > terms.max_per_intent_usd) {
    reasonCodes.push("PER_INTENT_EXPOSURE_EXCEEDED");
  }

  // Check per-counterparty exposure cap
  const newPerCounterpartyUsd = perCounterpartyUsd + creditExposureUsd;
  if (newPerCounterpartyUsd > terms.max_per_counterparty_usd) {
    reasonCodes.push("PER_COUNTERPARTY_EXPOSURE_EXCEEDED");
  }

  // If any checks failed, deny credit
  if (reasonCodes.length > 0) {
    return {
      allowed: false,
      required_collateral_usd: amountUsd, // 100% collateral required if credit denied
      reason_codes: reasonCodes,
    };
  }

  // Credit allowed
  return {
    allowed: true,
    required_collateral_usd: requiredCollateralUsd,
    reason_codes: [],
  };
}

/**
 * Apply credit event from transcript (idempotent).
 * 
 * This function extracts credit-relevant information from a transcript and updates
 * credit exposure. It should be called after a commitment is formed (ACCEPT) or
 * after a failure occurs.
 */
export function applyCreditEventFromTranscript(
  transcript: {
    transcript_id: string;
    transcript_hash?: string;
    final_hash?: string;
    created_at_ms: number;
    failure_event?: {
      code: string;
      transcript_hash: string;
    };
    rounds?: Array<{
      round_type: string;
      content_summary?: {
        price?: number;
        agreed_price?: number;
      };
    }>;
  },
  agentId: string,
  counterpartyId: string | null,
  commitmentAmountUsd: number,
  collateralAmountUsd: number,
  storage: PassportStorage
): void {
  // Use transcript_hash if available, otherwise use final_hash or transcript_id
  const transcriptHash =
    transcript.failure_event?.transcript_hash ||
    transcript.transcript_hash ||
    transcript.final_hash ||
    transcript.transcript_id;

  // Check idempotency (skip if already processed)
  if (storage.hasCreditEvent(transcriptHash, agentId)) {
    return; // Already processed
  }

  // Determine credit event type and delta
  let deltaUsd = 0;
  let reasonCode: "CREDIT_EXTENDED" | "CREDIT_DENIED" | "SETTLEMENT" | "FAILURE" =
    "CREDIT_DENIED";

  if (transcript.failure_event) {
    // Failure event - credit exposure is released (negative delta)
    // The credit exposure that was extended is now lost
    const creditExposureUsd = commitmentAmountUsd - collateralAmountUsd;
    deltaUsd = -creditExposureUsd; // Negative: exposure released
    reasonCode = "FAILURE";
  } else {
    // Check if there's an ACCEPT round (commitment formed)
    const acceptRound = transcript.rounds?.find((r) => r.round_type === "ACCEPT");
    if (acceptRound && commitmentAmountUsd > 0) {
      // Commitment formed - credit extended (positive delta)
      const creditExposureUsd = commitmentAmountUsd - collateralAmountUsd;
      if (creditExposureUsd > 0) {
        deltaUsd = creditExposureUsd; // Positive: credit extended
        reasonCode = "CREDIT_EXTENDED";
      } else {
        // No credit (100% collateral)
        reasonCode = "CREDIT_DENIED";
      }
    } else {
      // Settlement completed (no failure, no new commitment)
      // Credit exposure is released (negative delta)
      const creditExposureUsd = commitmentAmountUsd - collateralAmountUsd;
      if (creditExposureUsd > 0) {
        deltaUsd = -creditExposureUsd; // Negative: exposure released
        reasonCode = "SETTLEMENT";
      }
    }
  }

  // Insert credit event (idempotent)
  storage.insertCreditEvent({
    agent_id: agentId,
    ts: transcript.created_at_ms,
    transcript_hash: transcriptHash,
    delta_usd: deltaUsd,
    counterparty_agent_id: counterpartyId,
    reason_code: reasonCode,
  });

  // Update exposure (if delta is non-zero)
  if (deltaUsd !== 0) {
    const exposure = storage.getCreditExposure(agentId);
    const outstandingUsd = (exposure?.outstanding_usd || 0) + deltaUsd;
    const perCounterpartyJson = exposure?.per_counterparty_json || "{}";
    let perCounterparty: PerCounterpartyExposure = {};
    try {
      perCounterparty = JSON.parse(perCounterpartyJson);
    } catch {
      perCounterparty = {};
    }

    if (counterpartyId) {
      perCounterparty[counterpartyId] = (perCounterparty[counterpartyId] || 0) + deltaUsd;
      if (perCounterparty[counterpartyId] <= 0) {
        delete perCounterparty[counterpartyId];
      }
    }

    storage.upsertCreditExposure(
      agentId,
      Math.max(0, outstandingUsd),
      JSON.stringify(perCounterparty),
      Date.now()
    );
  }
}
