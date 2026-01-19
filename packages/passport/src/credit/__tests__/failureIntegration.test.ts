/**
 * Credit Failure Integration Tests
 * 
 * Tests for credit denial to failure event mapping.
 */

import { describe, it, expect } from "vitest";
import {
  mapCreditDenialToFailureEvent,
  shouldTriggerCreditKillSwitch,
} from "../failureIntegration";
import type { CreditDecision } from "../types";

describe("Credit Failure Integration", () => {
  describe("mapCreditDenialToFailureEvent", () => {
    it("should return null if credit is allowed", () => {
      const decision: CreditDecision = {
        allowed: true,
        required_collateral_usd: 20,
        reason_codes: [],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).toBeNull();
    });

    it("should map PACT-1xx violation to PACT-101 failure", () => {
      const decision: CreditDecision = {
        allowed: false,
        required_collateral_usd: 100,
        reason_codes: ["PACT-1xx_VIOLATION"],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.code).toBe("PACT-101");
      expect(failureEvent?.fault_domain).toBe("policy");
      expect(failureEvent?.stage).toBe("admission");
      expect(failureEvent?.terminality).toBe("terminal");
      expect(failureEvent?.evidence_refs).toContain("credit_decision:agent-1:transcript-hash-1");
    });

    it("should map identity failure to PACT-201 failure", () => {
      const decision: CreditDecision = {
        allowed: false,
        required_collateral_usd: 100,
        reason_codes: ["IDENTITY_FAILURE"],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.code).toBe("PACT-201");
      expect(failureEvent?.fault_domain).toBe("identity");
      expect(failureEvent?.stage).toBe("admission");
    });

    it("should map tier too low to PACT-101 failure", () => {
      const decision: CreditDecision = {
        allowed: false,
        required_collateral_usd: 100,
        reason_codes: ["TIER_TOO_LOW"],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.code).toBe("PACT-101");
      expect(failureEvent?.fault_domain).toBe("policy");
      expect(failureEvent?.stage).toBe("commitment");
    });

    it("should map exposure exceeded to PACT-101 failure", () => {
      const decision: CreditDecision = {
        allowed: false,
        required_collateral_usd: 100,
        reason_codes: ["OUTSTANDING_EXPOSURE_EXCEEDED"],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.code).toBe("PACT-101");
      expect(failureEvent?.fault_domain).toBe("policy");
      expect(failureEvent?.stage).toBe("commitment");
    });

    it("should include all reason codes in evidence_refs", () => {
      const decision: CreditDecision = {
        allowed: false,
        required_collateral_usd: 100,
        reason_codes: ["OUTSTANDING_EXPOSURE_EXCEEDED", "PER_INTENT_EXPOSURE_EXCEEDED"],
      };

      const failureEvent = mapCreditDenialToFailureEvent(
        decision,
        "agent-1",
        "transcript-hash-1",
        Date.now()
      );

      expect(failureEvent).not.toBeNull();
      expect(failureEvent?.evidence_refs).toContain("credit_denial:OUTSTANDING_EXPOSURE_EXCEEDED");
      expect(failureEvent?.evidence_refs).toContain("credit_denial:PER_INTENT_EXPOSURE_EXCEEDED");
    });
  });

  describe("shouldTriggerCreditKillSwitch", () => {
    it("should return true for PACT-1xx codes", () => {
      expect(shouldTriggerCreditKillSwitch("PACT-101")).toBe(true);
      expect(shouldTriggerCreditKillSwitch("PACT-102")).toBe(true);
      expect(shouldTriggerCreditKillSwitch("PACT-110")).toBe(true);
    });

    it("should return true for PACT-2xx codes", () => {
      expect(shouldTriggerCreditKillSwitch("PACT-201")).toBe(true);
      expect(shouldTriggerCreditKillSwitch("PACT-202")).toBe(true);
      expect(shouldTriggerCreditKillSwitch("PACT-205")).toBe(true);
    });

    it("should return false for PACT-3xx codes", () => {
      expect(shouldTriggerCreditKillSwitch("PACT-301")).toBe(false);
      expect(shouldTriggerCreditKillSwitch("PACT-303")).toBe(false);
    });

    it("should return false for PACT-4xx codes", () => {
      expect(shouldTriggerCreditKillSwitch("PACT-401")).toBe(false);
      expect(shouldTriggerCreditKillSwitch("PACT-404")).toBe(false);
    });

    it("should return false for PACT-5xx codes", () => {
      expect(shouldTriggerCreditKillSwitch("PACT-501")).toBe(false);
      expect(shouldTriggerCreditKillSwitch("PACT-505")).toBe(false);
    });
  });
});
