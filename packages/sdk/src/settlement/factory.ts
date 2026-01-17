/**
 * Settlement Provider Factory
 * 
 * Creates settlement provider instances based on configuration.
 * Used by acquire() to select settlement provider (v1.6.2+).
 */

import type { SettlementProvider } from "./provider";
import { MockSettlementProvider } from "./mock";
import { ExternalSettlementProvider, type ExternalSettlementProviderConfig } from "./external";
import { StripeLikeSettlementProvider, type StripeLikeSettlementProviderConfig } from "./stripe_like";
import { StripeSettlementProvider, validateStripeConfig } from "./stripe_live";

export interface SettlementProviderConfig {
  provider: "mock" | "external" | "stripe_like" | "stripe_live";
  params?: Record<string, unknown>; // Parameters for external provider
  idempotency_key?: string; // Optional idempotency key (stored for lifecycle operations)
}

/**
 * Creates a settlement provider based on configuration.
 * 
 * @param config Settlement provider configuration
 * @returns SettlementProvider instance
 * @throws Error if provider type is invalid or required params are missing
 */
export function createSettlementProvider(config: SettlementProviderConfig): SettlementProvider {
  switch (config.provider) {
    case "mock":
      return new MockSettlementProvider();
    
    case "stripe_like": {
      // v1.7.2+: Support async config via params
      const asyncConfig: StripeLikeSettlementProviderConfig | undefined = config.params
        ? {
            asyncCommit: config.params.asyncCommit === true,
            commitDelayTicks: typeof config.params.commitDelayTicks === "number" ? config.params.commitDelayTicks : undefined,
            failCommit: config.params.failCommit === true,
          }
        : undefined;
      return new StripeLikeSettlementProvider(asyncConfig);
    }
    
    case "external": {
      // External provider requires params with at least 'rail'
      if (!config.params || typeof config.params !== "object") {
        throw new Error("External settlement provider requires 'params' with 'rail' field (e.g., { rail: 'stripe', network: 'testnet' })");
      }
      
      const rail = config.params.rail;
      if (typeof rail !== "string" || !rail) {
        throw new Error("External settlement provider requires 'params.rail' to be a non-empty string (e.g., 'stripe', 'ethereum', 'solana')");
      }
      
      const externalConfig: ExternalSettlementProviderConfig = {
        rail,
        network: typeof config.params.network === "string" ? config.params.network : undefined,
        credentials: config.params.credentials,
      };
      
      return new ExternalSettlementProvider(externalConfig);
    }
    
    case "stripe_live": {
      // v2 Phase 3: Stripe settlement provider
      // Note: "stripe_live" is the identifier; provider name is "Stripe" (not "Stripe Live")
      // Mode ("sandbox" vs "live") is configured via StripeConfig.mode
      // Validate config from params + env
      const validation = validateStripeConfig(config.params || {});
      
      if (!validation.ok) {
        throw new Error(`Stripe settlement provider configuration invalid: ${validation.reason}`);
      }
      
      return new StripeSettlementProvider(validation.config);
    }
    
    default:
      throw new Error(`Unknown settlement provider type: ${config.provider}. Must be "mock", "stripe_like", "stripe_live", or "external"`);
  }
}

