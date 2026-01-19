/**
 * Pact Boundary Runtime
 * 
 * Mandatory execution envelope that enforces policy, records evidence,
 * and standardizes abort semantics for agent spending.
 * 
 * Any agent action that may result in spending MUST occur inside a Pact Boundary.
 */

import type { PactPolicyV4, PolicyEvaluationContext, PolicyResult } from "../policy/v4";
import { evaluatePolicy, computePolicyHash } from "../policy/v4";
import type { TranscriptV4, FailureEvent } from "../transcript/v4/replay";
import { createTranscriptV4 } from "../transcript/v4/transcript";
import type { PassportStorage } from "@pact/passport";
import {
  evaluateCreditBeforeSettlement,
  createCreditFailureEvent,
  type CreditEvaluationContext,
  type CreditEvaluationResult,
} from "./credit";

/**
 * Intent definition for boundary execution
 */
export interface BoundaryIntent {
  intent_id: string;
  intent_type: string;
  created_at_ms: number;
  params?: Record<string, any>;
}

/**
 * Execution function that runs inside boundary
 */
export interface ExecuteFunction {
  (context: BoundaryExecutionContext): Promise<BoundaryExecutionResult>;
}

/**
 * Context provided to execution function
 */
export interface BoundaryExecutionContext {
  transcript: TranscriptV4;
  policy_hash: string;
  round_number: number;
  abort: (reason: string, failureCode?: string) => never;
}

/**
 * Result from execution function
 */
export interface BoundaryExecutionResult {
  success: boolean;
  offer_price?: number;
  bid_price?: number;
  settlement_mode?: "boundary" | "stripe" | "escrow";
  data?: any;
}

/**
 * Boundary execution result
 */
export interface BoundaryResult {
  transcript: TranscriptV4;
  success: boolean;
  failure_event?: FailureEvent;
  policy_hash: string;
  evidence_refs: string[];
}

/**
 * Run execution inside Pact Boundary with policy enforcement.
 * 
 * Behavior:
 * - Load and hash policy
 * - Initialize transcript
 * - During each negotiation round: evaluate policy deterministically
 * - If violation: abort immediately, emit FailureEvent
 * - Before settlement: re-evaluate policy against final terms
 * - Before settlement: evaluate credit eligibility (if Passport storage provided)
 * - On abort: ensure clean termination, ensure refunds/no-ops
 * 
 * @param intent Intent definition
 * @param policy Policy v4 object
 * @param executeFn Execution function
 * @param options Optional configuration (Passport storage for credit checks)
 * @returns Boundary result with transcript and status
 */
