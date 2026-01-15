/**
 * Baseline Negotiation Strategy
 * 
 * Default strategy that accepts the provider's quote price without counteroffers.
 * This preserves existing behavior where the system uses the provider's quote directly.
 */

import type { NegotiationStrategy } from "./strategy";
import type { NegotiationInput, NegotiationResult, NegotiationLogEntry } from "./types";

export class BaselineNegotiationStrategy implements NegotiationStrategy {
  async negotiate(input: NegotiationInput): Promise<NegotiationResult> {
    const startTime = Date.now();
    const log: NegotiationLogEntry[] = [];

    // Round 1: Start
    log.push({
      round: 1,
      timestamp_ms: startTime,
      decision: {
        type: "start",
        quote_price: input.quote_price,
        max_price: input.max_price,
      },
    });

    // Check if quote is within max price
    if (input.quote_price > input.max_price) {
      log.push({
        round: 1,
        timestamp_ms: Date.now(),
        decision: {
          type: "rejected",
          reason: `Quote price ${input.quote_price} exceeds max price ${input.max_price}`,
        },
      });

      return {
        ok: false,
        agreed_price: input.quote_price,
        rounds_used: 1,
        log,
        reason: `Quote price exceeds max price`,
      };
    }

    // Accept the quote
    const acceptTime = Date.now();
    log.push({
      round: 1,
      timestamp_ms: acceptTime,
      decision: {
        type: "accepted_quote",
        price: input.quote_price,
      },
    });

    // Done
    log.push({
      round: 1,
      timestamp_ms: acceptTime,
      decision: {
        type: "done",
        final_price: input.quote_price,
      },
    });

    return {
      ok: true,
      agreed_price: input.quote_price,
      rounds_used: 1,
      log,
    };
  }
}



