# Pact SDK v1 Stability Guarantees

This document defines the **stable v1 API surface** of the Pact SDK. These interfaces and types are frozen and will not break in v1.x releases, even as internal implementations evolve.

## Stability Commitment

**All items listed below are guaranteed to remain stable across v1.x releases:**
- Type definitions will not change (fields added/removed/renamed)
- Enum values will not change
- Required fields will remain required
- Optional fields will remain optional
- Field types will not change in breaking ways

Internal implementations, helper functions, and non-exported types may evolve freely.

---

## 1. Acquire API (`packages/sdk/src/client/types.ts`)

### `AcquireInput`

```typescript
export type AcquireInput = {
  intentType: string;
  scope: string | object;
  constraints: { latency_ms: number; freshness_sec: number };
  maxPrice: number;
  urgent?: boolean;
  modeOverride?: "streaming" | "hash_reveal";
  buyerStopAfterTicks?: number;
};
```

**Stable fields:**
- `intentType` (string, required)
- `scope` (string | object, required)
- `constraints` (object with `latency_ms` and `freshness_sec`, required)
- `maxPrice` (number, required)
- `urgent` (boolean, optional)
- `modeOverride` ("streaming" | "hash_reveal", optional)
- `buyerStopAfterTicks` (number, optional)

### `AcquireResult`

```typescript
export type AcquireResult = {
  ok: true;
  plan: {
    regime: "posted" | "negotiated" | "bespoke";
    settlement: "streaming" | "hash_reveal";
    fanout: number;
    maxRounds: number;
    reason: string;
    overrideActive: boolean;
  };
  intent_id: string;
  buyer_agent_id: string;
  seller_agent_id: string;
  receipt: Receipt;
} | {
  ok: false;
  plan?: ExecutionPlan;
  code: string;
  reason: string;
};
```

**Stable fields:**
- Discriminated union on `ok: boolean`
- When `ok: true`:
  - `plan.regime` ("posted" | "negotiated" | "bespoke")
  - `plan.settlement` ("streaming" | "hash_reveal")
  - `plan.fanout` (number)
  - `plan.maxRounds` (number)
  - `plan.reason` (string)
  - `plan.overrideActive` (boolean)
  - `intent_id` (string)
  - `buyer_agent_id` (string)
  - `seller_agent_id` (string)
  - `receipt` (Receipt type)
- When `ok: false`:
  - `code` (string)
  - `reason` (string)
  - `plan` (optional ExecutionPlan)

---

## 2. Receipt Type (`packages/sdk/src/exchange/receipt.ts`)

```typescript
export type Receipt = {
  receipt_id: string;
  intent_id: string;
  buyer_agent_id: string;
  seller_agent_id: string;
  agreed_price: number;
  fulfilled: boolean;
  latency_ms?: number;
  failure_code?: FailureCode | string;
  paid_amount?: number;
  ticks?: number;
  chunks?: number;
  timestamp_ms: number;
};
```

**Stable fields:**
- `receipt_id` (string, required)
- `intent_id` (string, required)
- `buyer_agent_id` (string, required)
- `seller_agent_id` (string, required)
- `agreed_price` (number, required)
- `fulfilled` (boolean, required)
- `latency_ms` (number, optional)
- `failure_code` (FailureCode | string, optional)
- `paid_amount` (number, optional)
- `ticks` (number, optional)
- `chunks` (number, optional)
- `timestamp_ms` (number, required)

---

## 3. Failure Codes (`packages/sdk/src/policy/types.ts`)

The `FailureCode` type is a union of the following string literals:

```typescript
export type FailureCode =
  | "MISSING_EXPIRES_AT"
  | "INTENT_EXPIRED"
  | "VALID_FOR_TOO_SHORT"
  | "VALID_FOR_TOO_LONG"
  | "CLOCK_SKEW_TOO_LARGE"
  | "INTENT_NOT_ALLOWED"
  | "SESSION_SPEND_CAP_EXCEEDED"
  | "UNTRUSTED_ISSUER"
  | "ONE_OF_ADMISSION_FAILED"
  | "ROUND_EXCEEDED"
  | "DURATION_EXCEEDED"
  | "FIRM_QUOTE_MISSING_VALID_FOR"
  | "FIRM_QUOTE_OUT_OF_RANGE"
  | "NEW_AGENT_EXCLUDED"
  | "REGION_NOT_ALLOWED"
  | "FAILURE_RATE_TOO_HIGH"
  | "TIMEOUT_RATE_TOO_HIGH"
  | "MISSING_REQUIRED_CREDENTIALS"
  | "QUOTE_OUT_OF_BAND"
  | "FAILED_REFERENCE_BAND"
  | "SETTLEMENT_MODE_NOT_ALLOWED"
  | "PRE_SETTLEMENT_LOCK_REQUIRED"
  | "BOND_INSUFFICIENT"
  | "SCHEMA_VALIDATION_FAILED"
  | "STREAMING_SPEND_CAP_EXCEEDED"
  | "LATENCY_BREACH"
  | "FRESHNESS_BREACH"
  | "TRANSCRIPT_STORAGE_FORBIDDEN"
  | "INVALID_POLICY"
  | "FAILED_NEGOTIATION_TIMEOUT"
  | "FAILED_POLICY"
  | "BUYER_STOPPED"
  | "SELLER_STOPPED"
  | "FAILED_ESCROW";
```

