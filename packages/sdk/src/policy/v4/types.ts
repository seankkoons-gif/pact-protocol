/**
 * Pact Policy v4 Types
 * 
 * Deterministic, audit-grade constraint system for Pact v4 negotiations.
 */

/**
 * Policy v4 structure
 */
export interface PactPolicyV4 {
  policy_version: "pact-policy/4.0";
  policy_id: string;
  rules: PolicyRule[];
}

/**
 * Individual policy rule
 */
export interface PolicyRule {
  name: string;
  condition: PolicyCondition;
}

/**
 * Policy condition (recursive)
 */
export type PolicyCondition = ComparisonCondition | LogicalCondition;

/**
 * Comparison condition (field operator value)
 */
export interface ComparisonCondition {
  field: PolicyContextField;
  operator: ComparisonOperator;
  value: PolicyValue;
}

/**
 * Logical condition (AND/OR/NOT)
 */
export type LogicalCondition =
  | { AND: PolicyCondition[] }
  | { OR: PolicyCondition[] }
  | { NOT: PolicyCondition };

/**
 * Context fields available for policy evaluation
 */
export type PolicyContextField =
  | "offer_price"
  | "bid_price"
  | "counterparty_passport_score"
  | "counterparty_passport_confidence"
  | "counterparty_recent_failures"
  | "settlement_mode"
  | "intent_type"
  | "negotiation_round"
  | "transcript_created_at_ms";

/**
 * Comparison operators
 */
export type ComparisonOperator = "==" | "!=" | "<" | "<=" | ">" | ">=" | "IN" | "NOT IN";

/**
 * Policy values (primitives or arrays)
 */
export type PolicyValue = number | string | boolean | PolicyValue[];

/**
 * Policy evaluation context
 */
export interface PolicyEvaluationContext {
  offer_price?: number;
  bid_price?: number;
  counterparty_agent_id?: string;
  counterparty_passport_score?: number; // 0-100
  counterparty_passport_confidence?: number; // 0-1
  counterparty_recent_failures?: string[]; // Array of failure codes
  settlement_mode?: "boundary" | "stripe" | "escrow";
  intent_type?: string;
  negotiation_round?: number;
  transcript_created_at_ms?: number;
}

/**
 * Policy evaluation result
 */
export interface PolicyResult {
  allowed: boolean;
  violated_rules: ViolatedRule[];
  mapped_failure_code?: "PACT-101" | "PACT-201" | "PACT-303";
  evidence_refs: string[];
}

/**
 * Violated rule information
 */
export interface ViolatedRule {
  rule_name: string;
  condition: PolicyCondition;
  failure_code?: "PACT-101";
}
