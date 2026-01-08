import { describe, it, expect, beforeEach } from "vitest";
import { NegotiationSession, type CounterpartySummary } from "../index";
import { compilePolicy, DefaultPolicyGuard } from "../../policy/index";
import { signEnvelope, generateKeyPair, type SignedEnvelope } from "../../protocol/index";
import type { IntentMessage, AskMessage, BidMessage, AcceptMessage, RejectMessage } from "../../protocol/types";
import type { PactPolicy } from "../../policy/types";

// Helper to create a valid default policy
function createDefaultPolicy(overrides?: Partial<PactPolicy>): PactPolicy {
  const now = Date.now();
  const base: PactPolicy = {
    policy_version: "pact-policy/1.0",
    policy_id: "test-policy-12345678",
    name: "test-policy",
    mode: "balanced",
    created_at_ms: now,
    updated_at_ms: now,
    base: {
      kya: {
        trust: {
          require_trusted_issuer: false,
          trusted_issuers: ["self"],
          issuer_weights: { "self": 0.2 },
          min_trust_score: 0.0,
        },
      },
    },
    time: {
      max_clock_skew_ms: 5000,
      require_expires_at: false,
      default_message_ttl_ms: 200,
      min_valid_for_ms: 10,
      max_valid_for_ms: 5000,
    },
    admission: {
      require_one_of: ["bond"],
      min_open_bond: 0.000001,
      refund_open_bond_on_terminal: true,
      open_bond_forfeit_on_timeout_by_initiator: 0.0000002,
      require_session_keys: false,
      session_max_spend_per_hour: 0.05,
      session_intent_allowlist: [],
      new_agent: {
        is_new_below_reputation: 0.6,
        max_rounds: 1,
        bond_multiplier: 2.0,
        max_concurrent_negotiations: 2,
      },
    },
    negotiation: {
      max_rounds: 3,
      max_total_duration_ms: 300000,
      require_firm_quotes: false,
      firm_quote_valid_for_ms_range: [20, 200],
      allowed_actions: ["INTENT", "ASK", "BID", "ACCEPT", "REJECT"],
      reject_nonconforming_messages: true,
      counter_rules: {
        max_counters_by_buyer: 1,
        max_counters_by_seller: 1,
        min_step_pct: 0.02,
        max_step_pct: 0.5,
      },
      termination: {
        on_timeout: "TIMEOUT",
        on_invalid_message: "REJECT",
        on_invariant_violation: "REJECT",
      },
    },
    counterparty: {
      min_reputation: 0.75,
      min_age_ms: 0,
      exclude_new_agents: false,
      require_credentials: [],
      trusted_issuers: [],
      max_failure_rate: 0.05,
      max_timeout_rate: 0.05,
      region_allowlist: [],
      intent_specific: {},
    },
    sla: {
      max_latency_ms: 50,
      max_freshness_sec: 10,
      min_accuracy: null,
      verification: {
        require_schema_validation: false,
        schema_id: "test-schema",
        proof_type: "hash_reveal",
      },
      penalties: {
        on_latency_breach: { action: "auto_refund_pct", value: 0.5 },
        on_freshness_breach: { action: "auto_refund_pct", value: 0.5 },
        on_invalid_proof: { action: "slash_seller_bond_pct", value: 1.0 },
      },
    },
    economics: {
      reference_price: {
        use_receipt_history: false,
        lookback_count: 200,
        band_pct: 0.35,
        allow_band_override_if_urgent: true,
      },
      bonding: {
        seller_bond_multiple: 2.0,
        seller_min_bond: 0.00001,
        buyer_bond_optional: true,
        buyer_bond_pct_of_price: 0.1,
      },
      timeout_fees: {
        buyer_timeout_fee: 0.0000001,
        seller_timeout_fee: 0.0000001,
      },
    },
    settlement: {
      allowed_modes: ["hash_reveal", "streaming"],
      default_mode: "hash_reveal",
      pre_settlement_lock_required: false,
      challenge_window_ms: 150,
      streaming: {
        tick_ms: 20,
        max_spend_per_minute: 0.02,
        cutoff_on_violation: true,
      },
    },
    anti_gaming: {
      rate_limits: {
        per_agent_per_intent_per_min: 30,
        max_concurrent_negotiations: 10,
        probe_retry_cost: 0.00000005,
      },
      quote_accountability: {
        min_honor_rate: 0.95,
        penalty_on_low_honor: {
          increase_bond_multiplier: 0.25,
        },
      },
      collusion: {
        min_economic_substance: 0.00001,
        max_counterparty_concentration_pct: 0.6,
        rep_gain_discount_on_clique: 0.5,
      },
    },
    observability: {
      emit_receipts: true,
      receipt_fields: ["intent_type", "agreed_price"],
      store_full_transcripts: false,
      expose_explanations: {
        enabled: true,
        max_detail: "coarse",
      },
    },
    overrides: {
      allowed: true,
      types: ["policy_swap", "kill_switch", "budget_cap_update"],
      mid_round_intervention: false,
      kill_switch: {
        enabled: true,
        halt_on_trigger: true,
      },
      budgets: {
        max_spend_per_day: 1.0,
        max_spend_per_intent_per_day: {},
      },
    },
  };
  return { ...base, ...overrides } as PactPolicy;
}

