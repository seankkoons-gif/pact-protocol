# Pact: 5-Minute Legal Approval Checklist

**Audience:** General Counsel, Risk, Compliance, Insurers  
**Goal:** Decide whether Pact evidence is sufficient to approve automated agent transactions.

---

## 1. What Pact Is (30 seconds)

Pact is **not** a payment rail, marketplace, or agent framework.

Pact is an **evidence-generation and responsibility attribution system** for autonomous transactions.

Every Pact-run transaction produces:

- A cryptographically verifiable transcript
- Deterministic fault attribution
- A signed, replayable evidence bundle
- A policy-enforced abort / refund boundary

**If money moves, Pact guarantees who is responsible, why, and what must happen next.**

---

## 2. What You Are Approving (30 seconds)

**You are approving:**

- Pact's Rules of Evidence (the Constitution)
- Pact's Default Blame Logic (DBL)
- Pact's ability to generate court-grade artifacts for agent activity

**You are not approving:**

- The agent's strategy
- The provider's API
- The underlying payment rail

---

## 3. The Constitution (1 minute)

Every GC View includes a constitution hash:

```json
"constitution": {
  "version": "constitution/1.0",
  "hash": "a0ea6fe329251b8c92112fd7518976a031eb8db76433e8c99c77060fc76d7d9d",
  "rules_applied": ["DBL-1","DBL-2","DET-1","EVD-1","INT-1","LVSH-1"]
}
```

**What this means:**

- The rules used to judge responsibility are immutable
- The same transaction will always produce the same judgment
- Any change to rules produces a new constitution hash

**GC question:**

> "Do I accept this constitution as a valid rulebook for evidence?"

If yes, everything below is mechanically enforced.

---

## 4. Integrity Check (1 minute)

Look at:

```json
"integrity": {
  "hash_chain": "VALID",
  "signatures_verified": { "verified": 3, "total": 3 },
  "final_hash_validation": "MATCH" | "MISMATCH" | "UNVERIFIABLE"
}
```

**Interpretation:**

- `hash_chain: VALID` → no transcript tampering
- `signatures_verified == total` → all parties signed their actions
- `final_hash_validation`:
  - `MATCH` → container hash verified (bundle mode)
  - `MISMATCH` → container hash differs from claimed (investigate)
  - `UNVERIFIABLE` → acceptable in transcript-only mode (no bundle material to verify)

**GC rule:**  
If integrity ≠ VALID → transaction is inadmissible

---

## 5. Outcome Summary (30 seconds)

Look at:

```json
"executive_summary": {
  "status": "COMPLETED | FAILED_POLICY | FAILED_PROVIDER_UNREACHABLE | …",
  "money_moved": true | false,
  "final_outcome": "No action required | Refund required | Retry required"
}
```

**This is the legal bottom line.**

---

## 6. Responsibility Judgment (1 minute)

Look at:

```json
"responsibility": {
  "judgment": {
    "fault_domain": "NO_FAULT | BUYER_AT_FAULT | PROVIDER_AT_FAULT",
    "required_next_actor": "NONE | BUYER | PROVIDER",
    "required_action": "NONE | RETRY | REFUND | FIX_POLICY",
    "terminal": true,
    "confidence": 0.85
  }
}
```

**Key guarantees:**

- Exactly one fault domain
- Exactly one required next actor
- Exactly one required action
- Deterministic confidence score

**GC rule:**

If `required_action ≠ NONE`, the system must enforce it before further funds move.

---

## 7. Risk Signal (30 seconds)

```json
"gc_takeaways": {
  "approval_risk": "LOW | MEDIUM | HIGH"
}
```

- **LOW** → approve immediately
- **MEDIUM** → approve with monitoring
- **HIGH** → deny or escalate

This is derived, not opinionated.

---

## 8. When You Say "Yes" (30 seconds)

You are saying:

> "If an agent transacts using Pact and something goes wrong,  
> we will know who is responsible, why, and what must happen next,  
> with cryptographic proof."

**That is the entire approval surface.**

---

## 9. What Happens in Court

Pact provides:

- Immutable transcript
- Deterministic blame logic
- Signed evidence bundle
- Reproducible replay

**Pact does not require trusting Pact Labs.**

---

## Final GC Decision

- ☐ Approved
- ☐ Approved with conditions
- ☐ Rejected

**Constitution hash approved:** _______________________
