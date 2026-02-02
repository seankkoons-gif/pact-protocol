# H5 Golden Demo — Executive Script

This demonstration validates the Pact Protocol's core guarantees through four scenarios. Total runtime: under 10 seconds. No network required.

---

## Prerequisites

```bash
pnpm verifier:build   # Build verifier CLI (one-time)
```

---

## Run All Scenarios

```bash
./demo/h5-golden/run_all.sh
```

Or run individually as described below.

---

## Scenario A: Successful Transaction

**Command:**
```bash
./demo/h5-golden/success/run.sh
```

**Point at on screen:**
- `ok: true` and `Outcome: COMPLETED` — cryptographic proof the transaction completed with valid signatures

**Punchline:** Audit-ready record with sovereign verification.

---

## Scenario B: Policy Abort (PACT-101)

**Command:**
```bash
./demo/h5-golden/policy_abort/run.sh
```

**Point at on screen:**
- `MONEY MOVED: FALSE` and `Fault Domain: BUYER_AT_FAULT` — policy guardrail prevented commitment, blame assigned deterministically

**Punchline:** Guardrail prevented spend; fault assigned automatically.

---

## Scenario C: Tamper Detection

**Command:**
```bash
./demo/h5-golden/tamper/run.sh
```

**Point at on screen:**
- `checksums_ok: true` but `recompute_ok: false` — attacker passed checksum verification but failed recompute verification

**Punchline:** Tamper attempt detected; evidence remains admissible.

---

## Scenario D: Tier T3 + SLA (daily digest)

**Command:**
```bash
./demo/h5-golden/tier3/run.sh
```

**Point at on screen:**
- `ok: true` — pack with tier=T3 and SLA="daily digest" verifies like any other; tier/SLA are informational only
- Manifest / GC view shows `audit_tier`, `audit_sla`; Evidence Viewer displays them with note that tier affects audit schedule, not admissibility

**Punchline:** Tier and SLA change audit cadence only; they do not reduce verification or admissibility. See [docs/gc/TIERED_VERIFICATION_NOTE.md](../../docs/gc/TIERED_VERIFICATION_NOTE.md).

---

## Output Files

Each scenario generates:

| File | Purpose |
|------|---------|
| `auditor_pack_*.zip` | Self-contained evidence bundle |
| `CUSTOMER_MESSAGE.txt` | Plain-English customer notification |
| `INSURER_MESSAGE.txt` | Underwriting summary |

---

## Verification Independence

All verification is performed locally using deterministic recomputation. No trust in the pack creator is required. Any party can independently verify any auditor pack using:

```bash
pact-verifier auditor-pack-verify --zip <path-to-pack.zip>
```

---

## Summary

| Scenario | Outcome | Money Moved | Fault | Coverage |
|----------|---------|-------------|-------|----------|
| A: Success | COMPLETED | Yes | NO_FAULT | COVERED |
| B: Policy Abort | ABORTED_POLICY | No | BUYER_AT_FAULT | COVERED_WITH_SURCHARGE |
| C: Tamper | COMPROMISED | Unknown | Unknown | EXCLUDED |
| D: Tier T3 + SLA | COMPLETED | Yes | NO_FAULT | COVERED (tier/SLA informational only) |