**Stable:** All failure code string literals listed above will remain valid and will not be removed in v1.x.

---

## 4. Message Grammar Types (`packages/sdk/src/protocol/types.ts`)

### `IntentMessage`

```typescript
export interface IntentMessage {
  protocol_version: "pact/1.0";
  type: "INTENT";
  intent_id: string;
  intent: string;
  scope: string | object;
  constraints: { latency_ms: number; freshness_sec: number };
  max_price: number;
  settlement_mode: "hash_reveal" | "streaming";
  urgent?: boolean;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `AskMessage`

```typescript
export interface AskMessage {
  protocol_version: "pact/1.0";
  type: "ASK";
  intent_id: string;
  price: number;
  unit: "request" | "ms" | "byte" | "custom";
  latency_ms: number;
  valid_for_ms: number;
  bond_required: number;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `BidMessage`

```typescript
export interface BidMessage {
  protocol_version: "pact/1.0";
  type: "BID";
  intent_id: string;
  price: number;
  unit: "request" | "ms" | "byte" | "custom";
  latency_ms: number;
  valid_for_ms: number;
  bond_required: number;
  bond_offered?: number;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `AcceptMessage`

```typescript
export interface AcceptMessage {
  protocol_version: "pact/1.0";
  type: "ACCEPT";
  intent_id: string;
  agreed_price: number;
  settlement_mode: "hash_reveal" | "streaming";
  proof_type: "hash_reveal" | "streaming";
  challenge_window_ms: number;
  delivery_deadline_ms: number;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `RejectMessage`

```typescript
export interface RejectMessage {
  protocol_version: "pact/1.0";
  type: "REJECT";
  intent_id: string;
  reason: string;
  code?: FailureCode;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `CommitMessage`

```typescript
export interface CommitMessage {
  protocol_version: "pact/1.0";
  type: "COMMIT";
  intent_id: string;
  commit_hash_hex: string;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `RevealMessage`

```typescript
export interface RevealMessage {
  protocol_version: "pact/1.0";
  type: "REVEAL";
  intent_id: string;
  payload_b64: string;
  nonce_b64: string;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `StreamStartMessage`

```typescript
export interface StreamStartMessage {
  protocol_version: string;
  type: "STREAM_START";
  intent_id: string;
  agreed_price: number;
  tick_ms: number;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `StreamChunkMessage`

```typescript
export interface StreamChunkMessage {
  protocol_version: string;
  type: "STREAM_CHUNK";
  intent_id: string;
  chunk_b64: string;
  seq: number;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

### `StreamStopMessage`

```typescript
export interface StreamStopMessage {
  protocol_version: string;
  type: "STREAM_STOP";
  intent_id: string;
  by: "buyer" | "seller";
  reason: string;
  sent_at_ms: number;
  expires_at_ms: number;
}
```

**Stable:** All message type interfaces, their field names, types, and required/optional status are frozen for v1.x.

---

## 5. ExecutionPlan (`packages/sdk/src/router/types.ts`)

```typescript
export type ExecutionPlan = {
  regime: "posted" | "negotiated" | "bespoke";
  settlement: "hash_reveal" | "streaming";
  fanout: number;
  maxRounds: number;
  reason: string;
};
```

**Stable fields:**
- `regime` ("posted" | "negotiated" | "bespoke", required)
- `settlement` ("hash_reveal" | "streaming", required)
- `fanout` (number, required)
- `maxRounds` (number, required)
- `reason` (string, required)

---

## 6. Protocol Version

The protocol version string `"pact/1.0"` is stable and will not change in v1.x releases.

---

## What Can Change

The following are **not** part of the stable v1 API and may evolve:

- Internal implementation details
- Helper functions and utilities
- Non-exported types and interfaces
- Policy schema structure (internal representation)
- Router heuristics and algorithms (only the `ExecutionPlan` output is stable)
- Error messages and reason strings (structure is stable, content may change)
- Default values and behavior (unless explicitly documented as stable)

---

## Versioning Policy

- **v1.x**: All items in this document remain stable
- **v2.0+**: Breaking changes may be introduced with migration guides

---

## Last Updated

2024-12-19 - Initial v1 stability declaration

