# Design Partner Outreach Templates

Templates for engaging GC/legal and insurance partners with the Pact Design Partner Bundle.

---

## Template 1: GC / Head of AI Governance

**Subject:** Pact Protocol — Evidence Standard for Autonomous Agent Transactions

**Body:**

[Name],

Pact is a cryptographic evidence standard that produces verifiable, tamper-resistant records of autonomous agent negotiations and transactions.

We've prepared a Design Partner Bundle for your review that demonstrates three core capabilities:

• **Scenario A (Success):** Audit-ready records with sovereign verification — every completed transaction produces a self-contained evidence bundle that can be independently verified without trusting the vendor
• **Scenario B (Policy Abort):** Guardrails prevent unauthorized spend — policy violations automatically terminate negotiations before any financial commitment, with deterministic fault attribution
• **Scenario C (Tamper Detection):** Cryptographic tamper resistance — sophisticated attacks that pass checksum verification are detected via recompute verification, providing sovereign proof of record integrity

The bundle includes pre-generated auditor packs, verification tools, and compliance documentation. To verify the bundle:

```bash
cd design_partner_bundle
bash verify_all.sh
pact-verifier gc-view --transcript packs/auditor_pack_success.zip
pact-verifier judge-v4 --transcript packs/auditor_pack_success.zip
```

All verification runs offline with no network required. The bundle contains:
- `CONSTITUTION_v1.md` — Rules of evidence and responsibility attribution
- `PACT_COMPLIANCE_CHECKLIST.md` — Vendor evaluation rubric
- `GC_5_MINUTE_APPROVAL_CHECKLIST.md` — Legal approval workflow
- `demo/h5-golden/` — Interactive demonstrations of all three scenarios

I'd appreciate 20 minutes to walk through the bundle and discuss how Pact addresses your governance requirements for autonomous agent deployments.

Best regards,
[Your name]

---

## Template 2: Insurer / Underwriter

**Subject:** Pact Protocol — Underwriting Standard for Autonomous Agent Risk

**Body:**

[Name],

Pact is a cryptographic evidence standard that produces verifiable, tamper-resistant records of autonomous agent negotiations and transactions.

We've prepared a Design Partner Bundle for your review that demonstrates three core capabilities:

• **Scenario A (Success):** Low-risk transactions with NO_FAULT determination — completed negotiations produce audit-ready records suitable for automated approval workflows
• **Scenario B (Policy Abort):** Guardrails prevent unauthorized spend — policy violations automatically terminate before commitment, with clear fault attribution (BUYER_AT_FAULT) and no financial exposure
• **Scenario C (Tamper Detection):** Cryptographic tamper resistance — sophisticated attacks are detected via recompute verification, ensuring evidence remains admissible for claims processing

The bundle includes pre-generated auditor packs, verification tools, and underwriting documentation. To verify the bundle:

```bash
cd design_partner_bundle
bash verify_all.sh
pact-verifier insurer-summary --transcript packs/auditor_pack_success.zip
pact-verifier gc-view --transcript packs/auditor_pack_101.zip
```

All verification runs offline with no network required. The bundle contains:
- `INSURER_UNDERWRITING_VIEW.md` — Underwriting guidelines and risk model
- `PACT_COMPLIANCE_CHECKLIST.md` — Vendor evaluation rubric
- `demo/h5-golden/` — Interactive demonstrations with insurer summaries
- Pre-generated packs showing coverage recommendations (COVERED, COVERED_WITH_SURCHARGE, EXCLUDED)

I'd appreciate 20 minutes to walk through the bundle and discuss how Pact enables risk-based underwriting for autonomous agent transactions.

Best regards,
[Your name]

---

## Bundle Contents Reference

When referencing the bundle, mention these key files:

**For GC/Legal:**
- `CONSTITUTION_v1.md` — Rules of evidence
- `PACT_COMPLIANCE_CHECKLIST.md` — Vendor evaluation rubric
- `GC_5_MINUTE_APPROVAL_CHECKLIST.md` — Legal approval workflow
- `demo/h5-golden/` — Interactive demonstrations

**For Insurers:**
- `INSURER_UNDERWRITING_VIEW.md` — Underwriting guidelines
- `PACT_COMPLIANCE_CHECKLIST.md` — Vendor evaluation rubric
- `demo/h5-golden/` — Scenarios with insurer summaries
- `packs/` — Pre-generated auditor packs

**Common:**
- `verify_all.sh` — Automated verification script
- `README.md` — Bundle overview and quick start
