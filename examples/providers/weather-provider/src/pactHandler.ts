/**
 * Pact Protocol Handler for Weather Provider
 * 
 * Handles weather.data product with deterministic pricing:
 * - Base price per request
 * - Surcharge if freshness_seconds < 120
 * - Surcharge if max_latency_ms < 500
 */

import type {
  SignedEnvelope,
  ParsedPactMessage,
  IntentMessage,
  AskMessage,
  AcceptMessage,
  RejectMessage,
} from "@pact/sdk";
import {
  parseEnvelope,
  signEnvelope,
  generateKeyPair,
  DefaultPolicyGuard,
  validatePolicyJson,
} from "@pact/sdk";
import { defaultPolicy } from "./policy.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Transcript directory
const TRANSCRIPT_DIR = path.join(process.cwd(), ".pact", "transcripts");

/**
 * Ensure transcript directory exists
 */
export function ensureTranscriptDir(): void {
  if (!fs.existsSync(TRANSCRIPT_DIR)) {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
  }
}

/**
 * Emit transcript to .pact/transcripts directory
 */
function emitTranscript(message: ParsedPactMessage): void {
  ensureTranscriptDir();

  const transcript = {
    timestamp: new Date().toISOString(),
    provider_id: providerId.substring(0, 16) + "...",
    message_type: message.type,
    intent_id: "intent_id" in message ? message.intent_id : undefined,
    price: "price" in message ? message.price : ("agreed_price" in message ? message.agreed_price : undefined),
    product: "intent" in message ? message.intent : undefined,
  };

  // Save transcript JSON file
  const filename = `intent-${transcript.intent_id || "unknown"}-${Date.now()}.json`;
  const filepath = path.join(TRANSCRIPT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(transcript, null, 2));

  // Print transcript path (required by constraints)
  console.log(`📄 Transcript: ${filepath}`);
}

// Provider identity (deterministic for demo - use fixed seed in production)
const providerKeypair = generateKeyPair();
const providerId = Buffer.from(providerKeypair.publicKey).toString("base64");

// Policy guard for validation
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(`Policy validation failed: ${JSON.stringify(policyValidation.errors)}`);
}
const policyGuard = new DefaultPolicyGuard(policyValidation.policy);

/**
 * Calculate deterministic price for weather.data product
 */
function calculatePrice(intent: IntentMessage): number {
  const basePrice = 0.00008; // Base price per request

  // Extract params from scope
  const scope = intent.scope;
  const city = typeof scope === "string" ? scope : (scope as any)?.city || "NYC";
  const freshnessSeconds = intent.constraints?.freshness_sec || 300;
  const maxLatencyMs = intent.constraints?.latency_ms || 1000;

  // Surcharges
  let surcharge = 0;

  // Surcharge if freshness_seconds < 120 (real-time data is more expensive)
  if (freshnessSeconds < 120) {
    surcharge += 0.00002;
  }

  // Surcharge if max_latency_ms < 500 (low latency requires premium infrastructure)
  if (maxLatencyMs < 500) {
    surcharge += 0.00001;
  }

  const totalPrice = basePrice + surcharge;

  // Never exceed buyer's max_price
  return Math.min(totalPrice, intent.max_price);
}

/**
 * Generate weather data (mock - deterministic for demo)
 */
