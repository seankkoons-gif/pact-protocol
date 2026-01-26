export type ExplainLevel = "none" | "coarse" | "full";

export type DecisionCode =
  | "DIRECTORY_EMPTY"
  | "PROVIDER_MISSING_ENDPOINT"
  | "PROVIDER_SIGNATURE_INVALID"
  | "PROVIDER_SIGNER_MISMATCH"
  | "PROVIDER_INTENT_NOT_SUPPORTED"
  | "PROVIDER_MISSING_REQUIRED_CREDENTIALS"
  | "PROVIDER_UNTRUSTED_ISSUER"
  | "PROVIDER_CREDENTIAL_INVALID"
  | "PROVIDER_CREDENTIAL_REQUIRED"
  | "PROVIDER_ISSUER_UNTRUSTED"
  | "PROVIDER_CREDENTIAL_LOW_TRUST"
  | "PROVIDER_TRUST_TIER_TOO_LOW"
  | "PROVIDER_TRUST_SCORE_TOO_LOW"
  | "PROVIDER_CREDENTIAL_TRUST_SCORE"
  | "PROVIDER_QUOTE_HTTP_ERROR"
  | "PROVIDER_QUOTE_PARSE_ERROR"
  | "PROVIDER_QUOTE_INVALID"
  | "PROVIDER_QUOTE_POLICY_REJECTED"
  | "PROVIDER_QUOTE_OUT_OF_BAND"
  | "PROVIDER_SELECTED"
  | "NO_ELIGIBLE_PROVIDERS"
  | "SETTLEMENT_STARTED"
  | "SETTLEMENT_COMPLETED"
  | "SETTLEMENT_FAILED"
  | "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED"
  | "RECEIPT_INGESTED"
  | "PACT-330" // Contention exclusivity violation
  | "PACT-331"; // Double commit detection

export type ProviderDecision = {
  provider_id: string;
  pubkey_b58: string;
  endpoint?: string;
  step: "directory" | "identity" | "capabilities" | "quote" | "policy" | "selection" | "settlement";
  ok: boolean;
  code: DecisionCode;
  reason: string; // short human-readable (1 line)
  meta?: Record<string, any>; // only present when explain="full"
  ts_ms?: number;
};

export type AcquireExplain = {
  level: ExplainLevel;
  intentType: string;
  settlement: "hash_reveal" | "streaming";
  regime: "posted" | "negotiated" | "bespoke";
  fanout: number;
  providers_considered: number;
  providers_eligible: number;
  selected_provider_id?: string;
  log: ProviderDecision[];
};

