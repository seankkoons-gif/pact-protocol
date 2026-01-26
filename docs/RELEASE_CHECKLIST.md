# Pact Verifier – Release Checklist

**Version:** @pact/verifier v0.2.0  
**Audience:** GC, Compliance, Insurers, Regulators

## Determinism
- [x] Transcript replay deterministic (v4)
- [x] Judgment recomputation deterministic
- [x] Constitution hash pinned
- [x] Non-deterministic fields stripped before recompute

## Integrity
- [x] Hash chain verified
- [x] Signature verification enforced
- [x] Integrity failure halts approval (FAILED_INTEGRITY)

## Responsibility
- [x] Default Blame Logic (DBL v2.0)
- [x] Required next actor/action always present
- [x] Terminality explicit

## Evidence
- [x] Auditor Pack ZIP
- [x] SHA-256 checksums
- [x] Offline verification tool
- [x] Tamper detection tested

## Distribution
- [x] Standalone CLI
- [x] No network required
- [x] No SDK required
- [x] No runtime secrets

## Legal Posture
- [x] Pact is evidence-only
- [x] No custody of funds
- [x] No execution authority
- [x] Neutral arbiter role
