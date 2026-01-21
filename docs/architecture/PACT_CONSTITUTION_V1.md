Pact Constitution v1

Version: 1.0
Applies to: pact-transcript/4.0 and Evidence Bundles derived from it
Status: Draft (normative)

0. Purpose

Pact is an evidence-generation and accountability system for autonomous transactions. This Constitution defines the Rules of Evidence that determine (a) what is admissible, (b) what is provable, and (c) who is presumed at fault by default, without subjective interpretation.

Pact's objective is to make autonomous economic activity auditable, insurable, and legally defensible.

1. Definitions

Transcript: A pact-transcript/4.0 JSON artifact containing hash-linked, signed rounds, optional failure events, and optional arbitration artifacts.

Round: A discrete protocol event (e.g., INTENT, ASK, BID, COUNTER, ACCEPT, PROVIDER_REQUEST, etc.) that is signed and hash-linked.

Evidence Bundle: A view-scoped directory artifact (internal/partner/auditor) containing a transcript view and a manifest of cryptographic hashes. Any mutation must be detectable.

Last Valid Signed Hash (LVSH): The most recent round hash in the transcript such that:

the signature is valid for the stated signer and scheme

the hash chain from genesis to that round is intact

Failure Event: A structured terminal or non-terminal failure record with a canonical failure code (PACT-101/202/303/404/505) and evidence references.

Terminal Transcript: A transcript in which the transaction is concluded (committed, failed, aborted, refunded) and no further settlement obligations remain.

Non-terminal Transcript: A transcript in which the transaction is pending or retryable.

Contention: A state where multiple agents (buyers and/or providers) attempt to transact for the same resource, capability, or intent such that not all can be satisfied simultaneously.

2. Admissibility and Integrity
2.1 Admissible Evidence

The following are admissible as Pact Evidence:

A Pact Transcript (pact-transcript/4.0) that verifies under replay:v4

An Evidence Bundle that verifies under evidence:verify

An Arbiter Decision artifact that verifies against its schema and signature rules

2.2 Integrity Requirements (Non-negotiable)

A transcript is admissible only if:

hash chain verification succeeds

required signatures verify

the transcript version is recognized

required schema invariants hold

An evidence bundle is admissible only if:

bundle manifest verification succeeds

transcript view verifies or references a verified transcript

tamper detection is clean

2.3 Evidence Supremacy

If an Evidence Bundle and a Transcript disagree, the Transcript is the authoritative truth and the bundle is considered corrupted unless it verifies.

3. Agent Roles and Obligations
3.1 Buyer Obligations

The Buyer is responsible for:

signing INTENT and any ACCEPT round it issues

enforcing its policy inside the Pact Boundary

ensuring timeouts and limits are correctly represented in policy or boundary config

3.2 Provider Obligations

The Provider is responsible for:

signing any ASK/BID/COUNTER it issues

honoring an accepted offer within the provider's declared SLA window

not issuing conflicting accepts for an exclusive resource (see Contention)

3.3 Settlement Rail Obligations

Settlement rails are responsible for:

providing commit/receipt semantics within declared SLA

producing terminal receipts when funds transfer is finalized

4. Transaction Semantics (Canonical)
4.1 Canonical Deal Lifecycle

A deal progresses through:

INTENT (Buyer signed)

PRICE FORMATION (ASK/BID/COUNTER rounds as applicable)

ACCEPT (Buyer signed)

SETTLEMENT (commit/receipt, possibly async)

TERMINAL RESOLUTION (committed/failed/aborted/refunded)

4.2 Valid Acceptance

An ACCEPT is valid only if:

it references the current offer state (LVSH at the time of accept)

it is signed by Buyer

it is not outside policy constraints

4.3 Time Windows

Timeouts are evaluated as:

Boundary timeouts: enforced by Buyer's boundary, attributable to Buyer unless otherwise proven

Provider SLA windows: enforced by Provider declarations, attributable to Provider if violated after valid acceptance

5. Default Blame Logic v1 (DBL)

DBL assigns default fault deterministically. It does not require humans, inference, or subjective interpretation.

5.1 DBL Inputs

DBL operates on:

the verified transcript

the Failure Event (if present)

LVSH

policy evaluation traces (if present in evidence refs)

settlement receipts (if present)

5.2 DBL Output

DBL outputs:

Default Fault Domain (buyer/provider/rail/protocol)

Default Fault Party (specific agent or component)

Reason Code (PACT-* plus a DBL sub-reason)

Evidence References (LVSH hash, relevant round hashes, policy refs)

5.3 DBL Rules (Priority Order)

DBL applies the first matching rule below:

Rule A: Policy Abort (PACT-101)

If failure code is PACT-101 and the last signed action is Buyer-side:

Default blame: Buyer

Reason: Buyer policy prevented progression

Evidence: policy rule refs + LVSH

Rule B: Identity / Credential failure (PACT-202)

If PACT-202 occurs and the transcript shows provider credential mismatch/expiry at time of evaluation:

Default blame: Provider (or issuer/identity provider if explicitly referenced)

Evidence: credential snapshot hash + issuer refs + LVSH

Rule C: Deadlock (PACT-303)

If negotiation ends without ACCEPT within policy round/time limits:

Default blame: Protocol

Unless one party violated an explicit limit (then blame that party)