function generateWeatherData(city: string): any {
  // Deterministic weather data based on city
  const cityHash = city.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const baseTemp = 72 + (cityHash % 20); // Temperature between 72-92°F
  const conditions = ["sunny", "cloudy", "partly_cloudy", "clear"][cityHash % 4];

  return {
    city,
    temperature_f: baseTemp,
    condition: conditions,
    humidity: 45 + (cityHash % 20),
    wind_speed_mph: 5 + (cityHash % 10),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Main handler for Pact protocol requests
 */
export async function handlePactRequest(envelope: SignedEnvelope): Promise<SignedEnvelope> {
  // Ensure transcript directory exists
  ensureTranscriptDir();

  // Parse and validate envelope
  const parsed = await parseEnvelope(envelope);

  // Emit transcript to .pact/transcripts
  emitTranscript(parsed.message);

  // Route by message type
  switch (parsed.message.type) {
    case "INTENT":
      return handleIntent(parsed.message as IntentMessage);

    case "BID":
      return handleBid(parsed.message as any);

    case "ACCEPT":
      return handleAccept(parsed.message as AcceptMessage);

    case "REJECT":
      return handleReject(parsed.message as RejectMessage);

    default:
      throw new Error(`Unsupported message type: ${parsed.message.type}`);
  }
}

/**
 * Handle INTENT message - generate ASK quote
 */
async function handleIntent(intent: IntentMessage): Promise<SignedEnvelope> {
  // Validate intent matches our product
  if (intent.intent !== "weather.data") {
    throw new Error(`Unsupported intent type: ${intent.intent}`);
  }

  // Validate intent against policy
  const intentContext = {
    intent_type: intent.intent,
    max_price: intent.max_price,
    constraints: intent.constraints,
    expires_at_ms: intent.expires_at_ms,
    sent_at_ms: intent.sent_at_ms,
    protocol_version: intent.protocol_version,
  };

  const validation = policyGuard.checkIntent(intentContext);
  if (!validation.ok) {
    throw new Error(`Intent validation failed: ${validation.code}`);
  }

  // Calculate deterministic price
  const price = calculatePrice(intent);

  if (price > intent.max_price) {
    throw new Error(`Price ${price} exceeds max_price ${intent.max_price}`);
  }

  const nowMs = Date.now();
  const validForMs = 20000; // Quote valid for 20 seconds

  // Build ASK message
  const askMessage: AskMessage = {
    protocol_version: "pact/1.0",
    type: "ASK",
    intent_id: intent.intent_id,
    price,
    unit: "request",
    latency_ms: intent.constraints.latency_ms || 100,
    valid_for_ms: validForMs,
    bond_required: Math.max(0.00001, price * 2),
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + validForMs,
  };

  // Sign response
  return await signEnvelope(askMessage, providerKeypair, nowMs);
}

/**
 * Handle BID message - respond with updated ASK or ACCEPT
 */
async function handleBid(bid: any): Promise<SignedEnvelope> {
  // Simple strategy: Accept if bid is reasonable (within 20% of our ask)
  const originalIntent = bid.intent_id ? { intent_id: bid.intent_id, intent: "weather.data", max_price: bid.price * 1.5, constraints: {} } as IntentMessage : null;
  const basePrice = originalIntent ? calculatePrice(originalIntent) : 0.00008;

  if (bid.price >= basePrice * 0.8) {
    // Accept the bid
    const nowMs = Date.now();
    const acceptMessage: AcceptMessage = {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: bid.intent_id,
      agreed_price: bid.price,
      settlement_mode: "hash_reveal",
      proof_type: "hash_reveal",
      challenge_window_ms: 100,
      delivery_deadline_ms: nowMs + 60000,
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 30000,
    };

    return await signEnvelope(acceptMessage, providerKeypair, nowMs);
  } else {
    // Counter with new ASK
    const counterPrice = Math.min(basePrice * 0.95, bid.price * 1.1);

    const nowMs = Date.now();
    const askMessage: AskMessage = {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: bid.intent_id,
      price: counterPrice,
      unit: "request",
      latency_ms: bid.latency_ms || 100,
      valid_for_ms: 20000,
      bond_required: Math.max(0.00001, counterPrice * 2),
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 20000,
    };

    return await signEnvelope(askMessage, providerKeypair, nowMs);
  }
}

/**
 * Handle ACCEPT message - prepare settlement and deliver weather data
 */
async function handleAccept(accept: AcceptMessage): Promise<SignedEnvelope> {
  // Extract city from intent (stored in transaction state or reconstructed)
  const city = "NYC"; // Default - in production, retrieve from intent context

  // Generate weather data (mock)
  const weatherData = generateWeatherData(city);

  // Settlement is handled by settlement.ts module
  // This is just acknowledgment

  const nowMs = Date.now();
  const acceptAck: AcceptMessage = {
    protocol_version: "pact/1.0",
    type: "ACCEPT",
    intent_id: accept.intent_id,
    agreed_price: accept.agreed_price,
    settlement_mode: accept.settlement_mode,
    proof_type: accept.proof_type,
    challenge_window_ms: accept.challenge_window_ms,
    delivery_deadline_ms: accept.delivery_deadline_ms,
    sent_at_ms: nowMs,
    expires_at_ms: accept.expires_at_ms,
  };

  console.log(`[Weather] Generated weather data for ${city}:`, weatherData);

  return await signEnvelope(acceptAck, providerKeypair, nowMs);
}

/**
 * Handle REJECT message - cleanup
 */
async function handleReject(reject: RejectMessage): Promise<SignedEnvelope> {
  const nowMs = Date.now();
  const rejectAck: RejectMessage = {
    protocol_version: "pact/1.0",
    type: "REJECT",
    intent_id: reject.intent_id,
    reason: reject.reason || "Negotiation rejected",
    code: reject.code,
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + 30000,
  };

  return await signEnvelope(rejectAck, providerKeypair, nowMs);
}
