/**
 * Know Your Agent (KYA) Credential Types
 * 
 * Credentials are signed capability attestations that providers present to buyers
 * to establish identity and prove capabilities before negotiation begins.
 */

export type CredentialVersion = "1";

export interface Capability {
  intentType: string;
  modes: ("hash_reveal" | "streaming")[];
  region?: string;
  credentials?: string[];
}

export interface CredentialMessage {
  protocol_version: "pact/1.0";
  credential_version: CredentialVersion;
  credential_id: string;
  provider_pubkey_b58: string;
  issuer: string; // For v1, allows "self" for self-signed
  issued_at_ms: number;
  expires_at_ms: number;
  capabilities: Capability[];
  nonce: string;
}

export interface ProviderCredentialRequest {
  intent?: string; // Optional: filter credentials by intent type
}

export interface ProviderCredentialResponse {
  envelope: import("../protocol/envelope").SignedEnvelope<CredentialMessage>;
}




