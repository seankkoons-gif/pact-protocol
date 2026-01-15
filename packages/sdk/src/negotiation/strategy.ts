/**
 * Negotiation Strategy Interface
 * 
 * Interface for negotiation strategies that determine the agreed price
 * between buyer and provider.
 */

import type { NegotiationInput, NegotiationResult } from "./types";

export interface NegotiationStrategy {
  /**
   * Negotiate the price between buyer and provider.
   * 
   * @param input - Negotiation input including quote price, max price, etc.
   * @returns Promise resolving to negotiation result with agreed price and log
   */
  negotiate(input: NegotiationInput): Promise<NegotiationResult>;
}



