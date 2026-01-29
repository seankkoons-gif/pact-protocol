/**
 * Pact Boundary Runtime
 * 
 * Mandatory execution envelope that enforces policy, records evidence,
 * and standardizes abort semantics for agent spending.
 * 
 * Any agent action that may result in spending MUST occur inside a Pact Boundary.
 */

import type { PactPolicyV4, PolicyEvaluationContext, PolicyResult } from "../policy/v4";
export type { PactPolicyV4 } from "../policy/v4";
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
import { checkVelocityLimit, recordVelocitySuccess } from "./velocity";

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

  // Optional audit tier metadata (informational only; default T1)
  if (policy.audit) {
    transcript = {
      ...transcript,
      metadata: {
        ...transcript.metadata,
        audit_tier: policy.audit.tier ?? "T1",
        audit_sla: policy.audit.sla,
      },
    };
  }

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

      // Velocity/burst limits (prevention plane): check before settlement; abort PACT-101 if exceeded
      if (policy.velocity && options?.buyerAgentId) {
        const amount = result.offer_price ?? result.bid_price ?? 0;
        const nowMs = Date.now();
        const velocityResult = checkVelocityLimit(
          options.buyerAgentId,
          policy.velocity,
          nowMs,
          amount,
          options.sellerAgentId
        );
        if (!velocityResult.allowed) {
          evidenceRefs.push(velocityResult.reason ?? "velocity.exceeded");
          abort(velocityResult.reason ?? "Velocity limit exceeded", "PACT-101");
        }
      }

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

      // Record velocity success only after all checks pass (so we only count actual settlements)
      if (policy.velocity && options?.buyerAgentId) {
        const amount = result.offer_price ?? result.bid_price ?? 0;
        recordVelocitySuccess(
          options.buyerAgentId,
          Date.now(),
          amount,
          options.sellerAgentId
        );
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
      
      // Map failure code to appropriate stage and fault_domain
      const { stage, fault_domain } = mapFailureCodeToStageAndFaultDomain(finalFailureCode, finalAbortReason);
      
      const failureEvent: FailureEvent = {
        code: finalFailureCode,
        stage,
        fault_domain,
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
 * Map failure code to appropriate stage and fault_domain
 * 
 * This ensures proper taxonomy classification based on failure code.
 * PACT-404 is reserved for settlement timeout/SLA violations.
 * PACT-420 is for provider unreachable during quote requests.
 */
function mapFailureCodeToStageAndFaultDomain(
  code: string,
  reason: string
): { stage: string; fault_domain: string } {
  // PACT-4xx: Settlement/Rail Failures
  if (code === "PACT-404" || code === "PACT-405" || code === "PACT-407") {
    // PACT-404: Settlement timeout/SLA violation (reserved for settlement stage)
    // PACT-405: Settlement timeout
    // PACT-407: Settlement SLA violation
    return { stage: "settlement", fault_domain: "settlement" };
  }
  
  // PACT-420: Provider unreachable during quote request
  if (code === "PACT-420") {
    return { stage: "negotiation", fault_domain: "PROVIDER_AT_FAULT" };
  }

  // PACT-421: Provider API mismatch (endpoint not found)
  if (code === "PACT-421") {
    return { stage: "negotiation", fault_domain: "PROVIDER_AT_FAULT" };
  }
  
  // PACT-3xx: Negotiation failures
  if (code.startsWith("PACT-3")) {
    // Check if it's provider unavailable (PACT-310)
    if (code === "PACT-310") {
      return { stage: "discovery", fault_domain: "negotiation" };
    }
    return { stage: "negotiation", fault_domain: "negotiation" };
  }
  
  // PACT-2xx: Identity failures
  if (code.startsWith("PACT-2")) {
    return { stage: "admission", fault_domain: "identity" };
  }
  
  // PACT-1xx: Policy violations (default)
  if (code.startsWith("PACT-1")) {
    return { stage: "negotiation", fault_domain: "policy" };
  }
  
  // PACT-5xx: Recursive/Dependency failures
  if (code.startsWith("PACT-5")) {
    return { stage: "negotiation", fault_domain: "recursive" };
  }
  
  // Default: assume policy violation for unknown codes
  return { stage: "negotiation", fault_domain: "policy" };
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
