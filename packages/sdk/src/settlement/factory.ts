/**
 * Settlement Provider Factory
 * 
 * Creates settlement provider instances based on configuration.
 * Used by acquire() to select settlement provider (v1.6.2+).
 */

import type { SettlementProvider } from "./provider";
import { MockSettlementProvider } from "./mock";
import { ExternalSettlementProvider, type ExternalSettlementProviderConfig } from "./external";
import { StripeLikeSettlementProvider } from "./stripe_like";

export interface SettlementProviderConfig {
  provider: "mock" | "external" | "stripe_like";
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
    
    case "stripe_like":
      return new StripeLikeSettlementProvider();
    
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
    
    default:
      throw new Error(`Unknown settlement provider type: ${config.provider}. Must be "mock", "stripe_like", or "external"`);
  }
}

