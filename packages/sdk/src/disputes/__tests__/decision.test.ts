/**
 * Dispute Decision Tests (C3)
 * 
 * Tests for signed dispute resolution artifacts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import nacl from "tweetnacl";
import {
  hashDecision,
  signDecision,
  verifyDecision,
  type DisputeDecision,
  type SignedDecision,
  type ArbiterKeyPair,
} from "../decision";
import { writeDecision, loadDecision, loadDecisionFromPath } from "../decisionStore";

describe("Dispute Decision (C3)", () => {
  let tempDir: string;
  let arbiterKeyPair: ArbiterKeyPair;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "decision-test-"));
    arbiterKeyPair = nacl.sign.keyPair();
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("signDecision then verifyDecision returns true", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-123",
      dispute_id: "dispute-123",
      receipt_id: "receipt-123",
      intent_id: "intent-123",
      buyer_agent_id: "buyer-1",
      seller_agent_id: "seller-1",
      outcome: "REFUND_FULL",
      refund_amount: 0.5,
      issued_at_ms: Date.now(),
      notes: "Test decision",
      policy_snapshot: {
        max_refund_pct: 1.0,
        allow_partial: true,
      },
    };

    const signedDecision = signDecision(decision, arbiterKeyPair);
    expect(signedDecision.decision).toEqual(decision);
    expect(signedDecision.arbiter_pubkey_b58).toBeDefined();
    expect(signedDecision.decision_hash_hex).toBeDefined();
    expect(signedDecision.signature_b58).toBeDefined();

    const isValid = verifyDecision(signedDecision);
    expect(isValid).toBe(true);
  });

  it("tampering decision fields causes verify false", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-123",
      dispute_id: "dispute-123",
      receipt_id: "receipt-123",
      intent_id: "intent-123",
      buyer_agent_id: "buyer-1",
      seller_agent_id: "seller-1",
      outcome: "REFUND_FULL",
      refund_amount: 0.5,
      issued_at_ms: Date.now(),
    };

    const signedDecision = signDecision(decision, arbiterKeyPair);
    expect(verifyDecision(signedDecision)).toBe(true);

    // Tamper with decision
    const tamperedDecision: SignedDecision = {
      ...signedDecision,
      decision: {
        ...signedDecision.decision,
        refund_amount: 1.0, // Changed from 0.5
      },
    };

    expect(verifyDecision(tamperedDecision)).toBe(false);
  });

  it("tampering signature causes verify false", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-123",
      dispute_id: "dispute-123",
      receipt_id: "receipt-123",
      intent_id: "intent-123",
      buyer_agent_id: "buyer-1",
      seller_agent_id: "seller-1",
      outcome: "NO_REFUND",
      refund_amount: 0,
      issued_at_ms: Date.now(),
    };

    const signedDecision = signDecision(decision, arbiterKeyPair);
    expect(verifyDecision(signedDecision)).toBe(true);

    // Tamper with signature
    const tamperedDecision: SignedDecision = {
      ...signedDecision,
      signature_b58: "invalid_signature_base58",
    };

    expect(verifyDecision(tamperedDecision)).toBe(false);
  });

  it("hashDecision produces deterministic hash", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-123",
      dispute_id: "dispute-123",
      receipt_id: "receipt-123",
      intent_id: "intent-123",
      buyer_agent_id: "buyer-1",
      seller_agent_id: "seller-1",
      outcome: "REFUND_PARTIAL",
      refund_amount: 0.25,
      issued_at_ms: 1000000,
    };

    const hash1 = hashDecision(decision);
    const hash2 = hashDecision(decision);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 hex string
  });

  it("writeDecision and loadDecision work correctly", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-456",
      dispute_id: "dispute-456",
      receipt_id: "receipt-456",
      intent_id: "intent-456",
      buyer_agent_id: "buyer-2",
      seller_agent_id: "seller-2",
      outcome: "REFUND_FULL",
      refund_amount: 1.0,
      issued_at_ms: Date.now(),
    };

    const signedDecision = signDecision(decision, arbiterKeyPair);
    const decisionPath = writeDecision(signedDecision, tempDir);

    expect(fs.existsSync(decisionPath)).toBe(true);
    expect(decisionPath).toContain("decision-456.json");

    const loadedDecision = loadDecision("decision-456", tempDir);
    expect(loadedDecision).not.toBeNull();
    expect(loadedDecision?.decision.decision_id).toBe("decision-456");
    expect(loadedDecision?.decision_hash_hex).toBe(signedDecision.decision_hash_hex);
    expect(loadedDecision?.signature_b58).toBe(signedDecision.signature_b58);

    // Verify loaded decision
    expect(verifyDecision(loadedDecision!)).toBe(true);
  });

  it("loadDecisionFromPath works correctly", () => {
    const decision: DisputeDecision = {
      decision_id: "decision-789",
      dispute_id: "dispute-789",
      receipt_id: "receipt-789",
      intent_id: "intent-789",
      buyer_agent_id: "buyer-3",
      seller_agent_id: "seller-3",
      outcome: "NO_REFUND",
      refund_amount: 0,
      issued_at_ms: Date.now(),
    };

    const signedDecision = signDecision(decision, arbiterKeyPair);
    const decisionPath = writeDecision(signedDecision, tempDir);

    const loadedDecision = loadDecisionFromPath(decisionPath);
    expect(loadedDecision).not.toBeNull();
    expect(loadedDecision?.decision.decision_id).toBe("decision-789");
    expect(verifyDecision(loadedDecision!)).toBe(true);
  });

  it("loadDecision returns null for non-existent decision", () => {
    const loadedDecision = loadDecision("nonexistent-decision", tempDir);
    expect(loadedDecision).toBeNull();
  });
});




