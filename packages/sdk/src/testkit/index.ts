/**
 * Test Kit (v2 improvement E)
 * 
 * Test utilities and adapters for deterministic testing.
 * 
 * ⚠️ IMPORTANT: This module is NOT exported in package.json.
 * DO NOT import from "@pact/sdk/testkit" - it will fail.
 * 
 * For tests, import directly from source:
 * - import { TestWalletAdapter } from "../wallets/__tests__/test-adapter"
 * - import { createTestZkKyaVerifier } from "../kya/zk/verifier"
 * - import { MockSettlementProvider } from "@pact/sdk" (main export)
 * - import { StubMLScorer } from "../negotiation/ml/stub_scorer"
 * 
 * This module provides test-only utilities that should not be used in production code.
 */

// These exports are for internal use only and are NOT accessible via @pact/sdk/testkit
export { TestWalletAdapter } from "../wallets/__tests__/test-adapter";
export { createTestZkKyaVerifier } from "../kya/zk/verifier";
export { MockSettlementProvider } from "../settlement/mock";
export { StubMLScorer } from "../negotiation/ml/stub_scorer";
export type { MLScorer, MLScorerInput, MLScorerOutput } from "../negotiation/ml/types";
