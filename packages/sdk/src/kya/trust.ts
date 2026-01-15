/**
 * Credential Trust Scoring
 * 
 * Computes trust scores for credentials based on issuer, claims, and policy configuration.
 */

import type { KyaTrustConfig } from "../policy/types";

export interface CredentialTrustInput {
  credential: {
    issuer?: string;
    claims?: string[];
    region?: string;
    modes?: string[];
  };
  claims?: string[];
  requestContext?: {
    region?: string;
    settlementMode?: string;
  };
  policyTrustConfig: KyaTrustConfig;
}

export interface CredentialTrustResult {
  issuer: string;
  trust_score: number;
  tier: "untrusted" | "low" | "trusted";
  reasons: string[];
}

/**
 * Compute credential trust score based on issuer, claims, and policy configuration.
 */
export function computeCredentialTrustScore(
  input: CredentialTrustInput
): CredentialTrustResult {
  const { credential, claims = [], requestContext, policyTrustConfig } = input;
  const issuer = credential.issuer || "self";
  const reasons: string[] = [];
  
  // Start from issuer weight (default 0 if not found)
  let trustScore = policyTrustConfig.issuer_weights[issuer] || 0;
  
  // Check if issuer is in trusted issuers list
  const issuerTrusted = policyTrustConfig.trusted_issuers.includes(issuer);
  
  if (!issuerTrusted) {
    if (policyTrustConfig.require_trusted_issuer) {
      // If require_trusted_issuer is true and issuer not trusted, mark as invalid
      return {
        issuer,
        trust_score: 0,
        tier: "untrusted",
        reasons: [`Issuer "${issuer}" not in trusted issuers list`],
      };
    }
    reasons.push(`Issuer "${issuer}" not in trusted issuers list (not required)`);
  } else {
    reasons.push(`Issuer "${issuer}" is trusted`);
  }
  
  // Boosts (small, capped)
  // +0.1 if credential includes "sla_verified"
  const credentialClaims = credential.claims || claims;
  if (credentialClaims.includes("sla_verified")) {
    trustScore += 0.1;
    reasons.push("SLA verified boost (+0.1)");
  }
  
  // +0.05 if region matches request region (if both present)
  if (requestContext?.region && credential.region) {
    if (requestContext.region === credential.region) {
      trustScore += 0.05;
      reasons.push("Region match boost (+0.05)");
    }
  }
  
  // +0.05 if requested settlement mode is supported (if present)
  if (requestContext?.settlementMode && credential.modes) {
    if (credential.modes.includes(requestContext.settlementMode)) {
      trustScore += 0.05;
      reasons.push("Settlement mode match boost (+0.05)");
    }
  }
  
  // Clamp to [0, 1]
  trustScore = Math.max(0, Math.min(1, trustScore));
  
  // Determine tier: trusted if >=0.7, low if >=0.3 else untrusted
  let tier: "untrusted" | "low" | "trusted";
  if (trustScore >= 0.7) {
    tier = "trusted";
  } else if (trustScore >= 0.3) {
    tier = "low";
  } else {
    tier = "untrusted";
  }
  
  return {
    issuer,
    trust_score: trustScore,
    tier,
    reasons,
  };
}




