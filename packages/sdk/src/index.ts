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
export * from "./settlement/provider";
export * from "./settlement/mock";

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

// Directory
export * from "./directory/index";

// Adapters
export * from "./adapters/http/index";

// KYA (Know Your Agent)
export * from "./kya/index";
