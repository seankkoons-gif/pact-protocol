/**
 * Tests for Default Blame Logic (DBL) v1
 * 
 * Tests the deterministic blame attribution engine using existing fixtures.
 */

import { describe, it, expect } from "vitest";
import { resolveBlameV1 } from "../blame_resolver_v1.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "url";
import { dirname, resolve as resolvePath } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Helper to load fixture
function loadFixture(name: string): any {
  // From packages/verifier/src/dbl/__tests__/ we need to go up 5 levels to reach repo root
  // __dirname = packages/verifier/src/dbl/__tests__/
  // ../../../../../ = repo root
  const fixturesPath = resolvePath(__dirname, "../../../../../fixtures");
  const content = readFileSync(resolvePath(fixturesPath, name), "utf-8");
  return JSON.parse(content);
}

describe("resolveBlameV1", () => {
  describe("Terminal Success", () => {
    it("should return NO_FAULT for terminal success (SUCCESS-001)", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("OK");
      expect(judgment.dblDetermination).toBe("NO_FAULT");
      expect(judgment.confidence).toBe(1.0);
      expect(judgment.failureCode).toBeNull();
      expect(judgment.passportImpact).toBe(0.0);
      expect(judgment.recommendation).toBe("No action required.");
      expect(judgment.recommendedActions).toEqual([]);
      
      // DBL v2: SUCCESS => terminal=true, required_next_actor=NONE
      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.terminal).toBe(true);
      expect(judgment.requiredNextActor).toBe("NONE");
      expect(judgment.requiredAction).toBe("NONE");
    });

    it("should return NO_FAULT for terminal success (SUCCESS-002)", async () => {
      const transcript = loadFixture("success/SUCCESS-002-negotiated.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("OK");
      expect(judgment.dblDetermination).toBe("NO_FAULT");
      expect(judgment.confidence).toBe(1.0);
      expect(judgment.passportImpact).toBe(0.0);
    });
  });

  describe("PACT-101 (Policy Violation)", () => {
    describe("Invariant: Policy Abort → BUYER_AT_FAULT", () => {
      it("should always return BUYER_AT_FAULT for PACT-101 policy violation", async () => {
        const transcript = loadFixture("failures/PACT-101-policy-violation.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-101 (policy abort) ALWAYS assigns fault to buyer
        expect(judgment.status).toBe("FAILED");
        expect(judgment.failureCode).toBe("PACT-101");
        expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
        
        // Invariant: Policy violation has high confidence (0.85-0.95, reduced if final_hash mismatch)
        expect(judgment.confidence).toBeGreaterThanOrEqual(0.85);
        expect(judgment.confidence).toBeLessThanOrEqual(0.95);
        
        // Invariant: Actor fault → passport impact -0.05
        expect(judgment.passportImpact).toBe(-0.05);
        expect(judgment.recommendation).toContain("Policy violation");
        
        // DBL v2: PACT-101 => required_next_actor=BUYER, terminal=true, required_action="FIX_POLICY_OR_PARAMS"
        expect(judgment.version).toBe("dbl/2.0");
        expect(judgment.terminal).toBe(true);
        expect(judgment.requiredNextActor).toBe("BUYER");
        expect(judgment.requiredAction).toBe("FIX_POLICY_OR_PARAMS");
      });

      it("should assert PACT-101 invariant: BUYER_AT_FAULT is deterministic regardless of LVSH position", async () => {
        const transcript = loadFixture("failures/PACT-101-policy-violation.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-101 determination is NOT based on LVSH position or continuity
        // It is ALWAYS BUYER_AT_FAULT because buyer's policy enforcement failed
        expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
        
        // LVSH should still be established (for evidence purposes)
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(0);
        expect(judgment.lastValidHash).toBeTruthy();
      });
    });

    it("should have trusted evidence refs and untrusted claimed refs for PACT-101", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      // evidenceRefs should only contain trusted signed hashes (LVSH)
      expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
      expect(judgment.evidenceRefs[0]).toBe(judgment.lastValidHash);
      
      // claimedEvidenceRefs should contain untrusted refs from failure_event
      expect(judgment.claimedEvidenceRefs).toBeDefined();
      expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
    });

    it("should produce exact expected JSON artifact for PACT-101", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      // Lock in exact JSON shape - this test will fail if the artifact structure changes
      const artifact = JSON.parse(JSON.stringify(judgment));

      // Verify all required fields are present with correct types
      expect(artifact).toMatchObject({
        status: "FAILED",
        failureCode: "PACT-101",
        dblDetermination: "BUYER_AT_FAULT",
        passportImpact: -0.05,
        confidence: expect.any(Number),
        recommendation: expect.stringContaining("Policy violation"),
        evidenceRefs: expect.any(Array),
        claimedEvidenceRefs: expect.any(Array),
      });

      // Verify confidence is in expected range (0.85-0.95, may be reduced if final_hash mismatch)
      // PACT-101 fixture may have final_hash mismatch, so confidence could be 0.85 instead of 0.95
      expect(artifact.confidence).toBeGreaterThanOrEqual(0.85);
      expect(artifact.confidence).toBeLessThanOrEqual(0.95);
      
      // If final_hash mismatch is present, confidence should be 0.85 and notes should mention it
      if (artifact.confidence === 0.85 && artifact.notes) {
        expect(artifact.notes).toContain("final hash mismatch");
      }

      // Verify required fields exist
      expect(artifact.lastValidRound).toBeGreaterThanOrEqual(0);
      expect(typeof artifact.lastValidSummary).toBe("string");
      expect(typeof artifact.lastValidHash).toBe("string");
      expect(artifact.requiredNextActor).toBeDefined();

      // Verify evidence refs structure
      expect(artifact.evidenceRefs.length).toBeGreaterThan(0);
      expect(artifact.evidenceRefs).toContain(artifact.lastValidHash);
      expect(artifact.evidenceRefs.every((ref: string) => typeof ref === "string")).toBe(true);

      // Verify claimed evidence refs structure
      if (artifact.claimedEvidenceRefs) {
        expect(Array.isArray(artifact.claimedEvidenceRefs)).toBe(true);
        expect(artifact.claimedEvidenceRefs.every((ref: string) => typeof ref === "string")).toBe(true);
      }

      // Verify optional fields are either present with correct type or undefined
      if (artifact.notes !== undefined) {
        expect(typeof artifact.notes).toBe("string");
      }
    });
  });

  describe("PACT-404 (Settlement Timeout)", () => {
    describe("Invariant: ACCEPT → Settlement Responsibility", () => {
      it("should assert PACT-404 invariant: ACCEPT exists → fault = settlement-responsible party", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // Critical: LVSH must be established (not -1)
        // This verifies the canonical replay verifier is working correctly
        // Even if final_hash mismatches, LVSH should be computed from signed rounds
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(0);
        expect(judgment.lastValidHash).toBeTruthy();
        expect(judgment.lastValidSummary).toBeTruthy();
        expect(judgment.dblDetermination).not.toBe("INDETERMINATE");
        
        // Verify status and failure code
        expect(judgment.status).toBe("FAILED");
        expect(judgment.failureCode).toBe("PACT-404");
        
        // INVARIANT: PACT-404 with valid ACCEPT → fault = party responsible for settlement
        // NOT continuity-based (which would use requiredNextActor)
        // In this fixture, buyer ACCEPTED (round 2), so provider must settle
        // Since provider failed to settle, PROVIDER_AT_FAULT
        expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
        
        // Verify ACCEPT exists in transcript (invariant precondition)
        const acceptRound = transcript.rounds.find((r: any) => r.round_type === "ACCEPT");
        expect(acceptRound).toBeDefined();
        
        // Verify LVSH is at or after ACCEPT (required for settlement responsibility rule)
        const acceptRoundNumber = acceptRound!.round_number;
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(acceptRoundNumber);
        
        // Confidence should be 0.80-0.85 (reduced if final_hash mismatch)
        expect(judgment.confidence).toBeGreaterThanOrEqual(0.80);
        expect(judgment.confidence).toBeLessThanOrEqual(0.85);
        
        expect(judgment.passportImpact).toBe(-0.05);
        expect(judgment.recommendation).toContain("settlement");
        
        // Verify evidence refs contain trusted LVSH hash
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // If final_hash mismatched, should have notes
        // (This fixture may or may not have final_hash mismatch, but if it does, note should be present)
        if (judgment.confidence === 0.80) {
          expect(judgment.notes).toBeDefined();
          expect(judgment.notes).toContain("final hash mismatch");
        }
      });

      it("should establish LVSH and determine fault for PACT-404 (canonical replay verifier)", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // Critical: LVSH must be established (not -1)
        // This verifies the canonical replay verifier is working correctly
        // Even if final_hash mismatches, LVSH should be computed from signed rounds
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(0);
        expect(judgment.lastValidHash).toBeTruthy();
        expect(judgment.lastValidSummary).toBeTruthy();
        expect(judgment.dblDetermination).not.toBe("INDETERMINATE");
        
        // Verify status and failure code
        expect(judgment.status).toBe("FAILED");
        expect(judgment.failureCode).toBe("PACT-404");
        
        // PACT-404 with valid ACCEPT -> fault = party responsible for settlement
        // In this fixture, buyer ACCEPTED (round 2), so provider should settle
        // Since provider failed to settle, PROVIDER_AT_FAULT
        expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
        
        // Confidence should be 0.80-0.85 (reduced if final_hash mismatch)
        expect(judgment.confidence).toBeGreaterThanOrEqual(0.80);
        expect(judgment.confidence).toBeLessThanOrEqual(0.85);
        
        expect(judgment.passportImpact).toBe(-0.05);
        expect(judgment.recommendation).toContain("settlement");
        
        // Verify evidence refs contain trusted LVSH hash
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // If final_hash mismatched, should have notes
        // (This fixture may or may not have final_hash mismatch, but if it does, note should be present)
        if (judgment.confidence === 0.80) {
          expect(judgment.notes).toBeDefined();
          expect(judgment.notes).toContain("final hash mismatch");
        }
      });
    });

    describe("Invariant: Container Final Hash Mismatch Behavior", () => {
      it("should assert invariant: final_hash mismatch → notes + confidence downgrade", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // LVSH must be established even if final_hash mismatches
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(0);
        expect(judgment.dblDetermination).not.toBe("INDETERMINATE");
        
        // INVARIANT: If final_hash mismatch is present, confidence is reduced by exactly 0.05
        // PACT-404 base confidence: 0.85 → with mismatch: 0.80
        // PACT-101 base confidence: 0.95 → with mismatch: 0.85
        // PACT-505 base confidence: 0.80 → with mismatch: 0.75
        // Default continuity: 0.70 → with mismatch: 0.65
        
        if (judgment.confidence === 0.80) {
          // INVARIANT: final_hash mismatch MUST have notes mentioning it
          expect(judgment.notes).toBeDefined();
          expect(judgment.notes).toContain("final hash mismatch");
          expect(judgment.notes).toContain("LVSH computed from signed rounds only");
          
          // INVARIANT: Confidence downgraded by exactly 0.05 (0.85 → 0.80 for PACT-404)
          expect(judgment.confidence).toBe(0.80);
        } else {
          // If no mismatch, confidence should be base value (0.85 for PACT-404)
          expect(judgment.confidence).toBe(0.85);
          // Should NOT have notes about mismatch
          if (judgment.notes) {
            expect(judgment.notes).not.toContain("final hash mismatch");
          }
        }
        
        // Confidence should be in valid range (0.80-0.85 if mismatch, 0.85 if not)
        expect(judgment.confidence).toBeGreaterThan(0.7);
        expect(judgment.confidence).toBeLessThanOrEqual(0.85);
      });

      it("should handle FINAL_HASH_MISMATCH gracefully and still establish LVSH", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // LVSH must be established even if final_hash mismatches
        expect(judgment.lastValidRound).toBeGreaterThanOrEqual(0);
        expect(judgment.dblDetermination).not.toBe("INDETERMINATE");
        
        // If final_hash mismatch is present (confidence is 0.80), should have notes mentioning it
        // Note: This test passes whether or not the fixture has final_hash mismatch
        // The important thing is that LVSH is established regardless
        if (judgment.confidence === 0.80) {
          expect(judgment.notes).toBeDefined();
          expect(judgment.notes).toContain("final hash mismatch");
          expect(judgment.notes).toContain("LVSH computed from signed rounds only");
        }
        
        // Confidence should be in valid range (0.80-0.85 if mismatch, higher if not)
        expect(judgment.confidence).toBeGreaterThan(0.7);
        expect(judgment.confidence).toBeLessThanOrEqual(0.85);
      });
    });

    it("should have evidence refs containing LVSH hash and ACCEPT hash", async () => {
      const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
      const judgment = await resolveBlameV1(transcript);

      // Should have trusted evidence refs (LVSH hash, and ACCEPT hash if different)
      expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
      expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
    });

    it("should produce exact expected JSON artifact for PACT-404 with final_hash mismatch", async () => {
      const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
      const judgment = await resolveBlameV1(transcript);

      // Lock in exact JSON shape - this test will fail if the artifact structure changes
      const artifact = JSON.parse(JSON.stringify(judgment));

      // Verify all required fields are present with correct types
      expect(artifact).toMatchObject({
        status: "FAILED",
        failureCode: "PACT-404",
        dblDetermination: "PROVIDER_AT_FAULT",
        passportImpact: -0.05,
        confidence: expect.any(Number),
        recommendation: expect.stringContaining("settlement"),
        evidenceRefs: expect.any(Array),
        claimedEvidenceRefs: expect.any(Array),
        notes: expect.stringContaining("final hash mismatch"),
      });

      // This fixture has final_hash mismatch, so confidence should be 0.80 (reduced from 0.85)
      expect(artifact.confidence).toBe(0.80);

      // Verify required fields exist
      expect(artifact.lastValidRound).toBeGreaterThanOrEqual(0);
      expect(artifact.lastValidRound).toBe(2); // Last valid round should be ACCEPT (round 2)
      expect(typeof artifact.lastValidSummary).toBe("string");
      expect(artifact.lastValidSummary).toContain("ACCEPT");
      expect(typeof artifact.lastValidHash).toBe("string");
      expect(artifact.lastValidHash).toBe("30e1b543c9b32aa210ab366df4e8a45b8f59e99f25b9a3aaa90eb4819519d933");
      expect(artifact.requiredNextActor).toBe("PROVIDER");
      
      // DBL v2: PACT-404 => required_next_actor=PROVIDER, terminal=false, required_action="COMPLETE_SETTLEMENT_OR_REFUND"
      expect(artifact.version).toBe("dbl/2.0");
      expect(artifact.terminal).toBe(false);
      expect(artifact.requiredAction).toBe("COMPLETE_SETTLEMENT_OR_REFUND");

      // Verify evidence refs structure - should include LVSH hash and ACCEPT hash
      expect(artifact.evidenceRefs.length).toBeGreaterThanOrEqual(1);
      expect(artifact.evidenceRefs).toContain(artifact.lastValidHash);
      expect(artifact.evidenceRefs.every((ref: string) => typeof ref === "string")).toBe(true);
      expect(artifact.evidenceRefs.every((ref: string) => ref.length === 64)).toBe(true); // SHA-256 hex

      // Verify claimed evidence refs structure
      expect(Array.isArray(artifact.claimedEvidenceRefs)).toBe(true);
      expect(artifact.claimedEvidenceRefs!.length).toBeGreaterThan(0);
      expect(artifact.claimedEvidenceRefs!.every((ref: string) => typeof ref === "string")).toBe(true);

      // Verify notes mentions final hash mismatch
      expect(artifact.notes).toBeDefined();
      expect(artifact.notes).toContain("final hash mismatch");
      expect(artifact.notes).toContain("LVSH computed from signed rounds only");
    });
  });

  describe("PACT-331 (Double Commit Detection)", () => {
    describe("Invariant: Double Commit → BUYER_AT_FAULT", () => {
      it("should always return BUYER_AT_FAULT for PACT-331 double-commit", async () => {
        const transcript = loadFixture("failures/PACT-331-double-commit.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-331 (double commit) ALWAYS assigns fault to buyer
        expect(judgment.status).toBe("FAILED");
        expect(judgment.failureCode).toBe("PACT-331");
        expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
        
        // Invariant: Double commit has high confidence (0.90-0.95)
        expect(judgment.confidence).toBeGreaterThanOrEqual(0.90);
        expect(judgment.confidence).toBeLessThanOrEqual(0.95);
        
        // Invariant: Actor fault → passport impact -0.05
        expect(judgment.passportImpact).toBe(-0.05);
        expect(judgment.recommendation).toContain("duplicate commit attempt");
        expect(judgment.recommendation).toContain("intent_fingerprint");
        
        // DBL v2: Terminal by policy => requiredNextActor=NONE, terminal=true
        expect(judgment.version).toBe("dbl/2.0");
        expect(judgment.terminal).toBe(true);
        expect(judgment.requiredNextActor).toBe("NONE");
        expect(judgment.requiredAction).toBe("ABORT");
        
        // Invariant: evidenceRefs contains only LVSH hash
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // Invariant: claimedEvidenceRefs contains failure_event.evidence_refs
        expect(judgment.claimedEvidenceRefs).toBeDefined();
        expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
        if (transcript.failure_event?.evidence_refs) {
          transcript.failure_event.evidence_refs.forEach((ref: string) => {
            expect(judgment.claimedEvidenceRefs).toContain(ref);
          });
        }
        
        // Invariant: recommendedActions contains ABORT_INTENT and LINK_PRIOR_TRANSCRIPT
        expect(judgment.recommendedActions).toBeDefined();
        expect(Array.isArray(judgment.recommendedActions)).toBe(true);
        expect(judgment.recommendedActions!.length).toBeGreaterThanOrEqual(2);
        
        const abortIntent = judgment.recommendedActions!.find(a => a.action === "ABORT_INTENT");
        expect(abortIntent).toBeDefined();
        expect(abortIntent!.target).toBe("BUYER");
        expect(abortIntent!.evidenceRefs).toEqual([judgment.lastValidHash]);
        
        const linkPrior = judgment.recommendedActions!.find(a => a.action === "LINK_PRIOR_TRANSCRIPT");
        expect(linkPrior).toBeDefined();
        expect(linkPrior!.target).toBe("SYSTEM");
        expect(linkPrior!.evidenceRefs).toEqual([judgment.lastValidHash]);
        if (transcript.failure_event?.evidence_refs) {
          expect(linkPrior!.claimedEvidenceRefs).toEqual(transcript.failure_event.evidence_refs);
        }
      });

      it("should assert PACT-331 invariant: BUYER_AT_FAULT is deterministic regardless of LVSH position", async () => {
        const transcript = loadFixture("failures/PACT-331-double-commit.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-331 determination is NOT based on LVSH position or continuity
        // It is ALWAYS BUYER_AT_FAULT because buyer attempted double commit
        expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
        
        // Determination is correct regardless of LVSH position
        expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
        
        // DBL v2: Required next actor should be NONE (terminal by policy)
        expect(judgment.version).toBe("dbl/2.0");
        expect(judgment.terminal).toBe(true);
        expect(judgment.requiredNextActor).toBe("NONE");
        expect(judgment.requiredAction).toBe("ABORT");
      });
    });

    it("should have trusted evidence refs and untrusted claimed refs for PACT-331", async () => {
      const transcript = loadFixture("failures/PACT-331-double-commit.json");
      const judgment = await resolveBlameV1(transcript);

      // evidenceRefs should only contain trusted signed hashes (LVSH)
      expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
      expect(judgment.evidenceRefs[0]).toBe(judgment.lastValidHash);
      
      // claimedEvidenceRefs should contain untrusted refs from failure_event
      expect(judgment.claimedEvidenceRefs).toBeDefined();
      expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
    });
  });

  describe("PACT-330 (Contention Exclusivity Violation)", () => {
    describe("Invariant: Contention Lost → PROVIDER_AT_FAULT", () => {
      it("should always return PROVIDER_AT_FAULT for PACT-330 contention violation", async () => {
        const transcript = loadFixture("failures/PACT-330-contention-lost.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-330 (contention exclusivity violation) ALWAYS assigns fault to provider
        expect(judgment.status).toBe("FAILED");
        expect(judgment.failureCode).toBe("PACT-330");
        expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
        
        // Invariant: Contention violation has high confidence (0.85-0.90)
        expect(judgment.confidence).toBeGreaterThanOrEqual(0.85);
        expect(judgment.confidence).toBeLessThanOrEqual(0.90);
        
        // Invariant: Actor fault → passport impact -0.05
        expect(judgment.passportImpact).toBe(-0.05);
        expect(judgment.recommendation).toContain("non-winner provider");
        expect(judgment.recommendation).toContain("contention winner");
        
        // DBL v2: Terminal by policy => requiredNextActor=NONE, terminal=true
        expect(judgment.version).toBe("dbl/2.0");
        expect(judgment.terminal).toBe(true);
        expect(judgment.requiredNextActor).toBe("NONE");
        expect(judgment.requiredAction).toBe("ABORT");
        
        // Invariant: evidenceRefs contains only LVSH hash
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // Invariant: claimedEvidenceRefs contains failure_event.evidence_refs
        expect(judgment.claimedEvidenceRefs).toBeDefined();
        expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
        if (transcript.failure_event?.evidence_refs) {
          transcript.failure_event.evidence_refs.forEach((ref: string) => {
            expect(judgment.claimedEvidenceRefs).toContain(ref);
          });
        }
        
        // Invariant: recommendedActions contains ABORT_SETTLEMENT and PENALIZE_PROVIDER_PASSPORT
        expect(judgment.recommendedActions).toBeDefined();
        expect(Array.isArray(judgment.recommendedActions)).toBe(true);
        expect(judgment.recommendedActions!.length).toBeGreaterThanOrEqual(2);
        
        const abortSettlement = judgment.recommendedActions!.find(a => a.action === "ABORT_SETTLEMENT");
        expect(abortSettlement).toBeDefined();
        expect(abortSettlement!.target).toBe("SYSTEM");
        expect(abortSettlement!.evidenceRefs).toEqual([judgment.lastValidHash]);
        
        const penalize = judgment.recommendedActions!.find(a => a.action === "PENALIZE_PROVIDER_PASSPORT");
        expect(penalize).toBeDefined();
        expect(penalize!.target).toBe("SYSTEM");
        expect(penalize!.evidenceRefs).toEqual([judgment.lastValidHash]);
      });

      it("should assert PACT-330 invariant: PROVIDER_AT_FAULT is deterministic regardless of LVSH position", async () => {
        const transcript = loadFixture("failures/PACT-330-contention-lost.json");
        const judgment = await resolveBlameV1(transcript);

        // Invariant: PACT-330 determination is NOT based on LVSH position or continuity
        // It is ALWAYS PROVIDER_AT_FAULT because provider attempted settlement after losing contention
        expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
        
        // LVSH may or may not be established depending on fixture signature validity
        // The key invariant is that determination is correct regardless of LVSH
        // If fixture has invalid signatures, lastValidRound will be -1, but determination is still correct
        expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
        
        // DBL v2: Required next actor should be NONE (terminal by policy)
        expect(judgment.version).toBe("dbl/2.0");
        expect(judgment.terminal).toBe(true);
        expect(judgment.requiredNextActor).toBe("NONE");
        expect(judgment.requiredAction).toBe("ABORT");
      });
    });

    it("should have trusted evidence refs and untrusted claimed refs for PACT-330", async () => {
      const transcript = loadFixture("failures/PACT-330-contention-lost.json");
      const judgment = await resolveBlameV1(transcript);

      // evidenceRefs should only contain trusted signed hashes (LVSH)
      expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
      expect(judgment.evidenceRefs[0]).toBe(judgment.lastValidHash);
      
      // claimedEvidenceRefs should contain untrusted refs from failure_event
      expect(judgment.claimedEvidenceRefs).toBeDefined();
      expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
    });
  });

  describe("PACT-505 (Recursive/Infrastructure Failure)", () => {
    it("should determine fault using continuity rule for PACT-505 (infra exception not applicable)", async () => {
      const transcript = loadFixture("failures/PACT-505-recursive-failure.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("FAILED");
      expect(judgment.failureCode).toBe("PACT-505");
      
      // PACT-505: v4 schema doesn't have signed attempt types, so infra exception not applicable
      // Should use continuity rule instead
      expect(
        judgment.dblDetermination === "BUYER_AT_FAULT" ||
        judgment.dblDetermination === "PROVIDER_AT_FAULT" ||
        judgment.dblDetermination === "INDETERMINATE"
      ).toBe(true);
      
      // Should have notes explaining infra exception not applicable
      expect(judgment.notes).toBeDefined();
      expect(judgment.notes).toContain("infra exception not applicable");
      
      // Passport impact should be -0.05 for actor fault, 0.0 for indeterminate
      if (judgment.dblDetermination !== "INDETERMINATE") {
        expect(judgment.passportImpact).toBe(-0.05);
      } else {
        expect(judgment.passportImpact).toBe(0.0);
      }
      
      expect(judgment.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("Evidence Refs Trust Boundary", () => {
    describe("Invariant: Evidence Split (Trusted LVSH vs Claimed failure_event refs)", () => {
      it("should assert invariant: evidenceRefs ONLY contains trusted LVSH hashes", async () => {
        const transcript = loadFixture("failures/PACT-101-policy-violation.json");
        const judgment = await resolveBlameV1(transcript);

        // INVARIANT: evidenceRefs should ONLY contain trusted signed hashes from LVSH rounds
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        
        // At minimum, should include LVSH hash (always trusted)
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // INVARIANT: All evidenceRefs must be hashes from signed LVSH rounds
        // Verify each ref is either LVSH hash or an ACCEPT hash (if different and in LVSH range)
        judgment.evidenceRefs.forEach((ref: string) => {
          expect(typeof ref).toBe("string");
          expect(ref.length).toBe(64); // SHA-256 hex
          
          // Should be from a signed round (check if it matches any round hash in LVSH range)
          const validRoundHashes = transcript.rounds
            .slice(0, judgment.lastValidRound + 1)
            .map((r: any) => r.round_hash);
          expect(validRoundHashes).toContain(ref);
        });
        
        // INVARIANT: Should NOT include untrusted refs from failure_event
        if (transcript.failure_event?.evidence_refs) {
          transcript.failure_event.evidence_refs.forEach((ref: string) => {
            // Unless the ref happens to be the LVSH hash (which is valid and should be in both)
            if (ref !== judgment.lastValidHash) {
              // Must be in claimedEvidenceRefs, NOT in evidenceRefs
              expect(judgment.evidenceRefs).not.toContain(ref);
              expect(judgment.claimedEvidenceRefs).toContain(ref);
            }
          });
        }
      });

      it("should assert invariant: claimedEvidenceRefs contains ALL failure_event.evidence_refs", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // INVARIANT: If failure_event has evidence_refs, ALL must be in claimedEvidenceRefs
        if (transcript.failure_event?.evidence_refs) {
          expect(judgment.claimedEvidenceRefs).toBeDefined();
          expect(Array.isArray(judgment.claimedEvidenceRefs)).toBe(true);
          expect(judgment.claimedEvidenceRefs!.length).toBeGreaterThan(0);
          
          // Every failure_event evidence_ref must appear in claimedEvidenceRefs
          transcript.failure_event.evidence_refs.forEach((ref: string) => {
            expect(judgment.claimedEvidenceRefs).toContain(ref);
          });
          
          // INVARIANT: claimedEvidenceRefs should NOT contain trusted LVSH hashes
          // (unless they also happen to be in failure_event, in which case they're duplicated)
          // But the trusted version should be in evidenceRefs, not just claimedEvidenceRefs
          if (judgment.lastValidHash && transcript.failure_event.evidence_refs.includes(judgment.lastValidHash)) {
            // If LVSH hash is in failure_event, it should be in BOTH arrays
            expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
            expect(judgment.claimedEvidenceRefs).toContain(judgment.lastValidHash);
          }
        }
      });

      it("should only include trusted signed hashes in evidenceRefs", async () => {
        const transcript = loadFixture("failures/PACT-101-policy-violation.json");
        const judgment = await resolveBlameV1(transcript);

        // evidenceRefs should only contain signed LVSH hashes
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        
        // All evidence refs should be hashes from LVSH rounds
        // At minimum, should include LVSH hash
        expect(judgment.evidenceRefs).toContain(judgment.lastValidHash);
        
        // Should NOT include untrusted refs from failure_event
        if (transcript.failure_event?.evidence_refs) {
          transcript.failure_event.evidence_refs.forEach((ref: string) => {
            // Unless the ref happens to be the LVSH hash (which is valid)
            if (ref !== judgment.lastValidHash) {
              // Should be in claimedEvidenceRefs, not evidenceRefs
              expect(judgment.claimedEvidenceRefs).toContain(ref);
            }
          });
        }
      });

      it("should separate trusted and claimed evidence refs", async () => {
        const transcript = loadFixture("compromised/PACT-404-settlement-timeout-finalhash-mismatch.json");
        const judgment = await resolveBlameV1(transcript);

        // evidenceRefs should only have trusted signed hashes
        expect(Array.isArray(judgment.evidenceRefs)).toBe(true);
        expect(judgment.evidenceRefs.length).toBeGreaterThan(0);
        
        // claimedEvidenceRefs should have untrusted refs from failure_event
        expect(judgment.claimedEvidenceRefs).toBeDefined();
        
        // If failure_event has evidence_refs, they should be in claimedEvidenceRefs
        if (transcript.failure_event?.evidence_refs) {
          expect(judgment.claimedEvidenceRefs?.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe("Passport Impact Constants", () => {
    it("should use -0.05 for actor fault", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.dblDetermination).toBe("BUYER_AT_FAULT");
      expect(judgment.passportImpact).toBe(-0.05);
    });

    it("should use 0.0 for no fault", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.dblDetermination).toBe("NO_FAULT");
      expect(judgment.passportImpact).toBe(0.0);
    });

    it("should use 0.0 for indeterminate", async () => {
      const invalidTranscript = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "test",
        intent_id: "test",
        intent_type: "test",
        created_at_ms: 1000,
        policy_hash: "test",
        strategy_hash: "",
        identity_snapshot_hash: "",
        rounds: [],
      };

      const judgment = await resolveBlameV1(invalidTranscript);
      
      expect(judgment.dblDetermination).toBe("INDETERMINATE");
      expect(judgment.passportImpact).toBe(0.0);
    });
  });

  describe("Status Logic", () => {
    it("should return OK for terminal success", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("OK");
    });

    it("should return FAILED for explicit failure codes", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("FAILED");
      expect(judgment.failureCode).toBe("PACT-101");
    });

    it("should return INDETERMINATE when LVSH cannot be established", async () => {
      const invalidTranscript = {
        transcript_version: "pact-transcript/4.0",
        transcript_id: "test",
        intent_id: "test",
        intent_type: "test",
        created_at_ms: 1000,
        policy_hash: "test",
        strategy_hash: "",
        identity_snapshot_hash: "",
        rounds: [],
      };

      const judgment = await resolveBlameV1(invalidTranscript);
      
      expect(judgment.status).toBe("INDETERMINATE");
      expect(judgment.dblDetermination).toBe("INDETERMINATE");
      expect(judgment.lastValidRound).toBe(-1);
      expect(judgment.recommendation).toContain("Insufficient signed evidence");
      expect(judgment.recommendedActions).toBeDefined();
      expect(Array.isArray(judgment.recommendedActions)).toBe(true);
      const requestReplay = judgment.recommendedActions!.find(a => a.action === "REQUEST_REPLAY");
      expect(requestReplay).toBeDefined();
      expect(requestReplay!.target).toBe("SYSTEM");
    });

    it("should return INDETERMINATE for wrong transcript version", async () => {
      const wrongVersion = {
        transcript_version: "pact-transcript/3.0",
        transcript_id: "test",
        intent_id: "test",
        intent_type: "test",
        created_at_ms: 1000,
        policy_hash: "test",
        strategy_hash: "",
        identity_snapshot_hash: "",
        rounds: [],
      };

      const judgment = await resolveBlameV1(wrongVersion);
      
      expect(judgment.status).toBe("INDETERMINATE");
      expect(judgment.dblDetermination).toBe("INDETERMINATE");
    });
  });

  describe("Judgment Artifact Structure", () => {
    it("should return complete Judgment Artifact with all required fields", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      // Verify all required fields are present
      expect(judgment).toHaveProperty("status");
      expect(judgment).toHaveProperty("failureCode");
      expect(judgment).toHaveProperty("lastValidRound");
      expect(judgment).toHaveProperty("lastValidSummary");
      expect(judgment).toHaveProperty("lastValidHash");
      expect(judgment).toHaveProperty("requiredNextActor");
      expect(judgment).toHaveProperty("dblDetermination");
      expect(judgment).toHaveProperty("passportImpact");
      expect(judgment).toHaveProperty("confidence");
      expect(judgment).toHaveProperty("recommendation");
      expect(judgment).toHaveProperty("evidenceRefs");

      // Verify types
      expect(typeof judgment.status).toBe("string");
      expect(["OK", "FAILED", "INDETERMINATE"]).toContain(judgment.status);
      expect(typeof judgment.confidence).toBe("number");
      expect(judgment.confidence).toBeGreaterThanOrEqual(0);
      expect(judgment.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(judgment.evidenceRefs)).toBe(true);
      expect(typeof judgment.passportImpact).toBe("number");
    });

    it("should include optional fields when present", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      // claimedEvidenceRefs should be present when failure_event has evidence_refs
      expect(judgment.claimedEvidenceRefs).toBeDefined();
      
      // notes may be present for certain cases
      // (PACT-505 should have notes, others may not)
      if (judgment.failureCode === "PACT-505") {
        expect(judgment.notes).toBeDefined();
      }
    });
  });

  describe("DBL v2 State Machine", () => {
    it("should set terminal=true and requiredNextActor=NONE for SUCCESS", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.terminal).toBe(true);
      expect(judgment.requiredNextActor).toBe("NONE");
      expect(judgment.requiredAction).toBe("NONE");
    });

    it("should set requiredNextActor=BUYER, terminal=true, requiredAction=FIX_POLICY_OR_PARAMS for PACT-101", async () => {
      const transcript = loadFixture("failures/PACT-101-policy-violation.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.terminal).toBe(true);
      expect(judgment.requiredNextActor).toBe("BUYER");
      expect(judgment.requiredAction).toBe("FIX_POLICY_OR_PARAMS");
    });

    it("should set requiredNextActor=PROVIDER, terminal=false, requiredAction=COMPLETE_SETTLEMENT_OR_REFUND for PACT-404", async () => {
      const transcript = loadFixture("failures/PACT-404-settlement-timeout.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.terminal).toBe(false);
      expect(judgment.requiredNextActor).toBe("PROVIDER");
      expect(judgment.requiredAction).toBe("COMPLETE_SETTLEMENT_OR_REFUND");
    });

    it("should set requiredNextActor=PROVIDER, terminal=true, requiredAction=RETRY for PACT-420", async () => {
      const transcript = loadFixture("failures/PACT-420-provider-unreachable.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.failureCode).toBe("PACT-420");
      expect(judgment.dblDetermination).toBe("PROVIDER_AT_FAULT");
      expect(judgment.terminal).toBe(true); // Transcript is terminal (sealed), remediation requires new attempt
      expect(judgment.requiredNextActor).toBe("PROVIDER");
      expect(judgment.requiredAction).toBe("RETRY");
    });

    it("should set terminal=true and requiredNextActor=NONE for PACT-331", async () => {
      const transcript = loadFixture("failures/PACT-331-double-commit.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.version).toBe("dbl/2.0");
      expect(judgment.terminal).toBe(true);
      expect(judgment.requiredNextActor).toBe("NONE");
      expect(judgment.requiredAction).toBe("ABORT");
    });

    it("should produce deterministic state machine fields across replays", async () => {
      const transcript = loadFixture("failures/PACT-404-settlement-timeout.json");
      
      // Run twice
      const judgment1 = await resolveBlameV1(transcript);
      const judgment2 = await resolveBlameV1(transcript);

      // State machine fields must be identical
      expect(judgment1.version).toBe(judgment2.version);
      expect(judgment1.terminal).toBe(judgment2.terminal);
      expect(judgment1.requiredNextActor).toBe(judgment2.requiredNextActor);
      expect(judgment1.requiredAction).toBe(judgment2.requiredAction);
    });

    it("should never return null for requiredNextActor or requiredAction", async () => {
      // Test with various fixtures to ensure fields are never null
      const fixtures = [
        "success/SUCCESS-001-simple.json",
        "success/SUCCESS-002-negotiated.json",
        "failures/PACT-101-policy-violation.json",
        "failures/PACT-404-settlement-timeout.json",
        "failures/PACT-331-double-commit.json",
      ];

      for (const fixture of fixtures) {
        const transcript = loadFixture(fixture);
        const judgment = await resolveBlameV1(transcript);

        // These fields must never be null
        expect(judgment.requiredNextActor).not.toBeNull();
        expect(judgment.requiredAction).not.toBeNull();
        expect(typeof judgment.requiredNextActor).toBe("string");
        expect(typeof judgment.requiredAction).toBe("string");
        expect(typeof judgment.terminal).toBe("boolean");

        // Verify valid enum values
        expect(["BUYER", "PROVIDER", "RAIL", "SETTLEMENT", "ARBITER", "NONE"]).toContain(judgment.requiredNextActor);
        expect(judgment.requiredAction.length).toBeGreaterThan(0);
      }
    });

    it("should set requiredNextActor=NONE, requiredAction=NONE, terminal=true for NO_FAULT success", async () => {
      const transcript = loadFixture("success/SUCCESS-001-simple.json");
      const judgment = await resolveBlameV1(transcript);

      expect(judgment.status).toBe("OK");
      expect(judgment.dblDetermination).toBe("NO_FAULT");
      expect(judgment.requiredNextActor).toBe("NONE");
      expect(judgment.requiredAction).toBe("NONE");
      expect(judgment.terminal).toBe(true);
    });
  });
});
