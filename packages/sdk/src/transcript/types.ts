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
  
  // Outcome summary
  outcome: {
    ok: boolean;
    code?: string;
    reason?: string;
  };
};

