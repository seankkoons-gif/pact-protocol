Pact Constitution v1

Rules of Evidence & Responsibility for Autonomous Agent Transactions

Version: constitution/1.0
Status: Canonical
Applies to: Pact transcripts v4.x, Evidence Bundles, GC View v1.0

1. Purpose

This Constitution defines the rules of evidence, verification, and responsibility attribution for transactions executed within the Pact protocol.

Its purpose is to ensure that any Pact-mediated transaction can be:

Deterministically replayed

Independently verified

Audited by non-technical reviewers

Used as admissible operational evidence by legal, compliance, insurance, and regulatory stakeholders

This document governs how Pact interprets transcripts, evidence, failures, and fault.

2. Canonical Artifacts

The following artifacts are considered canonical inputs to verification:

Transcript (v4)
A signed, ordered record of negotiation and execution rounds.

Evidence Bundle (optional)
A structured collection of trusted and claimed evidence associated with a transcript.

DBL Judgment (v1)
A deterministic fault attribution output derived from the transcript and evidence.

Passport State (v1)
A replayable reputation state derived exclusively from verified transcripts and DBL outcomes.

All conclusions MUST be derivable from these artifacts alone.

3. Determinism Rule

Rule ID: DET-1

All Pact verification outputs MUST be deterministic.

No wall-clock time

No randomness

No external network calls

No mutable global state

Given identical inputs, all compliant verifiers MUST produce identical outputs byte-for-byte.

Violation of this rule invalidates the output.

4. Transcript Integrity Rules
4.1 Hash Chain Integrity

Rule ID: INT-1

Each transcript round includes a cryptographic hash that commits to:

its content

the hash of the prior round

If all round hashes link correctly, the hash chain is VALID.

If any link fails, the transcript integrity is INVALID.

4.2 Signature Verification

Rule ID: INT-2

Each transcript round MUST be signed by the actor who authored it.

Signatures are verified using the signer's public key embedded in the transcript.

A transcript is cryptographically verified if all signatures verify.

Signature verification status is reported as:

VERIFIED (all signatures valid)

PARTIAL (some signatures valid)

FAILED (no valid signatures)

Hash chain validity and signature validity are reported independently.

4.3 Final / Container Hash Validation

Rule ID: INT-3

Some execution environments may provide a "final" or "container" hash representing an enclosing system state.

Final hash validation is tri-state:

MATCH — recomputable and matches

MISMATCH — recomputable but differs

UNVERIFIABLE — insufficient data to recompute (e.g. transcript-only mode)

A final hash marked UNVERIFIABLE does not imply tampering and does not invalidate the transcript if Rules INT-1 and INT-2 pass.

5. Evidence Classification Rules
5.1 Trusted Evidence

Rule ID: EVD-1

Trusted evidence includes:

Signed transcript rounds

Verifier-generated artifacts

Deterministic replay outputs

Trusted evidence MAY be used to establish integrity, causality, and responsibility.

5.2 Claimed Evidence

Rule ID: EVD-2

Claimed evidence includes:

Counterparty assertions

External references

Unsigned artifacts

Claimed evidence:

MUST be clearly labeled as CLAIMED

MUST NOT be used to invalidate transcript integrity

MAY raise audit questions or affect fault attribution

A mismatch between claimed evidence and trusted evidence does not imply transcript tampering.

6. Last Valid Signed Hash (LVSH)

Rule ID: LVSH-1

The Last Valid Signed Hash (LVSH) is defined as the hash of the final transcript round that:

is correctly hash-linked

is cryptographically signed

passes integrity checks

LVSH represents the last provable shared state between parties.

All fault attribution, rollback, and responsibility analysis anchors to the LVSH.

7. Failure Classification

Failures are classified by taxonomy codes (PACT-xxx) and by failure stage:

NEGOTIATION

POLICY

SETTLEMENT

INTEGRITY

Examples:

PACT-101 — Policy violation

PACT-404 — Settlement timeout

Failure codes are reported but do not, by themselves, assign fault.

8. Default Blame Logic (DBL)

Rule ID: DBL-1

Fault attribution is determined by the Default Blame Logic (DBL), which:

Anchors analysis at the LVSH

Identifies the failure stage

Determines the actor who failed to perform a required action

Assigns a fault domain and confidence score

Possible fault domains include:

NO_FAULT

BUYER_AT_FAULT

PROVIDER_AT_FAULT

SHARED_FAULT

INDETERMINATE

DBL outputs are deterministic and replayable.

9. Required Next Actor

Rule ID: DBL-2

For any non-successful outcome, DBL MUST specify a Required Next Actor, indicating which party must act to remediate or continue execution.

This field is used for:

operational resolution

dispute workflows

automated retries

responsibility traceability

10. Passport & Reputation Rule

Rule ID: PAS-1

Passport (reputation) state:

MUST be computed solely from verified transcripts and DBL judgments

MUST be replayable from source artifacts

MUST NOT use time decay or external signals

Passport scores may influence policy gating but do not affect transcript validity.

11. GC View Interpretation Rule

Rule ID: GC-1

The GC View is a summary artifact, not a new source of truth.

It MUST:

faithfully reflect transcript, evidence, and DBL outputs

clearly distinguish VERIFIED facts from CLAIMED assertions

avoid language implying tampering unless integrity is actually invalid

Approval risk levels (LOW, MEDIUM, HIGH) are advisory and derived deterministically from the above rules.

12. Versioning & Amendments

Any change to these rules requires a new Constitution version.

The Constitution version and hash MUST be embedded in verifier outputs.

Outputs MUST declare which Constitution version was applied.

13. Compliance Statement

Any verifier that:

follows these rules

produces deterministic outputs

emits evidence consistent with this Constitution

is considered Pact-compliant.
