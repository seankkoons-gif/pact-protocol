// Minimal SignedEnvelope type (duplicated to avoid circular deps)
export interface SignedEnvelope {
  envelope_version: "pact-envelope/1.0";
  message: any;
  message_hash_hex: string;
  signer_public_key_b58: string;
  signature_b58: string;
  signed_at_ms: number;
}

export interface ProviderQuoteRequest {
  intent_id: string;
  intent_type: string;
  max_price: number;
  constraints: {
    latency_ms: number;
    freshness_sec: number;
  };
  urgent?: boolean;
}

export interface ProviderQuoteResponse {
  envelope: SignedEnvelope; // Signed ASK envelope
  // Legacy format for backward compatibility (server accepts both)
  ask?: {
    price: number;
    unit: "request";
    latency_ms: number;
    valid_for_ms: number;
    bond_required: number;
  };
}

export interface CommitRequest {
  intent_id: string;
  payload_b64: string;
  nonce_b64: string;
}

export interface CommitResponse {
  envelope: SignedEnvelope; // Signed COMMIT envelope
}

export interface RevealRequest {
  intent_id: string;
  payload_b64: string;
  nonce_b64: string;
  commit_hash_hex: string;
}

export type RevealResponse = {
  envelope: SignedEnvelope; // Signed REVEAL envelope
  ok: boolean;
  code?: "FAILED_PROOF";
  reason?: string;
};

export interface StreamChunkRequest {
  intent_id: string;
  seq: number;
  sent_at_ms?: number;
}

export interface StreamChunkResponse {
  envelope: SignedEnvelope; // Signed STREAM_CHUNK envelope
}

export interface ProviderCredentialRequest {
  intent?: string; // Optional: filter by intent type
}

export interface ProviderCredentialResponse {
  envelope: SignedEnvelope; // Signed credential envelope
}

