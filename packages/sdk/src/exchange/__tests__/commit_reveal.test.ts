import { describe, it, expect, beforeEach } from "vitest";
import { NegotiationSession } from "../../engine/index";
import { compilePolicy, DefaultPolicyGuard } from "../../policy/index";
import { signEnvelope, generateKeyPair, type SignedEnvelope } from "../../protocol/index";
import type { IntentMessage, AskMessage, AcceptMessage, CommitMessage, RevealMessage } from "../../protocol/types";
import type { PactPolicy } from "../../policy/types";
import { MockSettlementProvider } from "../../settlement/index";
import { computeCommitHash } from "../commit";

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

describe("Commit/Reveal Exchange", () => {
  let now: number;
  let nowFn: () => number;
  let buyerKeyPair: ReturnType<typeof generateKeyPair>;
  let sellerKeyPair: ReturnType<typeof generateKeyPair>;
  let policy: PactPolicy;
  let compiledPolicy: ReturnType<typeof compilePolicy>;
  let guard: DefaultPolicyGuard;
  let settlement: MockSettlementProvider;

  beforeEach(() => {
    now = 1000000;
    nowFn = () => now;
    buyerKeyPair = generateKeyPair();
    sellerKeyPair = generateKeyPair();
    policy = createDefaultPolicy();
    compiledPolicy = compilePolicy(policy);
    guard = new DefaultPolicyGuard(compiledPolicy);
    settlement = new MockSettlementProvider();
    settlement.setBalance("buyer", 1.0);
    settlement.setBalance("seller", 1.0);
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
      settlement_mode: "hash_reveal",
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

  function createAcceptMessage(intentId: string, sentAt: number, expiresAt: number): AcceptMessage {
    return {
      protocol_version: "pact/1.0",
      type: "ACCEPT",
      intent_id: intentId,
      agreed_price: 0.000075,
      settlement_mode: "hash_reveal",
      proof_type: "hash_reveal",
      challenge_window_ms: 150,
      delivery_deadline_ms: sentAt + 5000,
      sent_at_ms: sentAt,
      expires_at_ms: expiresAt,
    };
  }

  function createCommitMessage(intentId: string, commitHash: string, sentAt: number, expiresAt: number): CommitMessage {
    return {
      protocol_version: "pact/1.0",
      type: "COMMIT",
      intent_id: intentId,
      commit_hash_hex: commitHash,
      sent_at_ms: sentAt,
      expires_at_ms: expiresAt,
    };
  }

  function createRevealMessage(intentId: string, payloadB64: string, nonceB64: string, sentAt: number, expiresAt: number): RevealMessage {
    return {
      protocol_version: "pact/1.0",
      type: "REVEAL",
      intent_id: intentId,
      payload_b64: payloadB64,
      nonce_b64: nonceB64,
      sent_at_ms: sentAt,
      expires_at_ms: expiresAt,
    };
  }

  // Test 1: Happy path
  it("should complete happy path: accept -> lock -> commit -> reveal -> receipt", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
      settlement,
      buyerAgentId: "buyer",
      sellerAgentId: "seller",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    await session.onQuote(askEnvelope);

    // Accept
    now += 500;
    const acceptMsg = createAcceptMessage("test-intent-123", now, now + 10000);
    const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
    const acceptResult = await session.accept(acceptEnvelope);
    expect(acceptResult.ok).toBe(true);
    expect(session.getStatus()).toBe("LOCKED");

    // Check agreement created
    const agreement = session.getAgreement();
    expect(agreement).toBeDefined();
    expect(agreement?.status).toBe("LOCKED");

    // Check funds locked
    const buyerAccount = settlement.getAccount("buyer");
    expect(buyerAccount?.locked).toBe(0.000075);
    expect(buyerAccount?.balance).toBe(1.0 - 0.000075);

    const sellerAccount = settlement.getAccount("seller");
    expect(sellerAccount?.locked).toBe(0.00001); // bond
    expect(sellerAccount?.balance).toBe(1.0 - 0.00001);

    // Commit
    now += 100;
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    const commitHash = computeCommitHash(payloadB64, nonceB64);
    const commitMsg = createCommitMessage("test-intent-123", commitHash, now, now + 10000);
    const commitEnvelope = await signEnvelope(commitMsg, sellerKeyPair);
    const commitResult = await session.onCommit(commitEnvelope);
    expect(commitResult.ok).toBe(true);
    expect(session.getStatus()).toBe("EXCHANGING");

    // Reveal
    now += 100;
    const revealMsg = createRevealMessage("test-intent-123", payloadB64, nonceB64, now, now + 10000);
    const revealEnvelope = await signEnvelope(revealMsg, sellerKeyPair);
    const revealResult = await session.onReveal(revealEnvelope);
    expect(revealResult.ok).toBe(true);
    expect(session.getStatus()).toBe("ACCEPTED");

    // Check agreement completed
    expect(agreement?.status).toBe("COMPLETED");

    // Check funds released
    const finalBuyerAccount = settlement.getAccount("buyer");
    expect(finalBuyerAccount?.balance).toBe(1.0 - 0.000075); // Payment deducted
    expect(finalBuyerAccount?.locked).toBe(0);

    const finalSellerAccount = settlement.getAccount("seller");
    // Seller: starts 1.0, locks 0.00001 bond (balance 0.99999), unlocks bond (balance 1.0), receives payment (balance 1.000075)
    expect(finalSellerAccount?.balance).toBe(1.0 + 0.000075); // Original + payment (bond was unlocked back)
    expect(finalSellerAccount?.locked).toBe(0);

    // Check receipt
    const receipt = session.getReceipt();
    expect(receipt).toBeDefined();
    expect(receipt?.fulfilled).toBe(true);
    expect(receipt?.failure_code).toBeUndefined();
  });

  // Test 2: Seller fails to reveal
  it("should slash seller when reveal deadline passes", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
      settlement,
      buyerAgentId: "buyer",
      sellerAgentId: "seller",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK and ACCEPT
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    await session.onQuote(askEnvelope);

    now += 500;
    const acceptMsg = createAcceptMessage("test-intent-123", now, now + 10000);
    acceptMsg.delivery_deadline_ms = now + 1000; // Short deadline
    const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
    await session.accept(acceptEnvelope);

    // Commit
    now += 100;
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    const commitHash = computeCommitHash(payloadB64, nonceB64);
    const commitMsg = createCommitMessage("test-intent-123", commitHash, now, now + 10000);
    const commitEnvelope = await signEnvelope(commitMsg, sellerKeyPair);
    await session.onCommit(commitEnvelope);

    // Advance time beyond deadline
    now += 2000;
    session.tick();

    // Check seller slashed
    const buyerAccount = settlement.getAccount("buyer");
    expect(buyerAccount?.balance).toBe(1.0 + 0.00001); // Refunded payment + slashed bond
    expect(buyerAccount?.locked).toBe(0);

    const sellerAccount = settlement.getAccount("seller");
    expect(sellerAccount?.balance).toBe(1.0 - 0.00001); // Bond slashed
    expect(sellerAccount?.locked).toBe(0);

    // Check receipt
    const receipt = session.getReceipt();
    expect(receipt).toBeDefined();
    expect(receipt?.fulfilled).toBe(false);
    expect(receipt?.failure_code).toBe("FAILED_PROOF");

    const agreement = session.getAgreement();
    expect(agreement?.status).toBe("SLASHED");
  });

  // Test 3: Hash mismatch
  it("should slash seller when reveal hash does not match commit", async () => {
    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
      settlement,
      buyerAgentId: "buyer",
      sellerAgentId: "seller",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK and ACCEPT
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    await session.onQuote(askEnvelope);

    now += 500;
    const acceptMsg = createAcceptMessage("test-intent-123", now, now + 10000);
    const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
    await session.accept(acceptEnvelope);

    // Commit with correct hash
    now += 100;
    const payloadB64 = Buffer.from("test payload").toString("base64");
    const nonceB64 = Buffer.from("test nonce").toString("base64");
    const commitHash = computeCommitHash(payloadB64, nonceB64);
    const commitMsg = createCommitMessage("test-intent-123", commitHash, now, now + 10000);
    const commitEnvelope = await signEnvelope(commitMsg, sellerKeyPair);
    await session.onCommit(commitEnvelope);

    // Reveal with wrong payload (hash mismatch)
    now += 100;
    const wrongPayloadB64 = Buffer.from("wrong payload").toString("base64");
    const revealMsg = createRevealMessage("test-intent-123", wrongPayloadB64, nonceB64, now, now + 10000);
    const revealEnvelope = await signEnvelope(revealMsg, sellerKeyPair);
    const revealResult = await session.onReveal(revealEnvelope);

    expect(revealResult.ok).toBe(false);
    expect(revealResult.code).toBe("FAILED_PROOF");

    // Check seller slashed
    const buyerAccount = settlement.getAccount("buyer");
    expect(buyerAccount?.balance).toBe(1.0 + 0.00001); // Refunded payment + slashed bond
    expect(buyerAccount?.locked).toBe(0);

    const sellerAccount = settlement.getAccount("seller");
    expect(sellerAccount?.balance).toBe(1.0 - 0.00001); // Bond slashed
    expect(sellerAccount?.locked).toBe(0);

    // Check receipt
    const receipt = session.getReceipt();
    expect(receipt).toBeDefined();
    expect(receipt?.fulfilled).toBe(false);
    expect(receipt?.failure_code).toBe("FAILED_PROOF");

    const agreement = session.getAgreement();
    expect(agreement?.status).toBe("SLASHED");
  });

  // Test 4: Escrow failure - insufficient buyer balance
  it("should fail with FAILED_ESCROW when buyer has insufficient balance", async () => {
    settlement.setBalance("buyer", 0.00001); // Less than agreed_price

    const session = new NegotiationSession({
      compiledPolicy,
      guard,
      now: nowFn,
      role: "buyer",
      settlement,
      buyerAgentId: "buyer",
      sellerAgentId: "seller",
    });

    // Open with INTENT
    const intentMsg = createIntentMessage(now, now + 60000);
    const intentEnvelope = await signEnvelope(intentMsg, buyerKeyPair);
    await session.openWithIntent(intentEnvelope);

    // Process ASK
    now += 1000;
    const askMsg = createAskMessage("test-intent-123", now, 100);
    const askEnvelope = await signEnvelope(askMsg, sellerKeyPair);
    await session.onQuote(askEnvelope);

    // Accept - should fail to lock funds
    now += 500;
    const acceptMsg = createAcceptMessage("test-intent-123", now, now + 10000);
    const acceptEnvelope = await signEnvelope(acceptMsg, buyerKeyPair);
    const acceptResult = await session.accept(acceptEnvelope);

    expect(acceptResult.ok).toBe(false);
    expect(acceptResult.code).toBe("BOND_INSUFFICIENT");

    const result = session.getResult();
    expect(result?.ok).toBe(false);
    if (!result?.ok) {
      expect(result.outcome).toBe("FAILED_ESCROW");
      expect(result.code).toBe("BOND_INSUFFICIENT");
    }
  });
});

