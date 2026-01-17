/**
 * Negotiation Policy
 * 
 * Default policy for LLM verifier provider.
 */

import type { PactPolicy } from "@pact/sdk";
import { createDefaultPolicy } from "@pact/sdk";

/**
 * Default provider policy
 */
export const defaultPolicy: PactPolicy = createDefaultPolicy();
