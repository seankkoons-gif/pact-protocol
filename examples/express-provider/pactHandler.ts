/**
 * Pact Protocol Handler
 * 
 * Uses @pact/sdk to handle protocol messages. Demonstrates:
 * - Quote generation (ASK messages)
 * - Accept/reject logic
 * - Settlement prepare/commit hooks
 * - Transcript emission
 */

import type { SignedEnvelope, ParsedPactMessage, IntentMessage, AskMessage, BidMessage, AcceptMessage, RejectMessage } from "@pact/sdk";
import { 
  parseEnvelope, 
  signEnvelope, 
  generateKeyPair,
  DefaultPolicyGuard,
  createDefaultPolicy,
  validatePolicyJson
} from "@pact/sdk";

// Provider identity (in production: load from secure storage)
const providerKeypair = generateKeyPair();
const providerId = Buffer.from(providerKeypair.publicKey).toString("base64");

// Policy guard for validation (uses default policy)
const defaultPolicy = createDefaultPolicy();
// Relax policy for demo (allow any reputation)
defaultPolicy.counterparty.min_reputation = 0.0;
const policyValidation = validatePolicyJson(defaultPolicy);
if (!policyValidation.ok) {
  throw new Error(`Policy validation failed: ${JSON.stringify(policyValidation.errors)}`);
}
const policyGuard = new DefaultPolicyGuard(policyValidation.policy);

// In-memory state (in production: use persistent storage)
interface NegotiationState {
  intentId: string;
  agreedPrice?: number;
  settlementHandleId?: string;
}

const negotiations = new Map<string, NegotiationState>();

/**
 * Main handler for Pact protocol requests
 */
