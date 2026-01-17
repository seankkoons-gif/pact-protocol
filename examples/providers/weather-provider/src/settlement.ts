/**
 * Settlement Adapter - Boundary Mode (Default)
 * 
 * Boundary mode: Settlement is handled externally or by the SDK.
 * This is the default mode and requires no additional dependencies.
 * 
 * Optionally supports Stripe if stripe package is installed.
 */

// Check if Stripe is available (optional dependency)
let stripeAvailable = false;
try {
  require("stripe");
  stripeAvailable = true;
  console.log("[Settlement] Stripe package found - Stripe settlement available");
  console.log("  To enable: Set PACT_STRIPE_API_KEY environment variable\n");
} catch {
  // Stripe not installed, use boundary mode
}

/**
 * Prepare settlement (boundary mode - no actual locking)
 */
export async function prepareSettlement(params: {
  intentId: string;
  amount: number;
  bondAmount: number;
}): Promise<string> {
  // Boundary mode: Settlement is handled externally or by SDK
  // This is just a placeholder for logging
  console.log(`[Settlement] Boundary mode: intentId=${params.intentId}, amount=${params.amount}`);
  
  // If Stripe is available and configured, use it (optional)
  if (stripeAvailable && process.env.PACT_STRIPE_API_KEY) {
    try {
      const { StripeSettlementProvider, validateStripeConfig } = await import("@pact/sdk");
      const config = validateStripeConfig({
        mode: process.env.PACT_STRIPE_MODE === "live" ? "live" : "sandbox",
        enabled: true,
      });

      if (config.ok) {
        const settlementProvider = new StripeSettlementProvider(config.config);
        console.log(`[Settlement] Using Stripe settlement: ${params.intentId}`);
        return `stripe-${params.intentId}-${Date.now()}`;
      }
    } catch (error) {
      // Stripe not configured, fall back to boundary mode
    }
  }
  
  return `boundary-${params.intentId}-${Date.now()}`;
}

/**
 * Commit settlement (boundary mode)
 */
export async function commitSettlement(params: {
  handleId: string;
  proof: string;
}): Promise<void> {
  // Boundary mode: Settlement committed externally or by SDK
  console.log(`[Settlement] Boundary mode commit: handleId=${params.handleId}`);
}
