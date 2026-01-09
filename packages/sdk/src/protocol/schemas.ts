import { z } from "zod";
import type { FailureCode } from "../policy/types";

const protocolVersion = z.literal("pact/1.0");
const settlementMode = z.enum(["hash_reveal", "streaming"]);
const proofType = z.enum(["hash_reveal", "streaming"]);
const unit = z.enum(["request", "ms", "byte", "custom"]);

const intentConstraintsSchema = z.object({
  latency_ms: z.number().int().nonnegative(),
  freshness_sec: z.number().int().nonnegative(),
});

const failureCodeSchema = z.enum([
  "MISSING_EXPIRES_AT",
  "INTENT_EXPIRED",
  "VALID_FOR_TOO_SHORT",
  "VALID_FOR_TOO_LONG",
  "CLOCK_SKEW_TOO_LARGE",
  "INTENT_NOT_ALLOWED",
  "SESSION_SPEND_CAP_EXCEEDED",
  "UNTRUSTED_ISSUER",
  "ONE_OF_ADMISSION_FAILED",
  "ROUND_EXCEEDED",
  "DURATION_EXCEEDED",
  "FIRM_QUOTE_MISSING_VALID_FOR",
  "FIRM_QUOTE_OUT_OF_RANGE",
  "NEW_AGENT_EXCLUDED",
  "REGION_NOT_ALLOWED",
  "FAILURE_RATE_TOO_HIGH",
  "TIMEOUT_RATE_TOO_HIGH",
  "MISSING_REQUIRED_CREDENTIALS",
  "QUOTE_OUT_OF_BAND",
  "FAILED_REFERENCE_BAND",
  "SETTLEMENT_MODE_NOT_ALLOWED",
  "PRE_SETTLEMENT_LOCK_REQUIRED",
  "BOND_INSUFFICIENT",
  "SETTLEMENT_FAILED", // v1.7.2+: Settlement provider commit failure
  "SCHEMA_VALIDATION_FAILED",
  "STREAMING_SPEND_CAP_EXCEEDED",
  "LATENCY_BREACH",
  "FRESHNESS_BREACH",
  "TRANSCRIPT_STORAGE_FORBIDDEN",
  "INVALID_POLICY",
]);

export const intentSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("INTENT"),
    intent_id: z.string(),
    intent: z.string(),
    scope: z.union([z.string(), z.object({}).passthrough()]),
    constraints: intentConstraintsSchema,
    max_price: z.number().positive(),
    settlement_mode: settlementMode,
    urgent: z.boolean().optional(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms > data.sent_at_ms, {
    message: "expires_at_ms must be greater than sent_at_ms",
    path: ["expires_at_ms"],
  });

export const askSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("ASK"),
    intent_id: z.string(),
    price: z.number().positive(),
    unit: unit,
    latency_ms: z.number().int().nonnegative(),
    valid_for_ms: z.number().int().positive(),
    bond_required: z.number().nonnegative(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms === data.sent_at_ms + data.valid_for_ms, {
    message: "expires_at_ms must equal sent_at_ms + valid_for_ms",
    path: ["expires_at_ms"],
  });

export const bidSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("BID"),
    intent_id: z.string(),
    price: z.number().positive(),
    unit: unit,
    latency_ms: z.number().int().nonnegative(),
    valid_for_ms: z.number().int().positive(),
    bond_required: z.number().nonnegative(),
    bond_offered: z.number().nonnegative().optional(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms === data.sent_at_ms + data.valid_for_ms, {
    message: "expires_at_ms must equal sent_at_ms + valid_for_ms",
    path: ["expires_at_ms"],
  });

export const acceptSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("ACCEPT"),
    intent_id: z.string(),
    agreed_price: z.number().positive(),
    settlement_mode: settlementMode,
    proof_type: proofType,
    challenge_window_ms: z.number().int().nonnegative(),
    delivery_deadline_ms: z.number().int().nonnegative(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms > data.sent_at_ms, {
    message: "expires_at_ms must be greater than sent_at_ms",
    path: ["expires_at_ms"],
  });

export const rejectSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("REJECT"),
    intent_id: z.string(),
    reason: z.string(),
    code: failureCodeSchema.optional(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms > data.sent_at_ms, {
    message: "expires_at_ms must be greater than sent_at_ms",
    path: ["expires_at_ms"],
  });

export const commitSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("COMMIT"),
    intent_id: z.string(),
    commit_hash_hex: z.string().length(64).regex(/^[0-9a-f]+$/i),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms > data.sent_at_ms, {
    message: "expires_at_ms must be greater than sent_at_ms",
    path: ["expires_at_ms"],
  });

export const revealSchema = z
  .object({
    protocol_version: protocolVersion,
    type: z.literal("REVEAL"),
    intent_id: z.string(),
    payload_b64: z.string(),
    nonce_b64: z.string(),
    sent_at_ms: z.number().int().nonnegative(),
    expires_at_ms: z.number().int().nonnegative(),
  })
  .refine((data) => data.expires_at_ms > data.sent_at_ms, {
    message: "expires_at_ms must be greater than sent_at_ms",
    path: ["expires_at_ms"],
  });

export const receiptSchema = z.object({
  protocol_version: protocolVersion,
  type: z.literal("RECEIPT"),
  intent_id: z.string(),
  buyer_agent_id: z.string(),
  seller_agent_id: z.string(),
  agreed_price: z.number().positive(),
  fulfilled: z.boolean(),
  latency_ms: z.number().int().nonnegative().optional(),
  failure_code: failureCodeSchema.optional(),
  timestamp_ms: z.number().int().nonnegative(),
});

export const pactMessageSchema = z.union([
    intentSchema,
    askSchema,
    bidSchema,
    acceptSchema,
    rejectSchema,
    commitSchema,
    revealSchema,
    receiptSchema,
  ]);  

export type ParsedPactMessage = z.infer<typeof pactMessageSchema>;

export function parseMessage(input: unknown): ParsedPactMessage {
  return pactMessageSchema.parse(input);
}

