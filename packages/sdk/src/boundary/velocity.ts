/**
 * Velocity / burst limit enforcement (prevention plane).
 *
 * In-memory rolling-window counters per buyer. When a limit is exceeded,
 * the boundary aborts with PACT-101 before settlement (money_moved stays false).
 */

import type { PolicyVelocityLimits } from "../policy/v4";

const WINDOW_MS = 60 * 1000; // 1 minute

interface VelocityEvent {
  ts_ms: number;
  amount: number;
  counterparty_id: string | undefined;
}

/** In-memory store: key -> list of events in the window. */
const store = new Map<string, VelocityEvent[]>();

function getKey(buyerAgentId: string): string {
  return buyerAgentId;
}

function prune(key: string, now_ms: number): void {
  const list = store.get(key);
  if (!list) return;
  const cutoff = now_ms - WINDOW_MS;
  const kept = list.filter((e) => e.ts_ms > cutoff);
  if (kept.length === 0) store.delete(key);
  else store.set(key, kept);
}

export interface VelocityCheckResult {
  allowed: boolean;
  /** If not allowed, reason for evidence_refs (e.g. "velocity.max_tx_per_minute exceeded"). */
  reason?: string;
}

/**
 * Check whether adding one more transaction would exceed velocity limits.
 * Call before settlement; if allowed, caller must call recordSuccess after.
 */
export function checkVelocityLimit(
  buyerAgentId: string,
  limits: PolicyVelocityLimits,
  now_ms: number,
  thisAmount: number,
  thisCounterpartyId: string | undefined
): VelocityCheckResult {
  if (
    limits.max_tx_per_minute == null &&
    limits.max_spend_per_minute == null &&
    limits.max_unique_counterparties_per_minute == null
  ) {
    return { allowed: true };
  }

  const key = getKey(buyerAgentId);
  prune(key, now_ms);
  const list = store.get(key) ?? [];

  const txCount = list.length + 1;
  const spend = list.reduce((s, e) => s + e.amount, 0) + thisAmount;
  const counterparties = new Set(list.map((e) => e.counterparty_id ?? "").filter(Boolean));
  if (thisCounterpartyId) counterparties.add(thisCounterpartyId);
  const uniqueCounterparties = counterparties.size;

  if (limits.max_tx_per_minute != null && txCount > limits.max_tx_per_minute) {
    return {
      allowed: false,
      reason: "velocity.max_tx_per_minute exceeded",
    };
  }
  if (limits.max_spend_per_minute != null && spend > limits.max_spend_per_minute) {
    return {
      allowed: false,
      reason: "velocity.max_spend_per_minute exceeded",
    };
  }
  if (
    limits.max_unique_counterparties_per_minute != null &&
    uniqueCounterparties > limits.max_unique_counterparties_per_minute
  ) {
    return {
      allowed: false,
      reason: "velocity.max_unique_counterparties_per_minute exceeded",
    };
  }

  return { allowed: true };
}

/**
 * Record a successful settlement for velocity accounting.
 * Call only after settlement would have been committed (we're enforcing before settlement, so call when we're about to return success).
 */
export function recordVelocitySuccess(
  buyerAgentId: string,
  now_ms: number,
  amount: number,
  counterpartyId: string | undefined
): void {
  const key = getKey(buyerAgentId);
  const list = store.get(key) ?? [];
  list.push({ ts_ms: now_ms, amount, counterparty_id: counterpartyId });
  store.set(key, list);
}
