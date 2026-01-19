/**
 * Policy v4 Evaluation Engine
 * 
 * Deterministic, side-effect-free policy evaluation for Pact v4.
 */

import type {
  PactPolicyV4,
  PolicyRule,
  PolicyCondition,
  ComparisonCondition,
  LogicalCondition,
  PolicyEvaluationContext,
  PolicyResult,
  ViolatedRule,
} from "./types";

/**
 * Evaluate policy against context.
 * 
 * Requirements:
 * - Side-effect free (no network, no mutable state)
 * - Deterministic (same policy + context → same result)
 * - Failure code mapping (PACT-101 for policy violations)
 * 
 * @param policy Policy v4 object
 * @param context Evaluation context (only transcript state)
 * @returns Policy evaluation result
 */
export function evaluatePolicy(
  policy: PactPolicyV4,
  context: PolicyEvaluationContext
): PolicyResult {
  const violated_rules: ViolatedRule[] = [];
  const evidence_refs: string[] = [];

  // Evaluate each rule
  for (const rule of policy.rules) {
    const conditionResult = evaluateCondition(rule.condition, context);
    
    if (!conditionResult) {
      // Rule violated
      violated_rules.push({
        rule_name: rule.name,
        condition: rule.condition,
        failure_code: "PACT-101",
      });

      // Add evidence reference
      evidence_refs.push(
        `policy_rule:${rule.name}:${policy.policy_id}`
      );
    }
  }

  // Determine if allowed
  const allowed = violated_rules.length === 0;

  // Map failure code
  let mapped_failure_code: "PACT-101" | "PACT-201" | "PACT-303" | undefined;
  if (!allowed) {
    // Default to PACT-101 (Policy violation)
    mapped_failure_code = "PACT-101";

    // Check for identity/KYA failures (map to PACT-201)
    // This is a heuristic: if violation involves passport/identity fields
    const hasIdentityViolation = violated_rules.some((vr) => {
      const condition = vr.condition as ComparisonCondition;
      if ("field" in condition) {
        return condition.field.startsWith("counterparty_");
      }
      return false;
    });
    // Note: For now, we keep PACT-101 as default. Identity failures are handled separately.

    // Check for deadlock/negotiation failures (map to PACT-303)
    // This is a heuristic: if violation involves negotiation constraints
    const hasNegotiationViolation = violated_rules.some((vr) => {
      const condition = vr.condition as ComparisonCondition;
      if ("field" in condition) {
        return condition.field === "negotiation_round";
      }
      return false;
    });
    // Note: For now, we keep PACT-101 as default. Negotiation deadlocks are handled separately.
  }

  // Add policy_id reference for debugging (computed policy_hash is added by boundary runtime)
  if (!allowed) {
    evidence_refs.push(`policy_id:${policy.policy_id}`);
  }

  return {
    allowed,
    violated_rules,
    mapped_failure_code,
    evidence_refs,
  };
}

/**
 * Evaluate a single condition recursively.
 * 
 * @param condition Policy condition
 * @param context Evaluation context
 * @returns true if condition passes, false if violated
 */
function evaluateCondition(
  condition: PolicyCondition,
  context: PolicyEvaluationContext
): boolean {
  // Comparison condition
  if ("field" in condition && "operator" in condition && "value" in condition) {
    return evaluateComparison(condition as ComparisonCondition, context);
  }

  // Logical condition
  if ("AND" in condition || "OR" in condition || "NOT" in condition) {
    return evaluateLogical(condition as LogicalCondition, context);
  }

  // Unknown condition type
  return false;
}

/**
 * Evaluate comparison condition.
 * 
 * @param condition Comparison condition
 * @param context Evaluation context
 * @returns true if comparison passes
 */
function evaluateComparison(
  condition: ComparisonCondition,
  context: PolicyEvaluationContext
): boolean {
  const { field, operator, value } = condition;

  // Get field value from context
  const fieldValue = getFieldValue(context, field);

  // Handle undefined field values
  if (fieldValue === undefined) {
    // If field is required but undefined, condition fails
    return false;
  }

  // Evaluate based on operator
  let result: boolean;
  switch (operator) {
    case "==":
      result = fieldValue === value;
      break;

    case "!=":
      result = fieldValue !== value;
      break;

    case "<":
      result = typeof fieldValue === "number" && typeof value === "number" && fieldValue < value;
      break;

    case "<=":
      result = typeof fieldValue === "number" && typeof value === "number" && fieldValue <= value;
      break;

    case ">":
      result = typeof fieldValue === "number" && typeof value === "number" && fieldValue > value;
      break;

    case ">=":
      result = typeof fieldValue === "number" && typeof value === "number" && fieldValue >= value;
      break;

    case "IN":
      // For arrays, check if any element of fieldValue is in value array
      if (Array.isArray(fieldValue) && Array.isArray(value)) {
        result = fieldValue.some((fv) => value.includes(fv));
      } else {
        result = Array.isArray(value) && value.includes(fieldValue);
      }
      break;

    case "NOT IN":
      // For arrays, check if any element of fieldValue is in value array
      if (Array.isArray(fieldValue) && Array.isArray(value)) {
        result = !fieldValue.some((fv) => value.includes(fv));
      } else {
        result = Array.isArray(value) && !value.includes(fieldValue);
      }
      break;

    default:
      result = false;
  }
  
  return result;
}

/**
 * Evaluate logical condition.
 * 
 * @param condition Logical condition
 * @param context Evaluation context
 * @returns true if logical condition passes
 */
function evaluateLogical(
  condition: LogicalCondition,
  context: PolicyEvaluationContext
): boolean {
  if ("AND" in condition) {
    // All conditions must pass
    return condition.AND.every((c) => evaluateCondition(c, context));
  }

  if ("OR" in condition) {
    // At least one condition must pass
    return condition.OR.some((c) => evaluateCondition(c, context));
  }

  if ("NOT" in condition) {
    // Condition must fail
    return !evaluateCondition(condition.NOT, context);
  }

  return false;
}

/**
 * Get field value from context.
 * 
 * @param context Evaluation context
 * @param field Field name
 * @returns Field value or undefined
 */
function getFieldValue(
  context: PolicyEvaluationContext,
  field: string
): any {
  switch (field) {
    case "offer_price":
      return context.offer_price;

    case "bid_price":
      return context.bid_price;

    case "counterparty_passport_score":
      return context.counterparty_passport_score;

    case "counterparty_passport_confidence":
      return context.counterparty_passport_confidence;

    case "counterparty_recent_failures":
      return context.counterparty_recent_failures;

    case "settlement_mode":
      return context.settlement_mode;

    case "intent_type":
      return context.intent_type;

    case "negotiation_round":
      return context.negotiation_round;

    case "transcript_created_at_ms":
      return context.transcript_created_at_ms;

    default:
      return undefined;
  }
}
