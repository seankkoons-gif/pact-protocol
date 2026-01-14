import type { FailureCode } from "../policy/types";

export type ProtocolVersion = "pact/1.0";
export type SettlementMode = "hash_reveal" | "streaming";
export type ProofType = "hash_reveal" | "streaming";
export type Unit = "request" | "ms" | "byte" | "custom";

export interface IntentConstraints {
  latency_ms: number;
  freshness_sec: number;
}

export interface IntentMessage {
  protocol_version: ProtocolVersion;
  type: "INTENT";
  intent_id: string;
  intent: string;
  scope: string | object;
  constraints: IntentConstraints;
  max_price: number;
  settlement_mode: SettlementMode;
  urgent?: boolean;
  sent_at_ms: number;
  expires_at_ms: number;
}

export interface AskMessage {
  protocol_version: ProtocolVersion;
  type: "ASK";
  intent_id: string;
  price: number;
  unit: Unit;
  latency_ms: number;
  valid_for_ms: number;
  bond_required: number;
  sent_at_ms: number;
  expires_at_ms: number;
  // v2 Phase 2+: Wallet information for wallet-aware negotiation (optional)
  seller_wallet_address?: string;
  seller_wallet_chain?: string;
}

export interface BidMessage {
  protocol_version: ProtocolVersion;
  type: "BID";
  intent_id: string;
  price: number;
  unit: Unit;
  latency_ms: number;
  valid_for_ms: number;
  bond_required: number;
  bond_offered?: number;
  sent_at_ms: number;
  expires_at_ms: number;
  // v2 Phase 2+: Wallet information for wallet-aware negotiation (optional)
  buyer_wallet_address?: string;
  buyer_wallet_chain?: string;
}

export interface AcceptMessage {
  protocol_version: ProtocolVersion;
  type: "ACCEPT";
  intent_id: string;
  agreed_price: number;
  settlement_mode: SettlementMode;
  proof_type: ProofType;
  challenge_window_ms: number;
  delivery_deadline_ms: number;
  sent_at_ms: number;
  expires_at_ms: number;
  // v2 Phase 2+: Wallet information for wallet-aware negotiation and Phase 3 locking (optional)
  buyer_wallet_address?: string;
  buyer_wallet_chain?: string;
  seller_wallet_address?: string;
  seller_wallet_chain?: string;
}

export interface RejectMessage {
  protocol_version: ProtocolVersion;
  type: "REJECT";
  intent_id: string;
  reason: string;
  code?: FailureCode;
  sent_at_ms: number;
  expires_at_ms: number;
}

export interface CommitMessage {
  protocol_version: ProtocolVersion;
  type: "COMMIT";
  intent_id: string;
  commit_hash_hex: string;
  sent_at_ms: number;
  expires_at_ms: number;
}

export interface RevealMessage {
  protocol_version: ProtocolVersion;
  type: "REVEAL";
  intent_id: string;
  payload_b64: string;
  nonce_b64: string;
  sent_at_ms: number;
  expires_at_ms: number;
}

export interface ReceiptMessage {
  protocol_version: ProtocolVersion;
  type: "RECEIPT";
  intent_id: string;
  buyer_agent_id: string;
  seller_agent_id: string;
  agreed_price: number;
  fulfilled: boolean;
  latency_ms?: number;
  failure_code?: FailureCode;
  timestamp_ms: number;
}

export type PactMessage =
  | IntentMessage
  | AskMessage
  | BidMessage
  | AcceptMessage
  | RejectMessage
  | CommitMessage
  | RevealMessage
  | ReceiptMessage;

