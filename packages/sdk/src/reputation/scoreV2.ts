/**
 * Reputation Scoring V2
 * 
 * Credential-aware, volume-weighted reputation scoring with enhanced penalties.
 */

import type { Receipt } from "../exchange/receipt";
import { receiptValue } from "./compute";

export type AgentScoreV2Context = {
  credentialPresent?: boolean;
  credentialClaims?: {
    credentials?: string[];
    region?: string;
    modes?: string[];
  };
  intentType?: string;
  trustScore?: number; // Trust score from credential trust scoring (0-1)
};

export type AgentScoreV2 = {
  agent_id: string;
  reputation: number;      // 0..1
  successRate: number;     // 0..1
  failureRate: number;     // 0..1
  avgLatencyMs: number | null;
  volume: number;          // sum of value (volume-weighted)
  trades: number;
  penalties: {
    failedProof: number;   // Count of FAILED_PROOF receipts
    buyerStopped: number;   // Count of BUYER_STOPPED receipts (for buyers)
  };
  notes: string[];         // Human-readable notes about scoring
};

const MIN_VOLUME_THRESHOLD = 1e-6; // Treat receipts < 1e-6 as 0 weight

/**
 * Compute volume-weighted value for a receipt.
 * Uses square root weighting to prevent micro-trade farming while still giving
 * some weight to smaller trades. This reduces the impact of large trades.
 * 
 * Formula: sqrt(value * reference) where reference = 0.01
 * This gives:
 * - Small values get proportionally more weight
 * - Large values get proportionally less weight
 * - Prevents gaming with many micro trades or few large trades
 */
function volumeWeight(value: number): number {
  if (value < MIN_VOLUME_THRESHOLD) {
    return 0;
  }
  // Use square root weighting with reference point to reduce large trade impact
  // Reference: 0.01 (typical small trade)
  // For value = 0.01: sqrt(0.01 * 0.01) = 0.01 (no change)
  // For value = 0.1: sqrt(0.1 * 0.01) = sqrt(0.001) ≈ 0.0316 (reduced)
  // This prevents large trades from dominating while still giving them more weight than micro trades
  const reference = 0.01;
  return Math.sqrt(value * reference);
}

/**
 * Compute agent score V2 with credential awareness and volume weighting.
 */
