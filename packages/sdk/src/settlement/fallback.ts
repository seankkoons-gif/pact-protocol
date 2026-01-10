/**
 * Settlement Provider Fallback Logic (B2)
 * 
 * Handles retryable failure detection and fallback candidate ordering.
 */

export interface ProviderCandidate {
  provider_id: string;
  pubkey_b58: string;
  credentials?: string[];
  region?: string;
  baseline_latency_ms?: number;
  endpoint?: string; // HTTP endpoint for real providers
}

export interface FallbackPlanParams {
  candidates: ProviderCandidate[];
  primaryProviderId: string;
}

/**
 * Determine if a failure code is retryable (should try next provider).
 * 
 * Retryable failures are typically temporary or provider-specific:
 * - SETTLEMENT_FAILED: Settlement provider commit failure
 * - SETTLEMENT_POLL_TIMEOUT: Settlement polling timed out
 * - SETTLEMENT_PENDING_UNRESOLVED: Settlement stuck in pending state
 * - SETTLEMENT_PROVIDER_NOT_IMPLEMENTED: Settlement provider not available
 * 
 * Non-retryable failures are permanent and indicate fundamental issues:
 * - FAILED_PROOF: Invalid proof (data integrity issue)
 * - PROVIDER_CREDENTIAL_*: Credential validation failures
 * - PROVIDER_TRUST_*: Trust tier/score failures
 * - POLICY_*: Policy constraint violations
 * 
 * @param code Failure code from acquire result or settlement error
 * @returns true if failure is retryable, false otherwise
 */
export function isRetryableFailure(code: string): boolean {
  // Non-retryable codes (permanent failures)
  const nonRetryablePatterns = [
    "FAILED_PROOF",
    "PROVIDER_CREDENTIAL",
    "PROVIDER_TRUST",
    "POLICY_",
    "UNTRUSTED_ISSUER",
    "MISSING_REQUIRED_CREDENTIALS",
    "QUOTE_OUT_OF_BAND",
    "FAILED_REFERENCE_BAND",
    "SETTLEMENT_MODE_NOT_ALLOWED",
    "PRE_SETTLEMENT_LOCK_REQUIRED",
    "BOND_INSUFFICIENT", // Usually indicates insufficient funds, not retryable
    "SCHEMA_VALIDATION_FAILED",
    "INVALID_POLICY",
  ];
  
  // Check for non-retryable patterns (prefix match)
  for (const pattern of nonRetryablePatterns) {
    if (code.startsWith(pattern)) {
      return false;
    }
  }
  
  // Retryable codes (temporary or provider-specific failures)
  const retryableCodes = [
    "SETTLEMENT_FAILED",
    "SETTLEMENT_POLL_TIMEOUT",
    "SETTLEMENT_PENDING_UNRESOLVED",
    "SETTLEMENT_PROVIDER_NOT_IMPLEMENTED",
    "PROVIDER_QUOTE_HTTP_ERROR",
    "PROVIDER_QUOTE_PARSE_ERROR",
    "PROVIDER_SIGNATURE_INVALID", // Could be temporary network issue
    "PROVIDER_SIGNER_MISMATCH", // Provider misconfiguration, try next one
    "PROVIDER_QUOTE_INVALID", // Invalid quote format, provider issue
    "HTTP_PROVIDER_ERROR", // HTTP provider communication error
    "HTTP_STREAMING_ERROR", // HTTP streaming error (network/provider issue)
    "INVALID_MESSAGE_TYPE", // Invalid message format from provider (provider issue)
    "NO_ELIGIBLE_PROVIDERS", // If no providers, try next candidate
  ];
  
  if (retryableCodes.includes(code)) {
    return true;
  }
  
  // Default: assume non-retryable for safety (don't retry unknown failures)
  return false;
}

/**
 * Build ordered fallback plan from eligible candidates.
 * 
 * Rules:
 * - Primary candidate (selected by utility) is first
 * - Remaining candidates follow in original order (from directory/evaluation)
 * 
 * @param params Fallback plan parameters
 * @returns Ordered list of provider candidates for fallback attempts
 */
export function buildFallbackPlan(params: FallbackPlanParams): ProviderCandidate[] {
  const { candidates, primaryProviderId } = params;
  
  if (candidates.length === 0) {
    return [];
  }
  
  // Find primary candidate
  const primaryIndex = candidates.findIndex(c => c.provider_id === primaryProviderId);
  
  if (primaryIndex === -1) {
    // Primary not found in candidates, return candidates as-is
    // This shouldn't happen in normal flow, but handle gracefully
    return [...candidates];
  }
  
  // Build ordered plan: primary first, then remaining in original order
  const ordered: ProviderCandidate[] = [candidates[primaryIndex]];
  
  // Add remaining candidates in original order (excluding primary)
  for (let i = 0; i < candidates.length; i++) {
    if (i !== primaryIndex) {
      ordered.push(candidates[i]);
    }
  }
  
  return ordered;
}