Evidence: rounds + limit refs + LVSH

Rule D: Timeout / Non-delivery before ACCEPT (PACT-404)

If PACT-404 occurs before a valid ACCEPT exists:

Default blame: Buyer if the failure is a Buyer boundary timeout OR buyer request timeout

Default blame: Provider if provider failed to respond within its declared quote SLA and that SLA is recorded in the transcript

Evidence: last provider message (if any) + provider SLA + LVSH

Rule E: Timeout / Non-delivery after ACCEPT (PACT-404)

If PACT-404 occurs after a valid ACCEPT exists:

Default blame: Provider if provider fails to deliver within its declared SLA window

Default blame: Settlement rail if delivery completed but settlement receipt fails to confirm

Evidence: ACCEPT hash + delivery refs + settlement refs + LVSH

Rule F: Recursive Link Break (PACT-505)

If PACT-505 occurs and transcript references a downstream dependency (sub-agent transcript hash):

Default blame: Downstream provider by default

The upstream provider remains accountable unless it provided a valid Pact-certified subcontract transcript at accept-time

Evidence: dependency transcript refs + LVSH

5.4 DBL Override

DBL may be overridden only by:

a valid, signed Arbiter Decision artifact that references the transcript hashes and states a final resolution

arbitration must itself be included in an admissible evidence bundle or verified independently

6. Multi-Agent Contention Semantics v1

Contention semantics define how multiple agents transact for the same thing without ambiguity. These are protocol rules, not implementation details.

6.1 Contention Objects

A contention event is identified by a Contention Key:

contention_key = hash(intent_type, resource_id, scope, time_window)

Where:

resource_id may be provider-defined (e.g., "GPU_SLOT_17", "API_QUOTA_BLOCK_2026_01_19_12_00")

scope is either EXCLUSIVE or NON_EXCLUSIVE

time_window is the claim window for exclusivity

6.2 EXCLUSIVE vs NON_EXCLUSIVE
NON_EXCLUSIVE

Provider may fulfill multiple accepts

Multiple buyers may succeed

No contention resolution required

EXCLUSIVE

Provider may fulfill only one accept for the contention_key within the time_window

Any additional accept constitutes a contention violation

6.3 Acceptance Ordering Rule (First-Valid-Accept Wins)

For EXCLUSIVE contention:

The winning transaction is the one with the earliest valid Buyer ACCEPT that:

references the LVSH at acceptance time

is within policy constraints

is signed and hash-linked

Tie-breakers (in order):

earliest ACCEPT timestamp_ms in transcript

lexicographic order of ACCEPT round hash

6.4 Provider Double-Sell Rule

If a provider fulfills two accepts for an EXCLUSIVE contention_key:

Default blame: Provider

Both transcripts remain admissible, but the provider is presumed at fault

Arbitration may determine remediation (refund, partial payment, penalties)

6.5 Buyer Race Rule

If a Buyer issues two ACCEPTs for the same contention_key (EXCLUSIVE):

Default blame: Buyer

The earliest valid accept is binding by default; later accepts are treated as invalid unless explicitly marked as "cancel/replace" (future extension)

6.6 Timeouts Under Contention

If a buyer times out during contention:

DBL applies using LVSH:

if no ACCEPT exists → buyer default blame unless provider SLA breach is proven

if ACCEPT exists → provider default blame if delivery/commit fails

6.7 Evidence Requirements for Contention

An admissible contention transcript must include:

the contention_key (or enough fields to derive it)

the scope (EXCLUSIVE/NON_EXCLUSIVE)

the time_window parameters

the ACCEPT round hash if claiming a win

6.8 Provider Selection Contention Semantics v1

When a buyer evaluates multiple providers (fanout > 1) for the same intent:

**Settlement Exclusivity Rule**: At most one provider may settle per intent. The transcript must record:

the fanout (number of providers evaluated)

all contenders (provider_id, pubkey_b58, endpoint, eligibility status, reject_code if applicable)

the winner (selected provider_id and pubkey_b58)

the decision rule (v1: "order_then_score" tie-break)

**Enforcement**: Any settlement attempt by a non-winner provider is a terminal policy violation (PACT-330: CONTENTION_LOST). The exclusivity guard must abort settlement before commit/reveal/streaming execution.

**Evidence**: The transcript's contention block provides deterministic, replayable proof of which provider was selected and why others were rejected. This enables audit-grade verification of provider selection decisions.

**Backward Compatibility**: For fanout=1 (single seller path), contention tracking is present but enforcement is not required (no contention exists).

7. Canonical Outputs for Non-Technical Stakeholders
7.1 GC / Auditor One-Page Summary (Auditor View)

Auditor evidence bundles must be able to answer, in one page:

What was the agent authorized to do (policy hash + key clauses)?

What did it do (round-by-round narrative)?

Did it comply (fidelity summary)?

What failed (failure code + DBL default blame)?

Can the evidence be verified (bundle verification result)?

8. Non-Goals (v1 Constitution)

This Constitution does not define:

escrow design as a mandatory mechanism

pricing models or marketplace discovery

token economics

L1/L2 rail design

non-deterministic ML arbitration behavior

9. Change Control

Constitution changes are versioned and must:

be backward compatible where possible

not invalidate previously admissible evidence

be accompanied by tests and example bundles demonstrating the new semantics
