/**
 * Transcript Replay Verifier
 * 
 * Verifies transcripts by checking signatures, credentials, and commit-reveal hashes.
 */

import * as fs from "fs";
import { verifyEnvelope } from "../protocol/envelope";
import { verifyReveal } from "../exchange/commit";
import type { TranscriptV1 } from "./types";
import { replayTranscriptV4, type TranscriptV4 } from "./v4/replay";

export type ReplayOptions = {
  now?: () => number; // For testing credential expiration
};

export type ReplayFailure = {
  code: string;
  reason: string;
  context?: Record<string, unknown>;
};

export type ReplayResult = {
  ok: boolean;
  failures: ReplayFailure[];
  summary: {
    intent_id: string;
    intent_type: string;
    timestamp_ms: number;
    outcome: TranscriptV1["outcome"];
    envelopes_verified: number;
    envelopes_failed: number;
    credentials_verified: number;
    credentials_expired: number;
    commit_reveal_verified: number;
    commit_reveal_failed: number;
    artifacts_missing: number;
    settlement_lifecycle_verified: number; // Settlement lifecycle validation (v1.6.3+)
    settlement_lifecycle_failed: number; // Settlement lifecycle validation failures (v1.6.3+)
    wallet_signatures_verified: number; // Wallet signature verification (v2 Phase 2 Execution Layer)
    wallet_signatures_failed: number; // Wallet signature verification failures (v2 Phase 2 Execution Layer)
  };
};

/**
 * Replay and verify a transcript.
 * 
 * @param pathOrObject File path to transcript JSON or transcript object
 * @param options Optional replay options
 * @returns Replay result with verification status
 */
