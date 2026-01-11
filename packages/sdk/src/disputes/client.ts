/**
 * Dispute Client Functions
 * 
 * Functions for opening and resolving disputes.
 */

import { randomBytes } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { PactPolicy } from "../policy/types";
import type { Receipt } from "../exchange/receipt";
import type { SettlementProvider } from "../settlement/provider";
import type { DisputeRecord, DisputeOutcome } from "./types";
import type { TranscriptV1 } from "../transcript/types";
import { createDispute, loadDispute, updateDispute } from "./store";

export interface OpenDisputeParams {
  receipt: Receipt;
  reason: string;
  now: number;
  policy: PactPolicy;
  transcriptPath?: string;
  settlementMeta?: {
    settlement_provider?: string;
    settlement_handle_id?: string;
  };
  disputeDir?: string;
}

export interface ResolveDisputeParams {
  dispute_id: string;
  outcome: DisputeOutcome;
  refund_amount?: number;
  notes?: string;
  now: number;
  policy: PactPolicy;
  settlementProvider: SettlementProvider;
  receipt: Receipt; // v1.6.8+: Receipt must include buyer/seller ids and paid_amount (C2)
  disputeDir?: string;
  transcriptPath?: string; // v1.6.8+: Optional transcript path for dispute events (C2)
}

/**
 * Open a dispute against a receipt.
 */
export function openDispute(params: OpenDisputeParams): DisputeRecord {
  const { receipt, reason, now, policy, transcriptPath, settlementMeta, disputeDir } = params;
  
  // Check if disputes are enabled
  const disputesConfig = policy.base.disputes;
  if (!disputesConfig || !disputesConfig.enabled) {
    throw new Error("Disputes are not enabled in policy");
  }
  
  // Check if window_ms is set
  if (disputesConfig.window_ms <= 0) {
    throw new Error("Dispute window_ms must be > 0");
  }
  
  // Check if dispute is within window
  const receiptAge = now - receipt.timestamp_ms;
  if (receiptAge > disputesConfig.window_ms) {
    throw new Error(`Dispute window expired. Receipt age: ${receiptAge}ms, window: ${disputesConfig.window_ms}ms`);
  }
  
  // Generate dispute ID
  const randomSuffix = randomBytes(8).toString("hex");
  const disputeId = `dispute-${receipt.receipt_id}-${randomSuffix}`;
  
  // Compute deadline
  const deadlineAtMs = receipt.timestamp_ms + disputesConfig.window_ms;
  
  // Build evidence flags
  const evidence = {
    transcript: transcriptPath !== undefined,
    receipt: true, // Always have receipt
    settlement_events: settlementMeta?.settlement_handle_id !== undefined,
  };
  
  // Create dispute record
  const dispute: DisputeRecord = {
    dispute_id: disputeId,
    receipt_id: receipt.receipt_id,
    intent_id: receipt.intent_id,
    buyer_agent_id: receipt.buyer_agent_id,
    seller_agent_id: receipt.seller_agent_id,
    opened_at_ms: now,
    deadline_at_ms: deadlineAtMs,
    reason,
    transcript_path: transcriptPath,
    settlement_provider: settlementMeta?.settlement_provider,
    settlement_handle_id: settlementMeta?.settlement_handle_id,
    status: "OPEN",
    evidence,
  };
  
  // Store dispute
  createDispute(dispute, disputeDir);
  
  return dispute;
}

/**
 * Resolve a dispute (v1.6.8+, C2).
 * Executes refund via settlement provider and updates dispute record.
 */
