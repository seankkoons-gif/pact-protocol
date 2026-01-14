/**
 * Transcript Types
 * 
 * Types for audit/debug transcripts of acquire() operations.
 */

import type { AcquireInput } from "../client/types";
import type { ProviderDecision } from "../client/explain";
import type { Receipt } from "../exchange/receipt";

export type TranscriptV1 = {
  version: "1";
  transcript_version?: "1.0"; // H1: Transcript schema version (defaults to "1.0" if missing)
  intent_id: string;
  intent_type: string;
  timestamp_ms: number;
  
  // Sanitized input (remove sensitive data if needed)
  input: AcquireInput;
  
  // Directory of providers considered
  directory: Array<{
    provider_id?: string;
    pubkey_b58: string;
    endpoint?: string;
    region?: string;
    credentials?: string[];
  }>;
  
  // Credential verification results per provider
  credential_checks: Array<{
    provider_id?: string;
    pubkey_b58: string;
    ok: boolean;
    reason?: string;
    code?: string;
    credential_summary?: {
      signer_public_key_b58?: string;
      expires_at_ms?: number;
      capabilities?: Array<{
        intentType?: string;
        credentials?: string[];
        region?: string;
        modes?: string[];
      }>;
    };
    trust_score?: number;
    trust_tier?: "untrusted" | "low" | "trusted";
  }>;
  
  // Quote fetching results per provider
  quotes: Array<{
    provider_id?: string;
    pubkey_b58: string;
    ok: boolean;
    code?: string;
    reason?: string;
    quote_summary?: {
      quote_price?: number;
      reference_price_p50?: number;
      valid_for_ms?: number;
      is_firm_quote?: boolean;
      urgent?: boolean;
    };
    signer_pubkey_b58?: string;
  }>;
  
  // Provider selection result
  selection?: {
    selected_provider_id?: string;
    selected_pubkey_b58?: string;
    reason?: string;
    utility_score?: number;
    alternatives_considered?: number;
  };
  
  // Settlement summary
  settlement?: {
    mode: "streaming" | "hash_reveal";
    artifacts_summary?: {
      commit_hash?: string;
      reveal_nonce?: string;
      stream_chunks?: number;
    };
    verification_summary?: {
      quoteVerified?: boolean;
      signerMatched?: boolean;
      commitVerified?: boolean;
      revealVerified?: boolean;
    };
  };
  
  // Full receipt if present
  receipt?: Receipt;
  
  // Decision log (existing explain structure)
  explain?: {
    level: "none" | "coarse" | "full";
    intentType: string;
    settlement: string;
    regime: string;
    providers_eligible?: number;
    providers_considered?: number;
    decisions?: ProviderDecision[];
  };
  
  // Negotiation log (v2.1+)
  negotiation?: {
    strategy: string; // Negotiation strategy used (e.g., "baseline")
    rounds_used: number; // Number of negotiation rounds
    log: Array<{
      round: number;
      timestamp_ms: number;
      decision: {
        type: "start" | "counteroffer" | "accepted_quote" | "rejected" | "timeout" | "done";
        quote_price?: number;
        max_price?: number;
        buyer_price?: number;
        provider_price?: number;
        price?: number;
        final_price?: number;
        reason?: string;
      };
    }>;
  };
  
  // Outcome summary
  outcome: {
    ok: boolean;
    code?: string;
    reason?: string;
  };
  
  // Settlement lifecycle metadata (v1.6.3+)
  settlement_lifecycle?: {
    provider?: string; // "mock" | "external" | "stripe_like"
    idempotency_key?: string; // Idempotency key from input.settlement.idempotency_key
    handle_id?: string; // Settlement handle ID from prepare()
    status?: "prepared" | "committed" | "aborted" | "pending" | "failed"; // Lifecycle status (v1.7.2+: pending, failed)
    prepared_at_ms?: number; // Timestamp when prepare() was called
    committed_at_ms?: number; // Timestamp when commit() was called
    aborted_at_ms?: number; // Timestamp when abort() was called
    paid_amount?: number; // Amount paid (from commit result)
    errors?: Array<{ code: string; reason: string }>; // Lifecycle errors
    // v1.7.2+: async operation tracking
    attempts?: number;
    last_attempt_ms?: number;
    failure_code?: string;
    failure_reason?: string;
    // v1.7.2+: settlement events timeline
    settlement_events?: Array<{
      ts_ms: number;
      op: "prepare" | "commit" | "poll" | "abort";
      status: "prepared" | "committed" | "aborted" | "pending" | "failed";
      meta?: Record<string, unknown>;
    }>;
  };
  
  // Settlement attempt chain (v1.6.2+, B2)
  // Records each provider/settlement attempt in fallback retry loop
  settlement_attempts?: Array<{
    idx: number; // Attempt index (0-based, 0 = first attempt)
    provider_pubkey: string; // Provider public key (b58)
    provider_id?: string; // Provider ID from directory
    settlement_provider?: string; // Settlement provider used ("mock", "stripe_like", "external")
    outcome: "success" | "failed"; // Outcome of this attempt
    failure_code?: string; // Failure code if outcome is "failed"
    failure_reason?: string; // Failure reason if outcome is "failed"
    timestamp_ms?: number; // Timestamp when attempt completed
  }>;
  
  // Settlement segments (v1.6.6+, B3)
  // Records each segment when split settlement is enabled
  settlement_segments?: Array<{
    idx: number; // Segment index (0-based, monotonic)
    provider_pubkey: string; // Provider public key (b58)
    settlement_provider: string; // Settlement provider used ("mock", "stripe_like", "external")
    amount: number; // Amount for this segment
    status: "committed" | "failed"; // Segment status
    handle_id?: string; // Settlement handle ID for this segment
    failure_code?: string; // Failure code if status is "failed"
    failure_reason?: string; // Failure reason if status is "failed"
  }>;
  
  // Split settlement summary (v1.6.6+, B3)
  settlement_split_summary?: {
    enabled: boolean; // Whether split settlement was enabled
    target_amount: number; // Target amount (agreed_price)
    total_paid: number; // Total amount paid across all segments
    segments_used: number; // Number of segments used
  };
  
  // Settlement SLA (v1.6.7+, D1)
  settlement_sla?: {
    enabled: boolean;
    max_pending_ms?: number;
    max_poll_attempts?: number;
    poll_interval_ms?: number;
    violations?: Array<{
      ts_ms: number;
      code: string;
      reason: string;
      handle_id?: string;
      provider?: string;
    }>;
  };
  
  // Dispute events (v1.6.8+, C2)
  dispute_events?: Array<{
    ts_ms: number;
    dispute_id: string;
    outcome: string;
    refund_amount: number;
    settlement_provider?: string;
    status: "resolved" | "failed";
    failure_code?: string;
    failure_reason?: string;
    // C3: Signed decision artifact fields
    decision_hash_hex?: string;
    arbiter_pubkey_b58?: string;
  }>;
  
  // Streaming attempts (v1.6.9+, B4)
  streaming_attempts?: Array<{
    idx: number; // Attempt index (0-based)
    provider_pubkey: string; // Provider public key (b58)
    provider_id?: string; // Provider ID from directory
    settlement_provider?: string; // Settlement provider used ("mock", "stripe_like", "external")
    ticks_paid: number; // Number of ticks paid in this attempt
    paid_amount: number; // Amount paid in this attempt
    outcome: "success" | "failed"; // Outcome of this attempt
    failure_code?: string; // Failure code if outcome is "failed"
    failure_reason?: string; // Failure reason if outcome is "failed"
  }>;
  
  // Streaming summary (v1.6.9+, B4)
  streaming_summary?: {
    total_ticks: number; // Total ticks paid across all attempts
    total_paid_amount: number; // Total amount paid across all attempts
    attempts_used: number; // Number of attempts used
  };
  
  // Reconciliation events (v1.6+, D2)
  reconcile_events?: Array<{
    ts_ms: number; // Timestamp when reconciliation occurred
    handle_id: string; // Settlement handle ID that was reconciled
    from_status: string; // Previous status before reconciliation
    to_status: string; // New status after reconciliation
    note?: string; // Optional note about the reconciliation
  }>;
};