export async function handlePactRequest(
  envelope: SignedEnvelope
): Promise<SignedEnvelope> {
  // Parse and validate envelope (SDK handles protocol validation)
  const parsed = await parseEnvelope(envelope);
  
  // Emit transcript to console
  emitTranscript(parsed.message);
  
  // Route by message type
  switch (parsed.message.type) {
    case "INTENT":
      return handleIntent(parsed.message as IntentMessage);
    
    case "BID":
      return handleBid(parsed.message as BidMessage);
    
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
 * 
 * Demonstrates: Quote generation using provider-specific pricing logic
 */
async function handleIntent(intent: IntentMessage): Promise<SignedEnvelope> {
  // Validate intent against policy (SDK handles policy enforcement)
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
  
  // Provider-specific pricing logic (NOT hardcoded - calculate based on intent)
  // Example: base price + urgency premium + constraint adjustments
  const basePrice = calculateQuotePrice(intent);
  
  // Ensure price is within buyer's max_price
  const price = Math.min(basePrice, intent.max_price);
  
  if (price > intent.max_price) {
    throw new Error(`Price ${price} exceeds max_price ${intent.max_price}`);
  }
  
  const nowMs = Date.now();
  const validForMs = 20000; // Quote valid for 20 seconds
  
  // Build ASK message (protocol-defined structure)
  const askMessage: AskMessage = {
    protocol_version: "pact/1.0",
    type: "ASK",
    intent_id: intent.intent_id,
    price,
    unit: "request",
    latency_ms: intent.constraints.latency_ms,
    valid_for_ms: validForMs,
    bond_required: Math.max(0.00001, price * 2), // 2x price as bond
    sent_at_ms: nowMs,
    expires_at_ms: nowMs + validForMs,
  };
  
  // Sign response (SDK handles cryptographic signing)
  const response = await signEnvelope(askMessage, providerKeypair, nowMs);
  
  // Track negotiation state
  negotiations.set(intent.intent_id, { intentId: intent.intent_id });
  
  return response;
}

/**
 * Handle BID message - respond with updated ASK or ACCEPT
 * 
 * Demonstrates: Counter-offer logic
 */
async function handleBid(bid: BidMessage): Promise<SignedEnvelope> {
  const negotiation = negotiations.get(bid.intent_id);
  if (!negotiation) {
    throw new Error(`No negotiation found for intent ${bid.intent_id}`);
  }
  
  // Simple strategy: Accept if bid is >= 80% of our last ask
  // (In production: use more sophisticated negotiation strategies)
  const lastAsk = bid.price * 1.25; // Assume last ask was 25% above this bid
  
  if (bid.price >= lastAsk * 0.8) {
    // Accept the bid
    const nowMs = Date.now();
    const acceptMessage: AcceptMessage = {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: bid.intent_id,
      agreed_price: bid.price,
      settlement_mode: "hash_reveal", // Default for demo
      proof_type: "hash_reveal",
      challenge_window_ms: 100,
      delivery_deadline_ms: nowMs + 60000, // 60 seconds
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 30000,
    };
    
    negotiation.agreedPrice = bid.price;
    return await signEnvelope(acceptMessage, providerKeypair, nowMs);
  } else {
    // Counter with new ASK
    const counterPrice = Math.min(lastAsk * 0.95, bid.price * 1.1); // Slight concession
    
    const nowMs = Date.now();
    const askMessage: AskMessage = {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: bid.intent_id,
      price: counterPrice,
      unit: "request",
      latency_ms: bid.latency_ms || 50,
      valid_for_ms: 20000,
      bond_required: Math.max(0.00001, counterPrice * 2),
      sent_at_ms: nowMs,
      expires_at_ms: nowMs + 20000,
    };
    
    return await signEnvelope(askMessage, providerKeypair, nowMs);
  }
}

/**
 * Handle ACCEPT message - prepare settlement
 * 
 * Demonstrates: Settlement prepare hook
 * 
 * Note: In the full protocol, ACCEPT from buyer triggers settlement lock.
 * This handler demonstrates the settlement prepare hook integration point.
 */
async function handleAccept(accept: AcceptMessage): Promise<SignedEnvelope> {
  const negotiation = negotiations.get(accept.intent_id);
  if (!negotiation) {
    throw new Error(`No negotiation found for intent ${accept.intent_id}`);
  }
  
  negotiation.agreedPrice = accept.agreed_price;
  
  // Settlement prepare hook (demonstrates settlement integration point)
  // In production: This would be called after buyer locks funds
  const handleId = await prepareSettlement({
    intentId: accept.intent_id,
    amount: accept.agreed_price,
    bondAmount: accept.agreed_price * 2,
  });
  
  negotiation.settlementHandleId = handleId;
  
  // Echo ACCEPT back (acknowledgment that settlement is prepared)
  // In full protocol flow, seller would send COMMIT message after preparing
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
  
  return await signEnvelope(acceptAck, providerKeypair, nowMs);
}

/**
 * Handle REJECT message - cleanup
 * 
 * Demonstrates: Rejection handling
 */
async function handleReject(reject: RejectMessage): Promise<SignedEnvelope> {
  // Cleanup negotiation state
  negotiations.delete(reject.intent_id);
  
  // Echo rejection back (in production: may send acknowledgment)
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

/**
 * Calculate quote price based on intent (provider-specific logic)
 * 
 * NOT hardcoded - calculates based on:
 * - Intent type
 * - Constraints (latency, freshness)
 * - Urgency
 */
function calculateQuotePrice(intent: IntentMessage): number {
  // Base price per intent type (in production: load from config/database)
  const basePrices: Record<string, number> = {
    "weather.data": 0.00008,
    "compute.inference": 0.00012,
    "data.query": 0.00005,
  };
  
  const basePrice = basePrices[intent.intent] || 0.0001;
  
  // Adjust for constraints
  let price = basePrice;
  
  // Lower latency = higher price
  if (intent.constraints.latency_ms < 50) {
    price *= 1.2;
  }
  
  // Lower freshness (fresher data) = higher price
  if (intent.constraints.freshness_sec < 10) {
    price *= 1.1;
  }
  
  // Urgency premium
  if (intent.urgent) {
    price *= 1.15;
  }
  
  return price;
}

/**
 * Settlement prepare hook
 * 
 * Demonstrates: Settlement integration point (prepare/commit lifecycle)
 * In production: Call actual settlement backend (escrow, payment processor, etc.)
 */
async function prepareSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
}): Promise<string> {
  const handleId = `settlement-${params.intentId}-${Date.now()}`;
  
  console.log(`[Settlement] Prepare:`);
  console.log(`  Intent ID: ${params.intentId}`);
  console.log(`  Amount: ${params.amount}`);
  console.log(`  Bond: ${params.bondAmount}`);
  console.log(`  Handle ID: ${handleId}`);
  console.log(`  Status: Prepared (ready for commit)\n`);
  
  // In production: Call settlement provider
  // await settlementProvider.prepare({ ... });
  
  return handleId;
}

/**
 * Settlement commit hook (called after delivery)
 * 
 * Demonstrates: Settlement commit integration point
 */
export async function commitSettlement(handleId: string, proof: string): Promise<void> {
  console.log(`[Settlement] Commit:`);
  console.log(`  Handle ID: ${handleId}`);
  console.log(`  Proof: ${proof.substring(0, 20)}...`);
  console.log(`  Status: Committed (payment released)\n`);
  
  // In production: Call settlement provider
  // await settlementProvider.commit({ handleId, proof });
}

/**
 * Emit transcript to console
 * 
 * Demonstrates: Transcript emission for audit/debugging
 */
function emitTranscript(message: ParsedPactMessage): void {
  const transcript = {
    timestamp: new Date().toISOString(),
    provider_id: providerId.substring(0, 16) + "...",
    message_type: message.type,
    intent_id: "intent_id" in message ? message.intent_id : undefined,
    price: "price" in message ? message.price : undefined,
  };
  
  console.log(`[Transcript] ${JSON.stringify(transcript, null, 2)}`);
}