export async function resolveDispute(params: ResolveDisputeParams): Promise<{ ok: boolean; record?: DisputeRecord; code?: string; reason?: string }> {
  const { dispute_id, outcome, refund_amount, notes, now, policy, settlementProvider, receipt, disputeDir, transcriptPath } = params;
  
  // Load dispute
  const dispute = loadDispute(dispute_id, disputeDir);
  if (!dispute) {
    return {
      ok: false,
      code: "DISPUTE_NOT_FOUND",
      reason: `Dispute ${dispute_id} not found`,
    };
  }
  
  // Check status
  if (dispute.status !== "OPEN") {
    return {
      ok: false,
      code: "DISPUTE_NOT_OPEN",
      reason: `Dispute ${dispute_id} is not OPEN (status: ${dispute.status})`,
    };
  }
  
  // Get disputes config
  const disputesConfig = policy.base.disputes;
  if (!disputesConfig || !disputesConfig.enabled) {
    return {
      ok: false,
      code: "DISPUTES_NOT_ENABLED",
      reason: "Disputes are not enabled in policy",
    };
  }
  
  // Get paid amount from receipt (use paid_amount if present, otherwise agreed_price)
  const paidAmount = receipt.paid_amount ?? receipt.agreed_price;
  
  // Determine refund amount based on outcome
  let actualRefundAmount: number = 0;
  if (outcome === "NO_REFUND") {
    actualRefundAmount = 0;
  } else if (outcome === "REFUND_FULL") {
    // Full refund: min(paid_amount, agreed_price) capped by max_refund_pct
    const maxRefundAllowed = paidAmount * disputesConfig.max_refund_pct;
    actualRefundAmount = Math.min(paidAmount, receipt.agreed_price, maxRefundAllowed);
  } else if (outcome === "REFUND_PARTIAL") {
    if (!disputesConfig.allow_partial) {
      return {
        ok: false,
        code: "PARTIAL_REFUND_NOT_ALLOWED",
        reason: "Partial refunds are not allowed in policy",
      };
    }
    if (refund_amount === undefined || refund_amount <= 0) {
      return {
        ok: false,
        code: "INVALID_REFUND_AMOUNT",
        reason: "refund_amount must be > 0 for partial refund",
      };
    }
    // Validate: refund_amount <= paid_amount and <= max_refund_pct * paid_amount
    const maxRefundAllowed = paidAmount * disputesConfig.max_refund_pct;
    if (refund_amount > paidAmount) {
      return {
        ok: false,
        code: "REFUND_EXCEEDS_PAID",
        reason: `Refund amount ${refund_amount} exceeds paid amount ${paidAmount}`,
      };
    }
    if (refund_amount > maxRefundAllowed) {
      return {
        ok: false,
        code: "REFUND_EXCEEDS_MAX_PCT",
        reason: `Refund amount ${refund_amount} exceeds max_refund_pct (${disputesConfig.max_refund_pct}) of paid amount`,
      };
    }
    actualRefundAmount = refund_amount;
  }
  
  // Execute refund if needed (v1.6.8+, C2: use first-class refund API)
  let refundResult: { ok: boolean; refunded_amount: number; code?: string; reason?: string } | undefined;
  if (actualRefundAmount > 0) {
    // Check if refund method exists (try new API first, fallback to legacy)
    if (typeof settlementProvider.refund === "function") {
      try {
        // Try new refund API (takes refund object)
        const refundParam = {
          dispute_id: dispute.dispute_id,
          from: dispute.seller_agent_id,
          to: dispute.buyer_agent_id,
          amount: actualRefundAmount,
          reason: notes,
          idempotency_key: dispute.dispute_id, // Use dispute_id as idempotency key
        };
        
        // Check if it's the new API (returns Promise) or legacy (void)
        const result = await (settlementProvider.refund as any)(refundParam);
        if (result && typeof result === "object" && "ok" in result) {
          // New API
          refundResult = result;
        } else {
          // Legacy API (void) - treat as success
          refundResult = { ok: true, refunded_amount: actualRefundAmount };
        }
      } catch (error: any) {
        // Legacy API throws - extract error message
        const errorMsg = error?.message || String(error);
        if (errorMsg.includes("REFUND_INSUFFICIENT_FUNDS")) {
          refundResult = {
            ok: false,
            refunded_amount: 0,
            code: "REFUND_INSUFFICIENT_FUNDS",
            reason: errorMsg,
          };
        } else {
          refundResult = {
            ok: false,
            refunded_amount: 0,
            code: "REFUND_FAILED",
            reason: errorMsg,
          };
        }
      }
    } else {
      return {
        ok: false,
        code: "REFUND_NOT_SUPPORTED",
        reason: "Settlement provider does not support refunds",
      };
    }
    
    // Check refund result
    if (!refundResult.ok) {
      return {
        ok: false,
        code: refundResult.code || "REFUND_FAILED",
        reason: refundResult.reason || "Refund failed",
      };
    }
    
    // Update actual refund amount from result (may differ due to idempotency)
    actualRefundAmount = refundResult.refunded_amount;
  }
  
  // Update dispute record
  dispute.status = "RESOLVED";
  dispute.outcome = outcome;
  dispute.refund_amount = actualRefundAmount;
  dispute.notes = notes;
  if (transcriptPath) {
    dispute.transcript_path = transcriptPath;
  }
  
  updateDispute(dispute, disputeDir);
  
  // v1.6.8+: Write dispute event to transcript if transcriptPath provided (C2)
  if (transcriptPath && fs.existsSync(transcriptPath)) {
    try {
      const transcriptContent = fs.readFileSync(transcriptPath, "utf-8");
      const transcript = JSON.parse(transcriptContent) as TranscriptV1;
      
      // Initialize dispute_events if not present
      if (!transcript.dispute_events) {
        transcript.dispute_events = [];
      }
      
      // Add dispute event
      transcript.dispute_events.push({
        ts_ms: now,
        dispute_id: dispute.dispute_id,
        outcome: outcome,
        refund_amount: actualRefundAmount,
        settlement_provider: dispute.settlement_provider,
        status: "resolved",
      });
      
      // Write updated transcript
      fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), "utf-8");
    } catch (error) {
      // Don't fail dispute resolution if transcript write fails
      // Just log (in production, might want to log this)
    }
  } else if (transcriptPath) {
    // Transcript path provided but file doesn't exist - create a minimal dispute event file
    // Write to .pact/transcripts/<intent_id>-dispute-<dispute_id>.json
    try {
      const transcriptDir = path.dirname(transcriptPath);
      const intentId = dispute.intent_id;
      const disputeEventPath = path.join(transcriptDir, `${intentId}-dispute-${dispute.dispute_id}.json`);
      
      const disputeEventTranscript: TranscriptV1 = {
        version: "1",
        intent_id: intentId,
        intent_type: "dispute_resolution",
        timestamp_ms: now,
        outcome: {
          ok: true,
        },
        dispute_events: [{
          ts_ms: now,
          dispute_id: dispute.dispute_id,
          outcome: outcome,
          refund_amount: actualRefundAmount,
          settlement_provider: dispute.settlement_provider,
          status: "resolved",
        }],
      };
      
      // Ensure directory exists
      if (!fs.existsSync(transcriptDir)) {
        fs.mkdirSync(transcriptDir, { recursive: true });
      }
      
      fs.writeFileSync(disputeEventPath, JSON.stringify(disputeEventTranscript, null, 2), "utf-8");
    } catch (error) {
      // Don't fail dispute resolution if transcript write fails
    }
  }
  
  return {
    ok: true,
    record: dispute,
  };
}