export async function runInPactBoundary(
  intent: BoundaryIntent,
  policy: PactPolicyV4,
  executeFn: ExecuteFunction,
  options?: {
    passportStorage?: PassportStorage;
    passportScore?: number;
    passportConfidence?: number;
    buyerAgentId?: string;
    sellerAgentId?: string;
  }
): Promise<BoundaryResult> {
  // Compute policy hash (deterministic)
  const policyHash = computePolicyHash(policy);

  // Initialize transcript
  let transcript = createTranscriptV4({
    intent_id: intent.intent_id,
    intent_type: intent.intent_type,
    created_at_ms: intent.created_at_ms,
    policy_hash: policyHash,
    strategy_hash: "", // Set by executeFn if needed
    identity_snapshot_hash: "", // Set by executeFn if needed
  });

  const evidenceRefs: string[] = [];
  let roundNumber = 0;
  let abortReason: string | null = null;
  let failureCode: string | null = null;

  // Abort function (throwing, deterministic)
  const abort = (reason: string, code: string = "PACT-101"): never => {
    abortReason = reason;
    failureCode = code;
    throw new BoundaryAbortError(reason, code);
  };

  try {
    // Create execution context
    const context: BoundaryExecutionContext = {
      transcript,
      policy_hash: policyHash,
      round_number: roundNumber,
      abort,
    };

    // Execute function (may call abort)
    const result = await executeFn(context);

    // Final policy evaluation before settlement (if success)
    if (result.success) {
      const finalContext: PolicyEvaluationContext = {
        offer_price: result.offer_price,
        bid_price: result.bid_price,
        settlement_mode: result.settlement_mode,
        intent_type: intent.intent_type,
        negotiation_round: roundNumber,
        transcript_created_at_ms: intent.created_at_ms,
      };

      const policyResult = evaluatePolicy(policy, finalContext);

      if (!policyResult.allowed) {
        // Add evidence refs BEFORE abort (so they're included in failure event)
        evidenceRefs.push(...policyResult.evidence_refs);
        
        // Policy violation before settlement - abort
        abort(`Policy violation before settlement: ${policyResult.violated_rules.map((r) => r.rule_name).join(", ")}`, "PACT-101");
      }

      // Add evidence refs from final evaluation (for success case)
      evidenceRefs.push(...policyResult.evidence_refs);

      // Credit evaluation before settlement (if Passport storage provided)
      if (options?.passportStorage && options.passportScore !== undefined && options.passportConfidence !== undefined) {
        const commitmentAmount = result.offer_price || result.bid_price || 0;
        if (commitmentAmount > 0 && options.buyerAgentId && options.sellerAgentId) {
          const creditContext: CreditEvaluationContext = {
            agent_id: options.buyerAgentId,
            counterparty_id: options.sellerAgentId,
            commitment_amount_usd: commitmentAmount,
            passport_score: options.passportScore,
            passport_confidence: options.passportConfidence,
            as_of_ms: intent.created_at_ms,
          };

          const creditResult = evaluateCreditBeforeSettlement(options.passportStorage, creditContext);

          // Add credit evidence refs to transcript
          evidenceRefs.push(...creditResult.evidence_refs);

          // If credit denied, create failure event and abort
          if (!creditResult.decision.allowed) {
            const creditFailureEvent = createCreditFailureEvent(creditResult, transcript, Date.now());
            if (creditFailureEvent) {
              // Abort with credit denial
              abort(
                `Credit denied: ${creditResult.decision.reason_codes.join(", ")}`,
                creditFailureEvent.code
              );
            }
          }
        }
      }
    }

    // Success - return transcript (execution function updates it)
    return {
      transcript,
      success: true,
      policy_hash: policyHash,
      evidence_refs: evidenceRefs,
    };
  } catch (error) {
    if (error instanceof BoundaryAbortError) {
      // Abort - create failure event
      // Use error.failureCode from the BoundaryAbortError instance, fallback to outer failureCode or default
      const finalFailureCode = error.failureCode || failureCode || "PACT-101";
      const finalAbortReason = error.reason || abortReason || "Unknown abort";
      const failureEvent: FailureEvent = {
        code: finalFailureCode,
        stage: "negotiation",
        fault_domain: "policy",
        terminality: "terminal",
        timestamp: Date.now(),
        transcript_hash: transcript.transcript_id,
        evidence_refs: [
          ...evidenceRefs,
          `abort_reason:${finalAbortReason}`,
          `policy_hash:${policyHash}`,
        ],
      };

      // Attach failure event to transcript
      transcript = {
        ...transcript,
        failure_event: failureEvent,
        arbiter_decision_ref: null,
      };

      return {
        transcript,
        success: false,
        failure_event: failureEvent,
        policy_hash: policyHash,
        evidence_refs: evidenceRefs,
      };
    }

    // Unexpected error - rethrow
    throw error;
  }
}

/**
 * Evaluate policy at negotiation round.
 * 
 * Called by executeFn during negotiation to check policy before proceeding.
 * 
 * @param policy Policy v4 object
 * @param context Policy evaluation context
 * @returns Policy evaluation result
 */
export function evaluatePolicyAtRound(
  policy: PactPolicyV4,
  context: PolicyEvaluationContext
): PolicyResult {
  return evaluatePolicy(policy, context);
}

/**
 * Boundary abort error (throwing, deterministic)
 */
export class BoundaryAbortError extends Error {
  constructor(
    public readonly reason: string,
    public readonly failureCode: string
  ) {
    super(`Boundary abort: ${reason} (${failureCode})`);
    this.name = "BoundaryAbortError";
  }
}
