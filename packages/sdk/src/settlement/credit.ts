/**
 * Credit v1 Settlement Interop
 * 
 * Handles partial escrow funding for credit-enabled commitments.
 * If settlement provider doesn't support partial escrow, credit is gracefully denied.
 */

import type { SettlementProvider } from "./provider";
import type { SettlementIntent, SettlementHandle, SettlementResult } from "./types";

/**
 * Check if settlement provider supports partial escrow funding.
 * 
 * @param provider Settlement provider
 * @returns true if provider supports partial escrow, false otherwise
 */
export function supportsPartialEscrow(provider: SettlementProvider): boolean {
  // For v1, we check if provider has a method to handle partial escrow
  // Most providers (mock, stripe_like) require full amount
  // Escrow providers may support partial funding
  
  // Check provider type
  const providerType = provider.constructor.name;
  
  // Mock provider: supports partial escrow (for testing)
  if (providerType === "MockSettlementProvider") {
    return true;
  }
  
  // Escrow providers: may support partial escrow (implementation-dependent)
  // For now, we assume escrow providers support it if they have a partial_funding flag
  if ("supportsPartialFunding" in provider && typeof (provider as any).supportsPartialFunding === "function") {
    return (provider as any).supportsPartialFunding();
  }
  
  // Default: assume no partial escrow support
  return false;
}

/**
 * Prepare settlement with partial escrow (if supported) or full amount.
 * 
 * If provider doesn't support partial escrow and credit is required,
 * this function returns an error result indicating credit is not compatible.
 * 
 * @param provider Settlement provider
 * @param intent Settlement intent
 * @param requiredCollateralUsd Required collateral amount (may be less than intent.amount)
 * @returns Settlement result
 */
export async function prepareSettlementWithCredit(
  provider: SettlementProvider,
  intent: SettlementIntent,
  requiredCollateralUsd: number
): Promise<SettlementHandle> {
  // If required collateral equals full amount, use normal settlement
  if (requiredCollateralUsd >= intent.amount) {
    return provider.prepare(intent);
  }
  
  // Partial escrow required - check if provider supports it
  if (!supportsPartialEscrow(provider)) {
    // Provider doesn't support partial escrow - deny credit gracefully
    // Return an aborted handle
    return {
      handle_id: "",
      intent_id: intent.intent_id,
      status: "aborted",
      locked_amount: 0,
      created_at_ms: Date.now(),
      meta: {
        failure_code: "CREDIT_NOT_SUPPORTED",
        failure_reason: "Settlement provider does not support partial escrow funding. Credit requires 100% collateral.",
      },
    };
  }
  
  // Provider supports partial escrow - prepare with reduced amount
  // Create modified intent with partial amount
  const partialIntent: SettlementIntent = {
    ...intent,
    amount: requiredCollateralUsd,
    meta: {
      ...intent.meta,
      credit_enabled: true,
      full_amount: intent.amount,
      collateral_amount: requiredCollateralUsd,
      credit_exposure: intent.amount - requiredCollateralUsd,
    },
  };
  
  return provider.prepare(partialIntent);
}

/**
 * Check if credit is compatible with settlement provider.
 * 
 * This is a pre-check before attempting settlement to determine
 * if credit can be used with the given provider.
 * 
 * @param provider Settlement provider
 * @param requiredCollateralUsd Required collateral amount
 * @param fullAmountUsd Full commitment amount
 * @returns true if credit is compatible, false otherwise
 */
export function isCreditCompatibleWithProvider(
  provider: SettlementProvider,
  requiredCollateralUsd: number,
  fullAmountUsd: number
): boolean {
  // If required collateral equals full amount, always compatible (no credit)
  if (requiredCollateralUsd >= fullAmountUsd) {
    return true;
  }
  
  // Partial escrow required - check if provider supports it
  return supportsPartialEscrow(provider);
}
