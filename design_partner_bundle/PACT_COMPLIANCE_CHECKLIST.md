# Pact Compliance Checklist — Vendor Evaluation Rubric

This checklist enables financial institutions and auditors to evaluate vendor implementations of the Pact Protocol. Each section defines what to request and how to verify compliance.

---

## 1. Evidence Integrity

**What to ask for:** Transcript file (JSON) or auditor pack (ZIP); GC View output (`pact-verifier gc-view --transcript <file>`)

**Compliant artifact must show:**
- `integrity.hash_chain: "VALID"` — Cryptographic chain linking all rounds intact
- `integrity.signatures_verified.verified == total` — All signatures verify against declared public keys
- `integrity.final_hash_validation: "MATCH"` — Container hash matches computed value

**Non-compliant indicators:** `hash_chain: "INVALID"`, `signatures_verified.verified < total`, missing integrity fields

---

## 2. Responsibility Attribution

**What to ask for:** DBL v2 judgment (`pact-verifier judge-v4 --transcript <file>`)

**Compliant artifact must show:**
- `version: "dbl/2.0"` — Current Default Blame Logic version
- `lastValidHash` (non-empty) — Last Valid Signed Hash (LVSH) established
- `dblDetermination` — Exactly one fault domain (NO_FAULT, BUYER_AT_FAULT, PROVIDER_AT_FAULT, etc.)
- `requiredNextActor` — Exactly one required actor (NONE, BUYER, PROVIDER, RAIL)
- `requiredAction` — Exactly one required action (NONE, RETRY, REFUND, FIX_POLICY, etc.)
- `terminal: true/false` — Clear terminality determination

**Non-compliant indicators:** Missing/empty `lastValidHash`, `status: "INDETERMINATE"` without justification, multiple/conflicting fault domains

---

## 3. Policy Enforcement

**What to ask for:** Transcript with policy constraints; GC View showing policy evaluation

**Compliant artifact must show:**
- `policy.policy_hash` present — Policy constraints declared and hashed
- `executive_summary.status: "ABORTED_POLICY"` when policy violated — Automatic termination before commitment
- `money_moved: false` for policy aborts — No funds committed on violation
- `requiredAction: "FIX_POLICY_OR_PARAMS"` for policy violations — Clear remediation path

**Non-compliant indicators:** Policy violations proceed to settlement, `money_moved: true` for policy aborts, missing policy hash

---

## 4. Tamper Resistance

**What to ask for:** Auditor pack (ZIP) with derived artifacts; Verification report (`pact-verifier auditor-pack-verify --zip <file>`)

**Compliant artifact must show:**
- `ok: true` — Pack passes recompute verification
- `checksums_ok: true` — File integrity verified
- `recompute_ok: true` — Derived artifacts recompute correctly from source transcript

**Non-compliant indicators:** `recompute_ok: false` (tampering detected), `checksums_ok: false` (file corruption), missing recompute verification (checksum-only is insufficient)

**Critical:** Recompute verification is sovereign proof. Checksum-only verification can be defeated by sophisticated attackers who recompute checksums after tampering.

---

## 5. Portability

**What to ask for:** Verifier CLI availability; Offline verification capability

**Compliant implementation must provide:**
- Standalone verifier executable (no network required)
- Deterministic output — Same transcript → same verification results
- No dependency on vendor servers — Verification can run independently
- Self-contained auditor packs — All evidence in single ZIP

**Non-compliant indicators:** Network calls required for verification, non-deterministic results, missing verifier CLI, vendor-specific formats

---

## 6. Contention Detection

**What to ask for:** Contention scan capability (`pact-verifier contention-scan --transcripts-dir <dir>`); Related transcripts for same intent

**Compliant implementation must show:**
- Contention scan command available — Can detect double-commit attempts
- Intent fingerprinting — Same intent + buyer + policy = same fingerprint
- Terminal state tracking — Multiple terminal transcripts for same intent flagged
- Evidence references — Related transcripts linked via intent fingerprint

**Non-compliant indicators:** No contention scanning, missing intent fingerprinting, no double-commit detection

---

## Verification Commands

```bash
# 1. Evidence Integrity
pact-verifier gc-view --transcript transcript.json | jq '.integrity'

# 2. Responsibility Attribution
pact-verifier judge-v4 --transcript transcript.json | jq '.version, .lastValidHash, .dblDetermination'

# 3. Policy Enforcement
pact-verifier gc-view --transcript transcript.json | jq '.executive_summary.status, .executive_summary.money_moved'

# 4. Tamper Resistance
pact-verifier auditor-pack-verify --zip auditor_pack.zip | jq '.ok, .recompute_ok'

# 5. Portability
pact-verifier --help  # Should work offline

# 6. Contention Detection
pact-verifier contention-scan --transcripts-dir ./transcripts
```

---

## Compliance Summary

| Criterion | Required | Verification Method |
|-----------|----------|---------------------|
| Evidence Integrity | ✅ Yes | `hash_chain: VALID`, all signatures verify |
| Responsibility Attribution | ✅ Yes | DBL v2 judgment with LVSH and fault domain |
| Policy Enforcement | ✅ Yes | Policy aborts prevent commitment |
| Tamper Resistance | ✅ Yes | Recompute verification passes |
| Portability | ✅ Yes | Offline, deterministic verification |
| Contention Detection | ✅ Yes | Contention scan available |

**All six criteria must pass for vendor compliance.**

---

## References

- **Constitution:** `CONSTITUTION_v1.md` — Rules of evidence and responsibility
- **GC Checklist:** `GC_5_MINUTE_APPROVAL_CHECKLIST.md` — Legal approval workflow
- **Demo:** `demo/h5-golden/` — Interactive compliance demonstrations
