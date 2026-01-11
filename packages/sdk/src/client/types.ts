export type AcquireInput = {
  intentType: string;
  scope: string | object;
  constraints: { latency_ms: number; freshness_sec: number };
  maxPrice: number;
  urgent?: boolean;
  // Optional override
  modeOverride?: "streaming" | "hash_reveal";
  // Optional control
  buyerStopAfterTicks?: number; // only used in streaming tests
  // Optional explain level
  explain?: "none" | "coarse" | "full";
  // Optional reputation scoring version (v1.5.3+)
  useReputationV2?: boolean; // Use credential-aware, volume-weighted reputation scoring
  // Optional transcript saving (v1.5.4+)
  saveTranscript?: boolean; // Save full transcript for audit/debug
  transcriptDir?: string; // Custom directory for transcripts (default: .pact/transcripts)
  // Optional trust tier routing (v1.5.8+)
  minTrustTier?: "untrusted" | "low" | "trusted"; // Override policy min_trust_tier
  minTrustScore?: number; // Override policy min_trust_score
  requireCredential?: boolean; // Override policy require_credential
  // Optional settlement provider selection (v1.6.2+)
  settlement?: {
    provider?: "mock" | "external" | "stripe_like"; // v1.7.1+: stripe_like for Stripe-like semantics
    params?: Record<string, unknown>; // Parameters for external provider (e.g., { rail: "stripe", network: "testnet" })
    idempotency_key?: string; // Optional idempotency key for settlement lifecycle
    auto_poll_ms?: number; // v1.7.2+: If set, poll settlement until resolved (0 = immediate poll loop, >0 = delay between polls)
    split?: { // v1.6.6+: Split settlement across multiple providers (B3)
      enabled?: boolean; // Enable split settlement (default: false)
      max_segments?: number; // Maximum number of segments (default: unlimited)
    };
  };
  // Optional identity/verification (v1: for policy enforcement)
  identity?: {
    buyer?: {
      credentials?: string[];     // e.g. ["bonded","sla_verified"]
      issuer_ids?: string[];      // e.g. ["issuer_pact_registry"]
      sponsor_attestation?: boolean;
      uses_session_key?: boolean;
      session_intent?: string;
      session_spend_cap_ok?: boolean;
    };
    seller?: {
      credentials?: string[];
      issuer_ids?: string[];
    };
  };
};

export type AcquireResult = {
  ok: true;
  plan: {
    regime: "posted" | "negotiated" | "bespoke";
    settlement: "streaming" | "hash_reveal";
    fanout: number;
    maxRounds: number;
    reason: string;
    overrideActive: boolean;
    selected_provider_id?: string;  // Provider selected from fanout
    offers_considered?: number;     // Number of offers evaluated
  };
  intent_id: string;
  buyer_agent_id: string;
  seller_agent_id: string;
  receipt: any; // Receipt
  offers_eligible?: number; // Number of offers that passed policy
  // Optional explain metadata
  explain?: import("./explain").AcquireExplain;
  // Optional verification metadata (for HTTP providers)
  verification?: {
    quoteVerified: boolean;
    signerMatched: boolean;
    commitVerified?: boolean;  // Only set for hash_reveal mode with HTTP provider
    revealVerified?: boolean;  // Only set for hash_reveal mode with HTTP provider
  };
  // Optional transcript path (v1.5.4+)
  transcriptPath?: string;
} | {
  ok: false;
  plan?: any;
  code: string;
  reason: string;
  agreed_price?: number; // Available when agreement was created (e.g., for FAILED_PROOF)
  offers_considered?: number;
  offers_eligible?: number;
  // Optional explain metadata (even on failure)
  explain?: import("./explain").AcquireExplain;
  // Optional transcript path (v1.5.4+)
  transcriptPath?: string;
};