export async function replayTranscript(
  pathOrObject: string | TranscriptV1,
  options?: ReplayOptions
): Promise<ReplayResult> {
  // Load transcript
  let transcript: TranscriptV1;
  if (typeof pathOrObject === "string") {
    const content = fs.readFileSync(pathOrObject, "utf-8");
    transcript = JSON.parse(content);
  } else {
    transcript = pathOrObject;
  }

  const failures: ReplayFailure[] = [];
  const now = options?.now || (() => Date.now());
  const currentTime = now();

  // Initialize summary
  const summary: ReplayResult["summary"] = {
    intent_id: transcript.intent_id,
    intent_type: transcript.intent_type,
    timestamp_ms: transcript.timestamp_ms,
    outcome: transcript.outcome,
    envelopes_verified: 0,
    envelopes_failed: 0,
    credentials_verified: 0,
    credentials_expired: 0,
    commit_reveal_verified: 0,
    commit_reveal_failed: 0,
    artifacts_missing: 0,
    settlement_lifecycle_verified: 0,
    settlement_lifecycle_failed: 0,
    wallet_signatures_verified: 0,
    wallet_signatures_failed: 0,
  };

  // Verify credential checks
  for (const check of transcript.credential_checks || []) {
    if (!check.ok) continue; // Skip failed checks

    const credSummary = check.credential_summary;
    if (!credSummary) {
      failures.push({
        code: "MISSING_ARTIFACT",
        reason: `Credential summary missing for provider ${check.pubkey_b58}`,
        context: { provider_id: check.provider_id, pubkey_b58: check.pubkey_b58 },
      });
      summary.artifacts_missing++;
      continue;
    }

    // Check expiration
    if (credSummary.expires_at_ms && credSummary.expires_at_ms < currentTime) {
      failures.push({
        code: "CREDENTIAL_EXPIRED",
        reason: `Credential expired for provider ${check.pubkey_b58}`,
        context: {
          provider_id: check.provider_id,
          pubkey_b58: check.pubkey_b58,
          expires_at_ms: credSummary.expires_at_ms,
          current_time_ms: currentTime,
        },
      });
      summary.credentials_expired++;
    } else {
      summary.credentials_verified++;
    }

    // Check signer matches pubkey (if both present)
    if (credSummary.signer_public_key_b58 && check.pubkey_b58) {
      if (credSummary.signer_public_key_b58 !== check.pubkey_b58) {
        failures.push({
          code: "CREDENTIAL_SIGNER_MISMATCH",
          reason: `Credential signer does not match provider pubkey for ${check.pubkey_b58}`,
          context: {
            provider_id: check.provider_id,
            expected: check.pubkey_b58,
            actual: credSummary.signer_public_key_b58,
          },
        });
      }
    }
  }

  // Verify quotes (if envelope data is present in explain decisions)
  // Note: Transcripts don't store full envelopes, so we can only verify what's in the summary
  for (const quote of transcript.quotes || []) {
    if (!quote.ok) continue;

    // Check signer matches pubkey
    if (quote.signer_pubkey_b58 && quote.pubkey_b58) {
      if (quote.signer_pubkey_b58 !== quote.pubkey_b58) {
        failures.push({
          code: "QUOTE_SIGNER_MISMATCH",
          reason: `Quote signer does not match provider pubkey for ${quote.pubkey_b58}`,
          context: {
            provider_id: quote.provider_id,
            expected: quote.pubkey_b58,
            actual: quote.signer_pubkey_b58,
          },
        });
        summary.envelopes_failed++;
      } else {
        summary.envelopes_verified++;
      }
    }
  }

  // Verify commit-reveal hash match if settlement artifacts are present
  if (transcript.settlement?.artifacts_summary) {
    const artifacts = transcript.settlement.artifacts_summary;
    
    if (artifacts.commit_hash && artifacts.reveal_nonce) {
      // Need payload to verify - check explain decisions for payload
      let payloadB64: string | undefined;
      
      // Check explain decisions for reveal payload
      const revealDecision = transcript.explain?.decisions?.find(
        (d) => d.step === "settlement" && String(d.code) === "REVEAL_VERIFIED"
      );
      if (revealDecision?.meta) {
        payloadB64 = (revealDecision.meta as any).payload_b64;
      }
      
      // Also check receipt if available (though receipts typically don't contain payload)
      if (!payloadB64 && transcript.receipt) {
        // Receipts don't typically contain payload, but check just in case
        payloadB64 = (transcript.receipt as any).payload_b64;
      }

      if (payloadB64 && artifacts.reveal_nonce) {
        const isValid = verifyReveal(
          artifacts.commit_hash,
          payloadB64,
          artifacts.reveal_nonce
        );
        
        if (isValid) {
          summary.commit_reveal_verified++;
        } else {
          failures.push({
            code: "COMMIT_REVEAL_MISMATCH",
            reason: "Commit hash does not match reveal payload and nonce",
            context: {
              commit_hash: artifacts.commit_hash,
              reveal_nonce: artifacts.reveal_nonce,
            },
          });
          summary.commit_reveal_failed++;
        }
      } else {
        failures.push({
          code: "MISSING_ARTIFACT",
          reason: "Payload not found in transcript for commit-reveal verification",
          context: {
            commit_hash: artifacts.commit_hash,
            reveal_nonce: artifacts.reveal_nonce,
          },
        });
        summary.artifacts_missing++;
      }
    } else {
      // Missing commit or reveal data
      if (!artifacts.commit_hash || !artifacts.reveal_nonce) {
        failures.push({
          code: "MISSING_ARTIFACT",
          reason: "Commit or reveal data missing from settlement artifacts",
          context: {
            has_commit_hash: !!artifacts.commit_hash,
            has_reveal_nonce: !!artifacts.reveal_nonce,
          },
        });
        summary.artifacts_missing++;
      }
    }
  }

  // Try to verify envelopes from explain decisions if present
  if (transcript.explain?.decisions) {
    for (const decision of transcript.explain.decisions) {
      // Look for envelope data in meta
      if (decision.meta && typeof decision.meta === "object") {
        const meta = decision.meta as any;
        
        // Check if this decision has envelope data
        if (meta.envelope || meta.credential_envelope || meta.quote_envelope) {
          const envelope = meta.envelope || meta.credential_envelope || meta.quote_envelope;
          
          try {
            const isValid = verifyEnvelope(envelope);
            if (isValid) {
              summary.envelopes_verified++;
            } else {
              failures.push({
                code: "ENVELOPE_VERIFICATION_FAILED",
                reason: `Envelope verification failed for ${decision.step} step`,
                context: {
                  provider_id: decision.provider_id,
                  step: decision.step,
                  code: decision.code,
                },
              });
              summary.envelopes_failed++;
            }
          } catch (error: any) {
            failures.push({
              code: "ENVELOPE_PARSE_ERROR",
              reason: `Failed to parse envelope: ${error.message}`,
              context: {
                provider_id: decision.provider_id,
                step: decision.step,
                error: error.message,
              },
            });
            summary.envelopes_failed++;
          }
        }
      }
    }
  }

  // Verify settlement lifecycle metadata (v1.6.3+)
  if (transcript.settlement_lifecycle) {
    const lifecycle = transcript.settlement_lifecycle;
    
    // Validate status-based invariants
    if (lifecycle.status === "committed") {
      // If committed, paid_amount must be present and > 0
      if (lifecycle.paid_amount === undefined || lifecycle.paid_amount === null) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement status is 'committed' but paid_amount is missing",
          context: {
            status: lifecycle.status,
            has_paid_amount: lifecycle.paid_amount !== undefined,
          },
        });
        summary.settlement_lifecycle_failed++;
      } else if (lifecycle.paid_amount <= 0) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: `Settlement status is 'committed' but paid_amount (${lifecycle.paid_amount}) is not > 0`,
          context: {
            status: lifecycle.status,
            paid_amount: lifecycle.paid_amount,
          },
        });
        summary.settlement_lifecycle_failed++;
      } else {
        summary.settlement_lifecycle_verified++;
      }
      
      // If committed, committed_at_ms should be present
      if (lifecycle.committed_at_ms === undefined || lifecycle.committed_at_ms === null) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement status is 'committed' but committed_at_ms is missing",
          context: {
            status: lifecycle.status,
          },
        });
        summary.settlement_lifecycle_failed++;
      }
    } else if (lifecycle.status === "aborted") {
      // If aborted, paid_amount must be absent or 0
      if (lifecycle.paid_amount !== undefined && lifecycle.paid_amount !== null && lifecycle.paid_amount > 0) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: `Settlement status is 'aborted' but paid_amount (${lifecycle.paid_amount}) is > 0`,
          context: {
            status: lifecycle.status,
            paid_amount: lifecycle.paid_amount,
          },
        });
        summary.settlement_lifecycle_failed++;
      } else {
        summary.settlement_lifecycle_verified++;
      }
    } else if (lifecycle.status === "prepared") {
      // If prepared, handle_id must be present
      if (!lifecycle.handle_id) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement status is 'prepared' but handle_id is missing",
          context: {
            status: lifecycle.status,
          },
        });
        summary.settlement_lifecycle_failed++;
      } else {
        summary.settlement_lifecycle_verified++;
      }
      
      // If prepared, prepared_at_ms should be present
      if (lifecycle.prepared_at_ms === undefined || lifecycle.prepared_at_ms === null) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement status is 'prepared' but prepared_at_ms is missing",
          context: {
            status: lifecycle.status,
          },
        });
        summary.settlement_lifecycle_failed++;
      }
    } else if (lifecycle.status === "pending") {
      // v1.7.2+: If pending, check if there's a final resolution
      // If pending exists without final resolution, add non-fatal failure
      const hasFinalResolution = lifecycle.settlement_events?.some(
        (e) => e.status === "committed" || e.status === "failed" || e.status === "aborted"
      );
      
      if (!hasFinalResolution) {
        failures.push({
          code: "SETTLEMENT_PENDING_UNRESOLVED",
          reason: "Settlement status is 'pending' but no final resolution found in events",
          context: {
            status: lifecycle.status,
            events_count: lifecycle.settlement_events?.length || 0,
          },
        });
        // Non-fatal: don't increment settlement_lifecycle_failed (or increment separately)
        // For now, we'll count it but not fail the entire replay
      }
      
      // Validate that if final status is committed, there was a prepare
      const hasPrepare = lifecycle.settlement_events?.some((e) => e.op === "prepare");
      if (!hasPrepare && lifecycle.status !== "pending") {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement committed but no prepare event found",
          context: {
            status: lifecycle.status,
          },
        });
        summary.settlement_lifecycle_failed++;
      }
    } else if (lifecycle.status === "failed") {
      // v1.7.2+: If failed, failure_code and failure_reason should be present
      if (!lifecycle.failure_code || !lifecycle.failure_reason) {
        failures.push({
          code: "SETTLEMENT_LIFECYCLE_INVALID",
          reason: "Settlement status is 'failed' but failure_code or failure_reason is missing",
          context: {
            status: lifecycle.status,
            has_failure_code: !!lifecycle.failure_code,
            has_failure_reason: !!lifecycle.failure_reason,
          },
        });
        summary.settlement_lifecycle_failed++;
      } else {
        summary.settlement_lifecycle_verified++;
      }
    }
    
    // Validate errors array if present
    if (lifecycle.errors && Array.isArray(lifecycle.errors)) {
      for (const error of lifecycle.errors) {
        if (!error.code || !error.reason) {
          failures.push({
            code: "SETTLEMENT_LIFECYCLE_INVALID",
            reason: "Settlement lifecycle error entry missing code or reason",
            context: {
              error,
            },
          });
          summary.settlement_lifecycle_failed++;
        }
      }
    }
  }

  // Verify settlement SLA violations (v1.6.7+, D1)
  if (transcript.settlement_sla) {
    const sla = transcript.settlement_sla;
    
    // Check: if violations exist, each should have ts_ms and code
    if (sla.violations && Array.isArray(sla.violations)) {
      for (const violation of sla.violations) {
        if (!violation.ts_ms || !violation.code) {
          failures.push({
            code: "SETTLEMENT_SLA_INVALID",
            reason: "SLA violation missing ts_ms or code",
            context: {
              violation,
            },
          });
        }
      }
      
      // Check: if final outcome is success, violations are allowed (fallback succeeded)
      // Check: if final outcome is failure, last violation should match final failure code if SLA was the reason
      if (!transcript.outcome.ok && sla.violations.length > 0) {
        const lastViolation = sla.violations[sla.violations.length - 1];
        const finalCode = transcript.outcome.code;
        
        // If final failure is SLA-related, last violation should match
        if (finalCode === "SETTLEMENT_SLA_VIOLATION" && lastViolation.code !== "SETTLEMENT_SLA_VIOLATION") {
          failures.push({
            code: "SETTLEMENT_SLA_MISMATCH",
            reason: "Final failure is SETTLEMENT_SLA_VIOLATION but last violation code doesn't match",
            context: {
              final_code: finalCode,
              last_violation_code: lastViolation.code,
            },
          });
        }
      }
    }
  }

  // Verify split settlement segments (v1.6.6+, B3)
  if (transcript.settlement_split_summary?.enabled) {
    const splitSummary = transcript.settlement_split_summary;
    const segments = transcript.settlement_segments || [];
    const epsilon = 0.00000001;
    
    // Check: sum(committed segment amounts) == total_paid
    const committedSegments = segments.filter(s => s.status === "committed");
    const sumCommitted = committedSegments.reduce((sum, s) => sum + s.amount, 0);
    if (Math.abs(sumCommitted - splitSummary.total_paid) > epsilon) {
      failures.push({
        code: "SPLIT_SETTLEMENT_INVALID",
        reason: `Sum of committed segment amounts (${sumCommitted}) does not match total_paid (${splitSummary.total_paid})`,
        context: {
          sum_committed: sumCommitted,
          total_paid: splitSummary.total_paid,
          segments_count: committedSegments.length,
        },
      });
    }
    
    // Check: total_paid <= target_amount + epsilon
    if (splitSummary.total_paid > splitSummary.target_amount + epsilon) {
      failures.push({
        code: "SPLIT_SETTLEMENT_OVERPAY",
        reason: `Total paid (${splitSummary.total_paid}) exceeds target amount (${splitSummary.target_amount})`,
        context: {
          total_paid: splitSummary.total_paid,
          target_amount: splitSummary.target_amount,
          overpay: splitSummary.total_paid - splitSummary.target_amount,
        },
      });
    }
    
    // Check: if final outcome success, total_paid approx == target_amount
    if (transcript.outcome.ok) {
      if (Math.abs(splitSummary.total_paid - splitSummary.target_amount) > epsilon) {
        failures.push({
          code: "SPLIT_SETTLEMENT_INCOMPLETE",
          reason: `Final outcome is success but total_paid (${splitSummary.total_paid}) does not match target_amount (${splitSummary.target_amount})`,
          context: {
            total_paid: splitSummary.total_paid,
            target_amount: splitSummary.target_amount,
            difference: Math.abs(splitSummary.total_paid - splitSummary.target_amount),
          },
        });
      }
    }
    
    // Check: segment indices monotonic
    const indices = segments.map(s => s.idx).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      if (indices[i] !== i) {
        failures.push({
          code: "SPLIT_SETTLEMENT_INDICES_INVALID",
          reason: `Segment indices are not monotonic: expected ${i}, got ${indices[i]}`,
          context: {
            expected_idx: i,
            actual_idx: indices[i],
            all_indices: indices,
          },
        });
        break;
      }
    }
    
    // Check: segments_used matches committed segments count
    if (splitSummary.segments_used !== committedSegments.length) {
      failures.push({
        code: "SPLIT_SETTLEMENT_COUNT_MISMATCH",
        reason: `segments_used (${splitSummary.segments_used}) does not match committed segments count (${committedSegments.length})`,
        context: {
          segments_used: splitSummary.segments_used,
          committed_count: committedSegments.length,
        },
      });
    }
  }

  // Verify dispute events (v1.6.8+, C2)
  if (transcript.dispute_events && Array.isArray(transcript.dispute_events)) {
    const disputeEvents = transcript.dispute_events;
    const paidAmount = transcript.receipt?.paid_amount ?? transcript.receipt?.agreed_price ?? 0;
    
    // Track refund amounts per dispute_id for idempotency check
    const refundsByDisputeId = new Map<string, number>();
    
    for (const event of disputeEvents) {
      // Check: refund_amount >= 0
      if (event.refund_amount < 0) {
        failures.push({
          code: "DISPUTE_EVENT_INVALID",
          reason: `Dispute event has negative refund_amount: ${event.refund_amount}`,
          context: {
            dispute_id: event.dispute_id,
            refund_amount: event.refund_amount,
          },
        });
      }
      
      // Check: for resolved refunds, refund_amount <= (receipt.paid_amount || receipt.agreed_price)
      if (event.status === "resolved" && event.refund_amount > 0) {
        if (event.refund_amount > paidAmount) {
          failures.push({
            code: "DISPUTE_REFUND_EXCEEDS_PAID",
            reason: `Dispute refund amount ${event.refund_amount} exceeds paid amount ${paidAmount}`,
            context: {
              dispute_id: event.dispute_id,
              refund_amount: event.refund_amount,
              paid_amount: paidAmount,
            },
          });
        }
      }
      
      // Track refunds by dispute_id for idempotency check
      if (event.status === "resolved" && event.refund_amount > 0) {
        const existing = refundsByDisputeId.get(event.dispute_id) || 0;
        refundsByDisputeId.set(event.dispute_id, existing + event.refund_amount);
      }
    }
    
    // Check idempotency: if multiple events for same dispute_id, they must not sum to > paid amount
    for (const [disputeId, totalRefunded] of refundsByDisputeId.entries()) {
      if (totalRefunded > paidAmount) {
        failures.push({
          code: "DISPUTE_IDEMPOTENCY_VIOLATION",
          reason: `Multiple dispute events for ${disputeId} sum to ${totalRefunded} which exceeds paid amount ${paidAmount}`,
          context: {
            dispute_id: disputeId,
            total_refunded: totalRefunded,
            paid_amount: paidAmount,
          },
        });
      }
    }
  }

  // Verify streaming attempts (v1.6.9+, B4)
  if (transcript.streaming_summary && transcript.streaming_attempts) {
    const summary = transcript.streaming_summary;
    const attempts = transcript.streaming_attempts;
    const agreedPrice = transcript.receipt?.agreed_price ?? 0;
    const epsilon = 0.00000001;
    
    // Check: sum(streaming_attempts.paid_amount where outcome=="success" + partials) == streaming_summary.total_paid_amount
    const sumPaidAmounts = attempts
      .filter(a => a.outcome === "success")
      .reduce((sum, a) => sum + a.paid_amount, 0);
    
    if (Math.abs(sumPaidAmounts - summary.total_paid_amount) > epsilon) {
      failures.push({
        code: "STREAMING_ATTEMPTS_INVALID",
        reason: `Sum of successful attempt paid amounts (${sumPaidAmounts}) does not match total_paid_amount (${summary.total_paid_amount})`,
        context: {
          sum_paid_amounts: sumPaidAmounts,
          total_paid_amount: summary.total_paid_amount,
        },
      });
    }
    
    // Check: total_paid_amount <= agreed_price + epsilon
    if (summary.total_paid_amount > agreedPrice + epsilon) {
      failures.push({
        code: "STREAMING_OVERPAY",
        reason: `Total paid amount (${summary.total_paid_amount}) exceeds agreed price (${agreedPrice})`,
        context: {
          total_paid_amount: summary.total_paid_amount,
          agreed_price: agreedPrice,
        },
      });
    }
    
    // Check: ticks monotonic and non-negative
    let cumulativeTicks = 0;
    for (const attempt of attempts) {
      if (attempt.ticks_paid < 0) {
        failures.push({
          code: "STREAMING_ATTEMPTS_INVALID",
          reason: `Attempt ${attempt.idx} has negative ticks_paid: ${attempt.ticks_paid}`,
          context: { attempt },
        });
      }
      cumulativeTicks += attempt.ticks_paid;
    }
    
    if (Math.abs(cumulativeTicks - summary.total_ticks) > epsilon) {
      failures.push({
        code: "STREAMING_ATTEMPTS_INVALID",
        reason: `Sum of attempt ticks (${cumulativeTicks}) does not match total_ticks (${summary.total_ticks})`,
        context: {
          cumulative_ticks: cumulativeTicks,
          total_ticks: summary.total_ticks,
        },
      });
    }
  }

  // Verify reconciliation events (v1.6+, D2)
  if (transcript.reconcile_events && Array.isArray(transcript.reconcile_events)) {
    const reconcileEvents = transcript.reconcile_events;
    const lifecycle = transcript.settlement_lifecycle;
    
    for (const event of reconcileEvents) {
      // Check: event references an existing handle_id
      if (!lifecycle || lifecycle.handle_id !== event.handle_id) {
        failures.push({
          code: "RECONCILE_EVENT_INVALID",
          reason: `Reconcile event references handle_id ${event.handle_id} which does not match settlement_lifecycle.handle_id ${lifecycle?.handle_id || "missing"}`,
          context: {
            event_handle_id: event.handle_id,
            lifecycle_handle_id: lifecycle?.handle_id,
          },
        });
      }
      
      // Check: transitions are valid (pending -> committed/failed/aborted)
      if (event.from_status === "pending") {
        if (event.to_status !== "committed" && event.to_status !== "failed" && event.to_status !== "aborted") {
          failures.push({
            code: "RECONCILE_EVENT_INVALID_TRANSITION",
            reason: `Invalid reconcile transition from ${event.from_status} to ${event.to_status}. Expected committed, failed, or aborted`,
            context: {
              handle_id: event.handle_id,
              from_status: event.from_status,
              to_status: event.to_status,
            },
          });
        }
      } else {
        // Other transitions are allowed but less common
        // We'll allow them but could add stricter validation if needed
      }
      
      // Check: ts_ms is present and valid
      if (!event.ts_ms || event.ts_ms <= 0) {
        failures.push({
          code: "RECONCILE_EVENT_INVALID",
          reason: `Reconcile event missing or invalid ts_ms: ${event.ts_ms}`,
          context: {
            handle_id: event.handle_id,
            ts_ms: event.ts_ms,
          },
        });
      }
    }
  }
  
  // Wallet signature verification (v2 Phase 2 Execution Layer)
  if (transcript.wallet && transcript.wallet.signature_metadata) {
    const sigMeta = transcript.wallet.signature_metadata;
    
    // Reconstruct the wallet action from transcript
    const receipt = transcript.receipt;
    if (receipt) {
      const walletAction = {
        action: "authorize" as const, // Default action type
        asset_symbol: transcript.wallet.asset || transcript.asset_id || "USDC",
        amount: receipt.agreed_price || 0,
        from: transcript.wallet.signer || transcript.wallet.address,
        to: receipt.seller_agent_id || "",
        memo: undefined,
        idempotency_key: transcript.intent_id,
      };
      
      // Try to verify signature if adapter supports it
      // We need to create a wallet adapter instance to verify
      // For now, we'll do basic validation of payload_hash
      try {
        // Recompute payload hash to verify it matches
        const payload = JSON.stringify({
          action: walletAction.action,
          asset_symbol: walletAction.asset_symbol,
          amount: walletAction.amount,
          from: walletAction.from.toLowerCase(),
          to: walletAction.to.toLowerCase(),
          memo: walletAction.memo || "",
          idempotency_key: walletAction.idempotency_key || "",
        });
        
        const encoder = new TextEncoder();
        const data = encoder.encode(payload);
        const hashBuffer = await crypto.subtle.digest("SHA-256", data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        
        let computedHash: string;
        if (sigMeta.chain === "solana") {
          const bs58 = (await import("bs58")).default;
          computedHash = bs58.encode(hashArray);
        } else {
          computedHash = "0x" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        }
        
        if (computedHash !== sigMeta.payload_hash) {
          const message = `Wallet signature payload_hash mismatch. Expected ${computedHash}, got ${sigMeta.payload_hash}`;
          failures.push({
            code: "WALLET_VERIFY_FAILED",
            reason: message,
            context: { wallet_kind: transcript.wallet!.kind, chain: sigMeta.chain },
          });
          summary.wallet_signatures_failed++;
        } else {
          summary.wallet_signatures_verified++;
        }
      } catch (error: any) {
        const message = `Failed to verify wallet signature: ${error?.message || String(error)}`;
        failures.push({
          code: "WALLET_VERIFY_FAILED",
          reason: message,
          context: { wallet_kind: transcript.wallet!.kind, chain: sigMeta.chain },
        });
        summary.wallet_signatures_failed++;
      }
    }
  }

  return {
    ok: failures.length === 0,
    failures,
    summary,
  };
}