export function agentScoreV2(
  agentId: string,
  receipts: (Receipt | any)[],
  context?: AgentScoreV2Context
): AgentScoreV2 {
  // Filter receipts where agent is buyer or seller
  const relevant = receipts.filter(
    (r) => r.buyer_agent_id === agentId || r.seller_agent_id === agentId
  );

  const trades = relevant.length;

  if (trades === 0) {
    return {
      agent_id: agentId,
      reputation: 0.5, // Default neutral
      successRate: 0,
      failureRate: 0,
      avgLatencyMs: null,
      volume: 0,
      trades: 0,
      penalties: {
        failedProof: 0,
        buyerStopped: 0,
      },
      notes: context?.credentialPresent ? ["Credential verified, but no trade history"] : ["No trade history"],
    };
  }

  // Determine if agent is buyer or seller for penalty logic
  const isBuyer = relevant.some((r) => r.buyer_agent_id === agentId);
  const isSeller = relevant.some((r) => r.seller_agent_id === agentId);

  // Compute success/failure rates from ALL relevant receipts
  const successful = relevant.filter((r) => r.fulfilled === true);
  const failed = relevant.filter((r) => r.fulfilled === false);
  
  // Count penalties
  // FAILED_PROOF only applies to sellers (provider fraud)
  const failedProof = relevant.filter(
    (r) => r.seller_agent_id === agentId && r.fulfilled === false && (r as any).failure_code === "FAILED_PROOF"
  ).length;
  
  // Only count BUYER_STOPPED when agent was the buyer (not seller)
  const buyerStopped = relevant.filter(
    (r) => r.buyer_agent_id === agentId && (r as any).failure_code === "BUYER_STOPPED"
  ).length;

  const successRate = successful.length / trades;
  const failureRate = failed.length / trades;

  // Compute volume-weighted volume
  // Use paid_amount when present, otherwise agreed_price
  let totalVolume = 0;
  let totalWeightedVolume = 0;
  
  for (const r of relevant) {
    const value = receiptValue(r);
    totalVolume += value;
    totalWeightedVolume += volumeWeight(value);
  }

  // Compute average latency from substantial receipts only
  const substantial = relevant.filter((r) => receiptValue(r) >= MIN_VOLUME_THRESHOLD);
  const latencies = substantial
    .map((r) => r.latency_ms)
    .filter((ms): ms is number => typeof ms === "number" && ms > 0);

  const avgLatencyMs = latencies.length > 0
    ? latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length
    : null;

  // Clique dampening: check counterparty concentration (from substantial receipts)
  const counterpartyCounts = new Map<string, number>();
  for (const r of substantial) {
    const counterparty = r.buyer_agent_id === agentId
      ? r.seller_agent_id
      : r.buyer_agent_id;
    counterpartyCounts.set(counterparty, (counterpartyCounts.get(counterparty) ?? 0) + 1);
  }

  const maxCounterpartyCount = Math.max(...Array.from(counterpartyCounts.values()), 0);
  const concentration = substantial.length > 0 ? maxCounterpartyCount / substantial.length : 0;

  // Reputation calculation (volume-weighted):
  // 1. Base: 0.2 + 0.8 * successRate
  let reputation = 0.2 + 0.8 * successRate;

  // 2. Apply failure penalty: base * (1 - 0.5 * failureRate)
  reputation = reputation * (1 - 0.5 * failureRate);

  // 3. Strong penalty for FAILED_PROOF (provider fraud)
  if (isSeller && failedProof > 0) {
    // Each FAILED_PROOF significantly reduces reputation
    const failedProofRate = failedProof / trades;
    reputation = reputation * (1 - 0.8 * failedProofRate); // Strong penalty: up to 80% reduction
  }

  // 4. Penalty for BUYER_STOPPED (buyer behavior)
  if (isBuyer && buyerStopped > 0) {
    // BUYER_STOPPED penalizes buyer reputation (less severe than FAILED_PROOF)
    const buyerStoppedRate = buyerStopped / trades;
    reputation = reputation * (1 - 0.3 * buyerStoppedRate); // Moderate penalty: up to 30% reduction
  }

  // 5. Apply clique dampening if concentration > 0.6
  if (substantial.length >= 5 && concentration > 0.6) {
    reputation *= 0.5;
  }

  // 6. Credential bonus: small boost if credential is present and verified
  // Only apply if reputation is not already at maximum (to ensure boost is visible)
  // Multiply by trust_score if available (from credential trust scoring)
  if (context?.credentialPresent && reputation < 1.0) {
    const trustScore = (context as any).trustScore ?? 1.0; // Default to 1.0 if not provided
    const baseBoost = 1.05; // 5% boost
    // Apply trust score multiplier: trust_score of 0.5 means half the boost, 1.0 means full boost
    reputation = Math.min(1.0, reputation * (1 + (baseBoost - 1) * trustScore));
  }

  // 7. Clamp to [0, 1]
  reputation = Math.max(0, Math.min(1, reputation));

  // Build notes
  const notes: string[] = [];
  if (context?.credentialPresent) {
    notes.push("Credential verified");
  }
  if (failedProof > 0 && isSeller) {
    notes.push(`${failedProof} FAILED_PROOF penalty applied`);
  }
  if (buyerStopped > 0 && isBuyer) {
    notes.push(`${buyerStopped} BUYER_STOPPED penalty applied`);
  }
  if (substantial.length >= 5 && concentration > 0.6) {
    notes.push("Clique dampening applied");
  }
  if (totalVolume > 0 && totalWeightedVolume < totalVolume * 0.5) {
    notes.push("Volume-weighted scoring applied");
  }

  return {
    agent_id: agentId,
    reputation,
    successRate,
    failureRate,
    avgLatencyMs,
    volume: totalWeightedVolume, // Return weighted volume
    trades,
    penalties: {
      failedProof,
      buyerStopped,
    },
    notes,
  };
}

