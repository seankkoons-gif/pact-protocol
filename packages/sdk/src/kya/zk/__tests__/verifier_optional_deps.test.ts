/**
 * ZK-KYA Verifier Optional Dependency Tests
 * 
 * Tests for DefaultZkKyaVerifier optional dependency behavior.
 * Verifies graceful fallback when 'snarkjs' package is not installed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DefaultZkKyaVerifier } from "../verifier";
import type { ZkKyaProof } from "../types";

describe("DefaultZkKyaVerifier - Optional Dependency Behavior", () => {
  const originalRequire = require;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createTestProof = (): ZkKyaProof => ({
    scheme: "groth16",
    circuit_id: "kyc_v1",
    issuer_id: "issuer_123",
    public_inputs_hash: "abc123",
    proof_hash: "def456",
    issued_at_ms: Date.now() - 86400000, // 1 day ago
    expires_at_ms: Date.now() + 86400000 * 30, // 30 days from now
  });

  describe("When snarkjs package is NOT installed", () => {
    it("should initialize without errors", () => {
      // Mock require to throw when trying to load snarkjs
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      expect(() => {
        const verifier = new DefaultZkKyaVerifier();
      }).not.toThrow();
    });

    it("should return ZK_KYA_NOT_IMPLEMENTED when verifying proofs", async () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      const proof = createTestProof();

      const result = await verifier.verify({
        agent_id: "agent1",
        proof,
        now_ms: Date.now(),
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toBe("ZK_KYA_NOT_IMPLEMENTED");
      expect(result.reason).toContain("snarkjs package not installed");
    });

    it("should still check expiration even without snarkjs", async () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      const now = Date.now();
      
      // Expired proof
      const expiredProof: ZkKyaProof = {
        ...createTestProof(),
        expires_at_ms: now - 1000, // Expired 1 second ago
      };

      const result = await verifier.verify({
        agent_id: "agent1",
        proof: expiredProof,
        now_ms: now,
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("ZK_KYA_EXPIRED");
      // Should fail on expiration before checking snarkjs availability
    });

    it("should provide helpful error message with installation instructions", async () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      const proof = createTestProof();

      const result = await verifier.verify({
        agent_id: "agent1",
        proof,
        now_ms: Date.now(),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain("snarkjs package not installed");
        expect(result.reason).toContain("npm install snarkjs");
      }
    });
  });

  describe("When snarkjs package IS installed", () => {
    it("should initialize with snarkjs when available", () => {
      // Mock snarkjs to be available
      const mockSnarkjs = {
        groth16: {
          verify: vi.fn(),
        },
      };

      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          return mockSnarkjs;
        }
        return originalRequire(id);
      });

      expect(() => {
        const verifier = new DefaultZkKyaVerifier();
      }).not.toThrow();
    });

    it("should attempt verification when snarkjs is available", async () => {
      // Mock snarkjs to be available
      const mockSnarkjs = {
        groth16: {
          verify: vi.fn().mockResolvedValue(true),
        },
      };

      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          return mockSnarkjs;
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      const proof = createTestProof();

      const result = await verifier.verify({
        agent_id: "agent1",
        proof,
        now_ms: Date.now(),
      });

      // Should attempt verification (currently returns success as placeholder)
      // Real implementation would call snarkjs.groth16.verify()
      expect(result.ok).toBe(true); // Placeholder implementation returns success
    });

    it("should reject unsupported schemes even with snarkjs", async () => {
      const mockSnarkjs = {
        groth16: {
          verify: vi.fn(),
        },
      };

      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          return mockSnarkjs;
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      
      // PLONK not supported (only groth16)
      const plonkProof: ZkKyaProof = {
        ...createTestProof(),
        scheme: "plonk",
      };

      const result = await verifier.verify({
        agent_id: "agent1",
        proof: plonkProof,
        now_ms: Date.now(),
      });

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("Unsupported ZK scheme");
      expect(result.reason).toContain("plonk");
      expect(result.reason).toContain("groth16");
    });
  });

  describe("Expiration checks (independent of snarkjs)", () => {
    it("should check expiration before attempting verification", async () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      const now = Date.now();
      
      // Not expired
      const validProof: ZkKyaProof = {
        ...createTestProof(),
        expires_at_ms: now + 86400000, // 1 day from now
      };

      const result1 = await verifier.verify({
        agent_id: "agent1",
        proof: validProof,
        now_ms: now,
      });

      // Should fail on snarkjs not installed, not expiration
      expect(result1.ok).toBe(false);
      expect(result1.reason).toContain("ZK_KYA_NOT_IMPLEMENTED");
      
      // Expired
      const expiredProof: ZkKyaProof = {
        ...createTestProof(),
        expires_at_ms: now - 1000,
      };

      const result2 = await verifier.verify({
        agent_id: "agent1",
        proof: expiredProof,
        now_ms: now,
      });

      // Should fail on expiration first
      expect(result2.ok).toBe(false);
      expect(result2.reason).toContain("ZK_KYA_EXPIRED");
    });

    it("should handle proofs without expiration", async () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "snarkjs") {
          throw new Error("Cannot find module 'snarkjs'");
        }
        return originalRequire(id);
      });

      const verifier = new DefaultZkKyaVerifier();
      
      const proofWithoutExpiration: ZkKyaProof = {
        ...createTestProof(),
        expires_at_ms: undefined,
      };

      const result = await verifier.verify({
        agent_id: "agent1",
        proof: proofWithoutExpiration,
        now_ms: Date.now(),
      });

      // Should not fail on expiration, but on snarkjs not installed
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("ZK_KYA_NOT_IMPLEMENTED");
    });
  });
});