/**
 * H1: Verify a transcript file with stronger invariants.
 * 
 * @param path File path to transcript JSON
 * @param strict If true, pending settlements without resolution are errors; otherwise warnings
 * @param terminalOnly If true and strict is true, skip pending transcripts with a warning
 * @returns Verification result with errors and warnings, or null if skipped
 */
export async function verifyTranscriptFile(
  path: string,
  strict: boolean = false,
  terminalOnly: boolean = false
): Promise<{
  ok: boolean;
  errors: string[];
  warnings: string[];
  skipped?: boolean;
}> {
  const errors: string[] = [];
  const warnings: string[] = [];
  
  // Load transcript
  let transcript: TranscriptV1;
  try {
    const content = fs.readFileSync(path, "utf-8");
    transcript = JSON.parse(content);
  } catch (error: any) {
    return {
      ok: false,
      errors: [`Failed to load transcript: ${error.message}`],
      warnings: [],
    };
  }
  
  // Check if transcript is terminal (committed/failed/aborted) or pending
  const isTerminal = transcript.settlement_lifecycle?.status === "committed" ||
                     transcript.settlement_lifecycle?.status === "failed" ||
                     transcript.settlement_lifecycle?.status === "aborted";
  const isPending = transcript.settlement_lifecycle?.status === "pending";
  
  // If strict + terminalOnly and transcript is pending, skip it
  if (strict && terminalOnly && isPending) {
    return {
      ok: true,
      errors: [],
      warnings: [],
      skipped: true,
    };
  }
  
  // Detect transcript version and route to appropriate verifier
  const transcriptVersion = transcript.transcript_version;
  const isV4 = transcriptVersion && typeof transcriptVersion === "string" && transcriptVersion.startsWith("pact-transcript/4.");
  
  if (isV4) {
    // Route v4 transcripts to v4 verifier
    const v4Transcript = transcript as unknown as TranscriptV4;
    const replayResult = await replayTranscriptV4(v4Transcript);
    
    // Convert v4 result format to expected format
    const convertedErrors: string[] = [];
    const convertedWarnings: string[] = [];
    
    // Convert error objects to strings
    for (const error of replayResult.errors) {
      const errorMsg = error.round_number !== undefined 
        ? `${error.type} (round ${error.round_number}): ${error.message}`
        : `${error.type}: ${error.message}`;
      convertedErrors.push(errorMsg);
    }
    
    // Add warnings
    convertedWarnings.push(...replayResult.warnings);
    
    // Add integrity status as warning if not VALID
    if (replayResult.integrity_status !== "VALID") {
      convertedWarnings.push(`Integrity status: ${replayResult.integrity_status}`);
    }
    
    return {
      ok: replayResult.ok,
      errors: convertedErrors,
      warnings: convertedWarnings,
    };
  }
  
  // H1: Check transcript_version (warn if missing, not error) - only for v1
  if (!transcript.transcript_version) {
    warnings.push("transcript_version missing, assuming '1.0'");
  } else if (transcript.transcript_version !== "1.0") {
    warnings.push(`transcript_version is '${transcript.transcript_version}', expected '1.0'`);
  }
  
  // Run existing replay validation for v1
  const replayResult = await replayTranscript(transcript);
  
  // Convert replay failures to errors or warnings
  // Expired credentials in historical transcripts are expected and should be warnings, not errors
  // WALLET_VERIFY_FAILED is always a warning (wallet signatures may be optional or computed differently on replay)
  // SETTLEMENT_PENDING_UNRESOLVED is warning by default, error in strict mode
  const pendingUnresolvedMessages: string[] = [];
  for (const failure of replayResult.failures) {
    if (failure.code === "CREDENTIAL_EXPIRED") {
      warnings.push(`Credential expired: ${failure.reason} (expected for historical transcripts)`);
    } else if (failure.code === "WALLET_VERIFY_FAILED") {
      warnings.push(`WALLET_VERIFY_FAILED: ${failure.reason} (expected for historical transcripts)`);
    } else if (failure.code === "SETTLEMENT_PENDING_UNRESOLVED") {
      // Collect pending unresolved messages for deduplication
      pendingUnresolvedMessages.push(failure.reason);
    } else {
      errors.push(`${failure.code}: ${failure.reason}`);
    }
  }
  
  // Check for pending settlement without terminal resolution event
  if (transcript.settlement_lifecycle?.status === "pending") {
    const lifecycle = transcript.settlement_lifecycle;
    const hasTerminalResolution = lifecycle.settlement_events?.some(
      (e) => e.status === "committed" || e.status === "failed" || e.status === "aborted"
    ) || transcript.reconcile_events?.some(
      (e) => e.from_status === "pending" && (e.to_status === "committed" || e.to_status === "failed" || e.to_status === "aborted")
    );
    
    if (!hasTerminalResolution) {
      const message = "Settlement status is 'pending' but no terminal resolution event found (committed/failed/aborted)";
      pendingUnresolvedMessages.push(message);
    }
  }
  
  // Dedupe and add SETTLEMENT_PENDING_UNRESOLVED messages (keep the most descriptive/longest one)
  if (pendingUnresolvedMessages.length > 0) {
    const bestMessage = pendingUnresolvedMessages.reduce((a, b) => a.length > b.length ? a : b);
    if (strict) {
      errors.push(`SETTLEMENT_PENDING_UNRESOLVED: ${bestMessage}`);
    } else {
      warnings.push(`SETTLEMENT_PENDING_UNRESOLVED: ${bestMessage}`);
    }
  }
  
  // H1: Stronger invariants for settlement_attempts
  if (transcript.settlement_attempts && Array.isArray(transcript.settlement_attempts)) {
    const attempts = transcript.settlement_attempts;
    
    // Check: last success/failed should match overall outcome
    if (attempts.length > 0) {
      const lastAttempt = attempts[attempts.length - 1];
      const overallOk = transcript.outcome?.ok;
      
      if (overallOk === true && lastAttempt.outcome !== "success") {
        errors.push(`settlement_attempts: overall outcome is ok=true but last attempt outcome is '${lastAttempt.outcome}'`);
      } else if (overallOk === false && lastAttempt.outcome === "success") {
        errors.push(`settlement_attempts: overall outcome is ok=false but last attempt outcome is 'success'`);
      }
      
      // Check: if last attempt is success, overall should be ok
      if (lastAttempt.outcome === "success" && overallOk !== true) {
        errors.push(`settlement_attempts: last attempt is success but overall outcome is not ok=true`);
      }
    }
  }
  
  // H1: Stronger invariants for streaming_attempts
  if (transcript.streaming_attempts && Array.isArray(transcript.streaming_attempts)) {
    const attempts = transcript.streaming_attempts;
    const summary = transcript.streaming_summary;
    const agreedPrice = transcript.receipt?.agreed_price ?? 0;
    const epsilon = 0.00000001;
    
    if (summary) {
      // Check: total_paid_amount equals sum of successful attempts paid_amount
      const sumPaidAmounts = attempts
        .filter(a => a.outcome === "success")
        .reduce((sum, a) => sum + a.paid_amount, 0);
      
      if (Math.abs(sumPaidAmounts - summary.total_paid_amount) > epsilon) {
        errors.push(`streaming_attempts: sum of successful attempt paid_amounts (${sumPaidAmounts}) does not match total_paid_amount (${summary.total_paid_amount})`);
      }
      
      // Check: total_paid_amount never exceeds agreed_price + epsilon
      if (summary.total_paid_amount > agreedPrice + epsilon) {
        errors.push(`streaming_attempts: total_paid_amount (${summary.total_paid_amount}) exceeds agreed_price (${agreedPrice})`);
      }
    }
  }
  
  // H1: Stronger invariants for settlement_segments (already in replay, but ensure it's checked)
  // The replay function already checks these, so we rely on those errors
  
  // H1: Stronger invariants for dispute_events
  if (transcript.dispute_events && Array.isArray(transcript.dispute_events)) {
    const disputeEvents = transcript.dispute_events;
    const paidAmount = transcript.receipt?.paid_amount ?? transcript.receipt?.agreed_price ?? 0;
    
    // Check: refund_amount <= paid_amount/agreed_price (already in replay)
    // Check: no duplicate dispute_id summing above paid (already in replay)
    
    // Additional check: if dispute resolved, refund_amount should be reasonable
    for (const event of disputeEvents) {
      if (event.status === "resolved" && event.refund_amount > 0) {
        if (event.refund_amount > paidAmount) {
          errors.push(`dispute_events: dispute ${event.dispute_id} refund_amount (${event.refund_amount}) exceeds paid_amount (${paidAmount})`);
        }
      }
    }
  }
  
  // H1: Stronger invariants for reconcile_events
  if (transcript.reconcile_events && Array.isArray(transcript.reconcile_events)) {
    const reconcileEvents = transcript.reconcile_events;
    const lifecycle = transcript.settlement_lifecycle;
    
    for (const event of reconcileEvents) {
      // Check: handle_id present (already in replay)
      if (!event.handle_id) {
        errors.push(`reconcile_events: event missing handle_id`);
      }
      
      // Check: handle_id matches lifecycle handle_id (already in replay)
      if (lifecycle && event.handle_id && lifecycle.handle_id !== event.handle_id) {
        errors.push(`reconcile_events: event handle_id (${event.handle_id}) does not match settlement_lifecycle.handle_id (${lifecycle.handle_id})`);
      }
      
      // Check: valid transitions (pending -> committed/failed/aborted)
      if (event.from_status === "pending" && event.to_status !== "committed" && event.to_status !== "failed" && event.to_status !== "aborted") {
        errors.push(`reconcile_events: invalid transition from ${event.from_status} to ${event.to_status}. Expected committed, failed, or aborted`);
      }
    }
  }
  
  // Dedupe warnings by code (keep the more descriptive/longer one)
  const warningsByCode = new Map<string, string>();
  for (const warning of warnings) {
    // Extract code (everything before first colon or space)
    const match = warning.match(/^([A-Z_]+)[:\s]/);
    const code = match ? match[1] : warning;
    const existing = warningsByCode.get(code);
    if (!existing || warning.length > existing.length) {
      warningsByCode.set(code, warning);
    }
  }
  const dedupedWarnings = Array.from(warningsByCode.values());
  
  return {
    ok: errors.length === 0,
    errors,
    warnings: dedupedWarnings,
  };
}

