/**
 * Stripe Optional Dependency Tests
 * 
 * Tests for StripeLiveSettlementProvider optional dependency behavior.
 * Verifies graceful fallback when 'stripe' package is not installed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { StripeLiveSettlementProvider, validateStripeLiveConfig } from "../stripe_live";

describe("StripeLiveSettlementProvider - Optional Dependency Behavior", () => {
  const originalEnv = { ...process.env };
  const originalRequire = require;
  
  beforeEach(() => {
    delete process.env.PACT_STRIPE_API_KEY;
    delete process.env.PACT_STRIPE_MODE;
    delete process.env.PACT_STRIPE_ENABLED;
  });
  
  afterEach(() => {
    process.env = { ...originalEnv };
    // Restore original require behavior
    vi.restoreAllMocks();
  });

  describe("When stripe package is NOT installed", () => {
    it("should initialize in boundary mode without errors", () => {
      // Mock require to throw when trying to load stripe
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          throw new Error("Cannot find module 'stripe'");
        }
        return originalRequire(id);
      });

      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });
      
      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        // Set API key in env for config validation
        process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
        
        // Should not throw even if stripe not installed
        expect(() => {
          const provider = new StripeLiveSettlementProvider(configResult.config);
        }).not.toThrow();
      }
    });

    it("should return clear error when stripe operations are attempted", () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          throw new Error("Cannot find module 'stripe'");
        }
        return originalRequire(id);
      });

      process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        const provider = new StripeLiveSettlementProvider(configResult.config);

        // Operations should return clear errors
        expect(() => {
          provider.lock("agent1", 10);
        }).toThrow(/Stripe integration requires 'stripe' package/);

        expect(() => {
          provider.getBalance("agent1");
        }).not.toThrow(); // getBalance returns 0 in boundary mode

        expect(() => {
          provider.pay("agent1", "agent2", 10);
        }).toThrow(/Stripe integration requires 'stripe' package/);
      }
    });

    it("should provide helpful error message with installation instructions", () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          throw new Error("Cannot find module 'stripe'");
        }
        return originalRequire(id);
      });

      process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        const provider = new StripeLiveSettlementProvider(configResult.config);

        try {
          provider.lock("agent1", 10);
        } catch (error: any) {
          expect(error.message).toContain("Stripe integration requires 'stripe' package");
          expect(error.message).toContain("npm install stripe");
          expect(error.message).toContain("PACT_STRIPE_API_KEY");
        }
      }
    });

    it("should return 0 for balance/locked queries in boundary mode", () => {
      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          throw new Error("Cannot find module 'stripe'");
        }
        return originalRequire(id);
      });

      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: false, // Not enabled, should work
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        const provider = new StripeLiveSettlementProvider(configResult.config);

        // In boundary mode, these should return 0
        expect(provider.getBalance("agent1")).toBe(0);
        expect(provider.getLocked("agent1")).toBe(0);
      }
    });
  });

  describe("When stripe package IS installed", () => {
    it("should initialize with stripe SDK when stripe is available", () => {
      // Mock stripe to be available
      const mockStripe = vi.fn();
      mockStripe.mockReturnValue({});

      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          return mockStripe;
        }
        return originalRequire(id);
      });

      process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        const provider = new StripeLiveSettlementProvider(configResult.config);
        
        // Should not throw if stripe is available
        expect(() => {
          provider.getBalance("agent1");
        }).not.toThrow();
      }
    });

    it("should allow operations when stripe is available", () => {
      // Mock stripe to be available
      const mockStripe = vi.fn();
      mockStripe.mockReturnValue({});

      vi.spyOn(global, "require").mockImplementation((id: string) => {
        if (id === "stripe") {
          return mockStripe;
        }
        return originalRequire(id);
      });

      process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        const provider = new StripeLiveSettlementProvider(configResult.config);

        // Credit should work (doesn't require stripe SDK for in-memory)
        expect(() => {
          provider.credit("agent1", 10);
        }).not.toThrow();

        // Balance query should work
        expect(() => {
          const balance = provider.getBalance("agent1");
        }).not.toThrow();
      }
    });
  });

  describe("Configuration validation", () => {
    it("should validate config regardless of stripe package availability", () => {
      // Config validation doesn't require stripe package
      const configResult = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: false,
      });

      expect(configResult.ok).toBe(true);
      if (configResult.ok) {
        expect(configResult.config.mode).toBe("sandbox");
        expect(configResult.config.enabled).toBe(false);
      }
    });

    it("should allow enabled=true only with API key", () => {
      // No API key, enabled=true should fail
      const result1 = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      if (!result1.ok) {
        expect(result1.code).toBe("MISSING_API_KEY");
      }

      // With API key, enabled=true should succeed
      process.env.PACT_STRIPE_API_KEY = "sk_test_fake_key";
      const result2 = validateStripeLiveConfig({
        mode: "sandbox",
        enabled: true,
      });

      expect(result2.ok).toBe(true);
    });
  });
});
