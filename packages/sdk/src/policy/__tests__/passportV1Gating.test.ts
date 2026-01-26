/**
 * Passport v1 Policy Gating Tests
 */

import { describe, it, expect } from "vitest";
import type { PassportState } from "@pact/passport/src/v1/types";
import type { CounterpartyConstraints } from "../types";
import { checkPassportV1Constraints } from "../passportV1Gating";

describe("Passport v1 Policy Gating", () => {
  const mockPassportState: PassportState = {
    version: "passport/1.0",
    agent_id: "test-signer-key",
    score: 0.5,
    counters: {
      total_settlements: 10,
      successful_settlements: 8,
      disputes_lost: 1,
      disputes_won: 0,
      sla_violations: 2,
      policy_aborts: 1,
    },
  };

  const signerKey = "21wxunPRWgrzXqK48yeE1aEZtfpFU2AwY8odDiGgBT4J";

  describe("missing passport_v1", () => {
    it("should fail deterministically with evidence when passport is missing and constraints are required", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.0,
      };

      const result = checkPassportV1Constraints(null, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_state_hash).toBe(""); // Empty hash indicates missing
      expect(result?.evidence.passport_v1_referenced_fields).toContain("score");
      expect(result?.evidence.passport_v1_signer_key).toBe(signerKey);
      expect(result?.reason).toContain("missing");
    });

    it("should pass when passport is missing but no constraints are defined", () => {
      const result = checkPassportV1Constraints(null, undefined, signerKey);
      expect(result).toBeNull();
    });
  });

  describe("score constraints", () => {
    it("should pass when score meets minimum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.3,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });

    it("should fail when score is below minimum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.6,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_state_hash).toBeTruthy();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("score");
      expect(result?.reason).toContain("score");
    });
  });

  describe("successful_settlements constraints", () => {
    it("should pass when successful_settlements meets minimum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_successful_settlements: 5,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });

    it("should fail when successful_settlements is below minimum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_successful_settlements: 10,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.successful_settlements");
      expect(result?.reason).toContain("successful_settlements");
    });
  });

  describe("disputes_lost constraints", () => {
    it("should pass when disputes_lost is within maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_disputes_lost: 2,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });

    it("should fail when disputes_lost exceeds maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_disputes_lost: 0,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.disputes_lost");
      expect(result?.reason).toContain("disputes_lost");
    });
  });

  describe("sla_violations constraints", () => {
    it("should pass when sla_violations is within maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_sla_violations: 3,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });

    it("should fail when sla_violations exceeds maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_sla_violations: 1,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.sla_violations");
      expect(result?.reason).toContain("sla_violations");
    });
  });

  describe("policy_aborts constraints", () => {
    it("should pass when policy_aborts is within maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_policy_aborts: 2,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });

    it("should fail when policy_aborts exceeds maximum", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        max_policy_aborts: 0,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.policy_aborts");
      expect(result?.reason).toContain("policy_aborts");
    });
  });

  describe("multiple constraints", () => {
    it("should fail if any constraint is violated", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.6, // Will fail
        min_successful_settlements: 5, // Will pass
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result).not.toBeNull();
      expect(result?.evidence.passport_v1_referenced_fields).toContain("score");
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.successful_settlements");
    });

    it("should pass if all constraints are met", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.3,
        min_successful_settlements: 5,
        max_disputes_lost: 2,
        max_sla_violations: 3,
        max_policy_aborts: 2,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      expect(result).toBeNull();
    });
  });

  describe("evidence generation", () => {
    it("should generate deterministic state hash", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.6,
      };

      const result1 = checkPassportV1Constraints(mockPassportState, constraints, signerKey);
      const result2 = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result1?.evidence.passport_v1_state_hash).toBe(result2?.evidence.passport_v1_state_hash);
      expect(result1?.evidence.passport_v1_state_hash.length).toBe(64); // SHA-256 hex
    });

    it("should include all referenced fields in evidence", () => {
      const constraints: CounterpartyConstraints["passport_v1"] = {
        min_score: 0.6,
        min_successful_settlements: 10,
        max_disputes_lost: 0,
      };

      const result = checkPassportV1Constraints(mockPassportState, constraints, signerKey);

      expect(result?.evidence.passport_v1_referenced_fields).toContain("score");
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.successful_settlements");
      expect(result?.evidence.passport_v1_referenced_fields).toContain("counters.disputes_lost");
    });
  });
});
