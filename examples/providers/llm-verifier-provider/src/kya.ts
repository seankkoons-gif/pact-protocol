/**
 * KYA (Know Your Agent) Verification
 * 
 * Basic KYA verification. No KYA required by default.
 * Set REQUIRE_KYA=1 environment variable to enable basic KYA.
 */

/**
 * Verify agent KYA credentials
 */
export async function verifyKya(params: {
  agentId: string;
  credentials?: string[];
}): Promise<{ ok: boolean; tier?: string; reason?: string }> {
  // Basic verification: check if agent has required credentials
  // In production, verify credentials against issuer registry

  console.log(`[KYA] Verifying agent: ${params.agentId.substring(0, 16)}...`);

  // If REQUIRE_KYA is set, enforce basic KYA
  if (process.env.REQUIRE_KYA === "1") {
    // Require at least one credential
    if (!params.credentials || params.credentials.length === 0) {
      return { ok: false, reason: "KYA required but no credentials provided" };
    }

    // Basic check: accept agents with credentials
    return { ok: true, tier: "verified" };
  }

  // No KYA required by default - accept all agents
  return { ok: true, tier: "unknown" };
}
