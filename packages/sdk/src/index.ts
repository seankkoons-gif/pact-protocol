// packages/sdk/src/index.ts

// Protocol (keep full export)
export * from "./protocol/index";

// Policy (explicit exports to avoid name collisions)
export * from "./policy/types";
export * from "./policy/context";
export * from "./policy/validate";
export * from "./policy/compiler";
export * from "./policy/guard";
export * from "./policy/defaultGuard";
export * from "./policy/defaultPolicy";

// Engine
export * from "./engine/index";

// Settlement
export * from "./settlement/types";
export * from "./settlement/provider";
export * from "./settlement/mock";
export * from "./settlement/external";
export * from "./settlement/stripe_like";
export * from "./settlement/stripe_live"; // v2 Phase 3: Stripe settlement provider
export * from "./settlement/factory";

// Exchange
export * from "./exchange/receipt";
export * from "./exchange/commit";
export * from "./exchange/reveal";
export * from "./exchange/agreement";
export * from "./exchange/streaming";

// Reputation
export { ReceiptStore } from "./reputation/store";
export { receiptValue, priceStats, referencePriceP50, agentScore } from "./reputation/compute";
export { agentScoreV2 } from "./reputation/scoreV2";
export type { AgentScore, PriceStats } from "./reputation/types";
export type { AgentScoreV2, AgentScoreV2Context } from "./reputation/scoreV2";

// Router
export * from "./router/index";

// Client
export * from "./client/index";

// Disputes
export * from "./disputes/index";

// Directory
export * from "./directory/index";

// Adapters
export * from "./adapters/http/index";

// KYA (Know Your Agent)
export * from "./kya/index";

// Transcript (v1.5.4+)
export * from "./transcript/types";
export { TranscriptStore } from "./transcript/store";
export { replayTranscript, verifyTranscriptFile } from "./transcript/replay";
export type { ReplayResult, ReplayFailure, ReplayOptions } from "./transcript/replay";

// Reconciliation (v1.6+, D2)
export * from "./reconcile/index";

// Negotiation (v2.1+)
export * from "./negotiation/index";

// Assets (v2.2+)
export * from "./assets/index";

// Wallets (v2.3+)
export * from "./wallets/index";

// Security (v2 Phase 4)
export * from "./security/index";

// ZK-KYA (v2 Phase 5)
export * from "./kya/zk/index";
export type { ZkKyaVerifier } from "./kya/zk/verifier";

// Pact v4 (Complete)
export * from "./boundary/index";
export * from "./policy/v4";
export * from "./transcript/v4";
export * from "./disputes/v4";
