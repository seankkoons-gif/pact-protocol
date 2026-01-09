/**
 * Transcript Replay Verifier
 * 
 * Verifies transcripts by checking signatures, credentials, and commit-reveal hashes.
 */

import * as fs from "fs";
import { verifyEnvelope } from "../protocol/envelope";
import { verifyReveal } from "../exchange/commit";
import type { TranscriptV1 } from "./types";

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

  return {
    ok: failures.length === 0,
    failures,
    summary,
  };
}

