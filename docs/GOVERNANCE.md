# GOVERNANCE.md

This document describes how the PACT protocol and its reference implementations are governed.

PACT prioritizes **clarity, stability, and correctness** over rapid or adversarial governance mechanisms. Governance is intentionally lightweight and conservative.

---

## Scope of Governance

Governance applies to:

- Protocol semantics
- Message formats and schemas
- Settlement rules
- Deterministic execution guarantees
- Reference implementations (`@pact/sdk`, `@pact/provider-adapter`)

Governance does **not** apply to:
- Individual deployments
- Application-layer policies
- Economic terms negotiated via the protocol
- Off-protocol coordination between agents

---

## Guiding Principles

Governance decisions are guided by the following principles:

1. **Determinism over flexibility**  
   Changes must not introduce ambiguity or divergent interpretations.

2. **Backward compatibility by default**  
   Breaking changes are rare, explicit, and versioned.

3. **Explicit over implicit behavior**  
   Any change that alters outcomes must be visible and documented.

4. **Protocol stability over feature velocity**  
   PACT is infrastructure, not an experiment.

---

## Decision Authority

At this stage, governance is **maintainer-led**.

Core maintainers are responsible for:
- Approving protocol changes
- Publishing new versions
- Resolving disputes about intended behavior
- Accepting or rejecting contributions

This model may evolve, but only through explicit documentation and versioned changes.

---

## Change Process

### Minor Changes
Examples:
- Bug fixes
- Clarifications
- Performance improvements
- Additional tests

Process:
- Pull request
- Maintainer review
- Merge after approval

---

### Protocol Changes
Examples:
- Message format changes
- Settlement logic changes
- New failure modes
- Changes affecting determinism

Process:
1. Written proposal (issue or PR description)
2. Explicit rationale
3. Compatibility analysis
4. Versioned release

Silent protocol changes are not permitted.

---

## Versioning Policy

PACT follows **semantic versioning** with additional discipline:

- **PATCH**: Bug fixes only
- **MINOR**: Backward-compatible extensions
- **MAJOR**: Breaking protocol changes

Major versions may introduce new schemas or deprecate old behavior, but never silently.

---

## Forking and Derivatives

PACT is open source and may be forked.

However:
- Forks must not claim compatibility unless they fully adhere to the protocol
- Divergent behavior should be clearly labeled
- Reputation and receipts are not transferable across incompatible forks

---

## Dispute Resolution

If there is disagreement about protocol behavior:

1. The written specification and schema take precedence
2. Deterministic test cases are authoritative
3. Maintainers make the final call

Ambiguity is treated as a bug.

---

## Governance Philosophy

PACT is governed like infrastructure, not a social network.

Governance exists to:
- Preserve correctness
- Prevent fragmentation
- Maintain trust in outcomes

Not to:
- Optimize for popularity
- Enable politics
- Chase trends

---

## Changes to Governance

Changes to this document require:
- Maintainer approval
- Clear justification
- Documentation in the changelog

Governance itself is versioned.