describe("NegotiationSession", () => {
  let now: number;
  let nowFn: () => number;
  let buyerKeyPair: ReturnType<typeof generateKeyPair>;
  let sellerKeyPair: ReturnType<typeof generateKeyPair>;
  let policy: PactPolicy;
  let compiledPolicy: ReturnType<typeof compilePolicy>;
  let guard: DefaultPolicyGuard;

  beforeEach(() => {
    now = 1000000;
    nowFn = () => now;
    buyerKeyPair = generateKeyPair();
    sellerKeyPair = generateKeyPair();
    policy = createDefaultPolicy();
    compiledPolicy = compilePolicy(policy);
    guard = new DefaultPolicyGuard(compiledPolicy);
  });

  function createIntentMessage(sentAt: number, expiresAt: number): IntentMessage {
    return {
      protocol_version: "pact/1.0",
      type: "INTENT",
      intent_id: "test-intent-123",
      intent: "weather.data",
      scope: "NYC",
      constraints: {
        latency_ms: 50,
        freshness_sec: 10,
      },
      max_price: 0.0001,
      settlement_mode: "streaming",
      sent_at_ms: sentAt,
      expires_at_ms: expiresAt,
    };
  }

  function createAskMessage(intentId: string, sentAt: number, validFor: number): AskMessage {
    return {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: intentId,
      price: 0.00008,
      unit: "request",
      latency_ms: 50,
      valid_for_ms: validFor,
      bond_required: 0.00001,
      sent_at_ms: sentAt,
      expires_at_ms: sentAt + validFor,
    };
  }

  function createBidMessage(intentId: string, sentAt: number, validFor: number): BidMessage {
    return {
      protocol_version: "pact/1.0",
      type: "BID",
      intent_id: intentId,
      price: 0.00007,
      unit: "request",
      latency_ms: 50,
      valid_for_ms: validFor,
      bond_required: 0.00001,
      sent_at_ms: sentAt,
      expires_at_ms: sentAt + validFor,
    };
  }

  function createAcceptMessage(intentId: string, sentAt: number, expiresAt: number): AcceptMessage {
    return {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: intentId,
      agreed_price: 0.000075,
      settlement_mode: "streaming",
      proof_type: "streaming",
      challenge_window_ms: 150,
      delivery_deadline_ms: sentAt + 5000,
      sent_at_ms: sentAt,
      expires_at_ms: expiresAt,
    };
  }

  // Test 1: Happy path: INTENT -> ASK -> ACCEPT ends ACCEPTED
  it("should complete happy path: INTENT -> ASK -> ACCEPT", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    const result1 = await session.openWithIntent(intentEnvelope);
    expect(result1.ok).toBe(true);
    expect(session.getStatus()).toBe("INTENT_OPEN");

    // Process ASK (use valid_for_ms within firm quote range [20, 200])
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    const result2 = await session.onQuote(askEnvelope);
    expect(result2.ok).toBe(true);
    expect(session.getStatus()).toBe("NEGOTIATING");
    expect(session.getRound()).toBe(1);

    // Accept
    now += 500;
    const acceptMsg = createAcceptMessage("test-intent-123", now, now + 10000);
    const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
    const result3 = await session.accept(acceptEnvelope);
    expect(result3.ok).toBe(true);
    // After accept, status is LOCKED (funds locked) if settlement is provided, otherwise ACCEPTED
    // This test doesn't provide settlement, so it should be ACCEPTED
    expect(session.getStatus()).toBe("ACCEPTED");

    const finalResult = session.getResult();
    expect(finalResult?.ok).toBe(true);
    if (finalResult?.ok) {
      expect(finalResult.outcome).toBe("ACCEPTED");
      expect(finalResult.accept.intent_id).toBe("test-intent-123");
    }
  });

  // Test 2: Rejects quote if received before intent
  it("should reject quote if received before intent", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Try to process ASK before INTENT
    const askMsg = createAskMessage("test-intent-123", now, 1000);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    const result = await session.onQuote(askEnvelope);

    expect(result.ok).toBe(false);
    expect(result.code).toBe("FAILED_POLICY");
    expect(session.getStatus()).toBe("IDLE");
  });

  // Test 3: Timeout on elapsed_ms exceeds max_total_duration_ms
  it("should timeout when elapsed_ms exceeds max_total_duration_ms", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Advance time beyond max_total_duration_ms
    now += policy.negotiation.max_total_duration_ms + 1;
    session.tick();

    const result = session.getResult();
    expect(result?.ok).toBe(false);
    if (!result?.ok) {
      expect(result.outcome).toBe("TIMEOUT");
      expect(result.code).toBe("FAILED_NEGOTIATION_TIMEOUT");
    }
  });

  // Test 4: Timeout on round exceeds max_rounds
  it("should timeout when round exceeds max_rounds", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process multiple quotes to exceed max_rounds
    // After INTENT, round is 0. We can process max_rounds quotes (rounds 1, 2, 3)
    // The (max_rounds + 1)th quote should be rejected
    // Use valid_for_ms within firm quote range [20, 200]
    for (let i = 0; i < policy.negotiation.max_rounds; i++) {
      now += 1000;
      const askMsg = createAskMessage("test-intent-123", now, 100);
      const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
      const result = await session.onQuote(askEnvelope);
      expect(result.ok).toBe(true);
    }

    // Try one more quote - should be rejected
    now += 1000;
    const finalAskMsg = createAskMessage("test-intent-123", now, 100);
    const finalAskEnvelope = await signEnvelope(finalAskMsg, sellerKeyPair);
    const quoteResult = await session.onQuote(finalAskEnvelope);
    expect(quoteResult.ok).toBe(false);
    expect(quoteResult.code).toBe("FAILED_NEGOTIATION_TIMEOUT");

    const finalResult = session.getResult();
    expect(finalResult?.ok).toBe(false);
    if (!finalResult?.ok) {
      expect(finalResult.outcome).toBe("TIMEOUT");
      expect(finalResult.code).toBe("FAILED_NEGOTIATION_TIMEOUT");
    }
  });

  // Test 5: Invalid signature leads to FAILED_IDENTITY
  it("should fail with FAILED_IDENTITY on invalid signature", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Create INTENT with one keypair
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);

    // Tamper with signature
    intentEnvelope.signature_b58 = "invalid_signature";

    const result = await session.openWithIntent(intentEnvelope);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("FAILED_POLICY");

    const finalResult = session.getResult();
    expect(finalResult?.ok).toBe(false);
    if (!finalResult?.ok) {
      expect(finalResult.outcome).toBe("FAILED_IDENTITY");
      expect(finalResult.code).toBe("FAILED_POLICY");
    }
  });

  // Test 6: Firm quote expired -> TIMEOUT
  it("should timeout when firm quote expires", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK with valid_for_ms within range
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    await session.onQuote(askEnvelope);

    // Advance time beyond quote expiry
    // Create a quote that was sent in the past and is now expired
    now += 200;
    const expiredSentAt = now - 150; // Sent 150ms ago
    const expiredValidFor = 100; // Valid for 100ms
    const expiredAskMsg: AskMessage = {
      protocol_version: "pact/1.0",
      type: "ASK",
      intent_id: "test-intent-123",
      price: 0.00008,
      unit: "request",
      latency_ms: 50,
      valid_for_ms: expiredValidFor,
      bond_required: 0.00001,
      sent_at_ms: expiredSentAt,
      expires_at_ms: expiredSentAt + expiredValidFor, // This makes it expired (expires_at_ms < now)
    };
    const expiredAskEnvelope = await signEnvelope(expiredAskMsg, sellerKeyPair);
    const result = await session.onQuote(expiredAskEnvelope);

    // Should reject expired quote
    expect(result.ok).toBe(false);
    expect(result.code).toBe("FAILED_NEGOTIATION_TIMEOUT");
  });

  // Test 7: Reference band out-of-band causes FAILED_REFERENCE_BAND
  it("should reject quote when out of reference band", async () => {
    // Create policy with reference pricing enabled and enforced
    // Required settings for band enforcement:
    // - use_receipt_history: true (enables band checks)
    // - band_pct: 0.35 (35% band around p50)
    // - allow_band_override_if_urgent: false (strict enforcement, no override)
    const policyWithRef = createDefaultPolicy({
      economics: {
        reference_price: {
          use_receipt_history: true, // Must be true to enforce bands
          lookback_count: 200,
          band_pct: 0.35, // 35% band
          allow_band_override_if_urgent: false, // No override for this test
        },
        bonding: policy.economics.bonding,
        timeout_fees: policy.economics.timeout_fees,
      },
    });
    const compiledWithRef = compilePolicy(policyWithRef);
    const guardWithRef = new DefaultPolicyGuard(compiledWithRef);

    const session = new NegotiationSession({
      compiledPolicy: compiledWithRef,
      guard: guardWithRef,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK with price out of band
    // p50 = 1000, band = 35%, so range is [650, 1350]
    // Quote price 5000 is way out of band
    // Use valid_for_ms within firm quote range [20, 200] so it passes firm quote validation
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100); // 100ms is within [20, 200] range
    askMsg.price = 5000; // Out of band
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    const result = await session.onQuote(askEnvelope, undefined, 1000); // p50 = 1000, using default counterparty

    expect(result.ok).toBe(false);
    expect(result.code).toBe("FAILED_REFERENCE_BAND");

    const finalResult = session.getResult();
    expect(finalResult?.ok).toBe(false);
    if (!finalResult?.ok) {
      expect(finalResult.outcome).toBe("FAILED_POLICY");
      expect(finalResult.code).toBe("FAILED_REFERENCE_BAND");
    }
  });

  // Test 8: Urgent override allows out-of-band quote when policy allows
  it("should allow out-of-band quote when urgent and policy allows override", async () => {
    // Create policy with reference pricing enabled and urgent override allowed
    // Required settings for band enforcement with urgent override:
    // - use_receipt_history: true (enables band checks)
    // - band_pct: 0.35 (35% band around p50)
    // - allow_band_override_if_urgent: true (allows override when urgent)
    const policyWithUrgent = createDefaultPolicy({
      economics: {
        reference_price: {
          use_receipt_history: true, // Must be true to enforce bands
          lookback_count: 200,
          band_pct: 0.35, // 35% band
          allow_band_override_if_urgent: true, // Allow override when urgent
        },
        bonding: policy.economics.bonding,
        timeout_fees: policy.economics.timeout_fees,
      },
    });
    const compiledWithUrgent = compilePolicy(policyWithUrgent);
    const guardWithUrgent = new DefaultPolicyGuard(compiledWithUrgent);

    const session = new NegotiationSession({
      compiledPolicy: compiledWithUrgent,
      guard: guardWithUrgent,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT marked as urgent
    const intentMsg = createIntentMessage(now, now + 60000);
    intentMsg.urgent = true;
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK with price out of band but urgent
    // Use valid_for_ms within firm quote range [20, 200] so it passes firm quote validation
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100); // 100ms is within [20, 200] range
    askMsg.price = 5000; // Out of band
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    const result = await session.onQuote(askEnvelope, undefined, 1000); // p50 = 1000, using default counterparty

    // Should succeed because urgent override is enabled
    expect(result.ok).toBe(true);
    expect(session.getStatus()).toBe("NEGOTIATING");
  });

  // Additional test: Intent expiry
  it("should timeout when intent expires", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 10000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Advance time beyond intent expiry
    now += 10001;
    session.tick();

    const result = session.getResult();
    expect(result?.ok).toBe(false);
    if (!result?.ok) {
      expect(result.outcome).toBe("TIMEOUT");
      expect(result.code).toBe("FAILED_NEGOTIATION_TIMEOUT");
    }
  });

  // Additional test: REJECT message terminates session
  it("should terminate with REJECTED on REJECT message", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Send REJECT (buyer is rejecting)
    now += 1000;
    const rejectMsg: RejectMessage = {
      protocol_version: "pact/1.0",
      type: "REJECT",
      intent_id: "test-intent-123",
      reason: "Price too high",
      code: "QUOTE_OUT_OF_BAND",
      sent_at_ms: now,
      expires_at_ms: now + 10000,
    };
    const rejectEnvelope = await signEnvelope(rejectMsg, buyerKeyPair);
    const result = await session.reject(rejectEnvelope);

    expect(result.ok).toBe(true);
    expect(session.getStatus()).toBe("REJECTED");

    const finalResult = session.getResult();
    expect(finalResult?.ok).toBe(false);
    if (!finalResult?.ok) {
      expect(finalResult.outcome).toBe("REJECTED");
      expect(finalResult.code).toBe("QUOTE_OUT_OF_BAND");
    }
  });
});

