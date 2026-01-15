# PACT v2 Non-Goals

## Introduction

This document explicitly states what v2 will **not** do. Non-goals are as important as goals: they prevent scope creep, clarify boundaries, and help integrators understand what to expect (and what not to expect) from v2.

---

## Non-Goal 1: Backward Compatibility with v1 APIs

**What we're not doing:** v2 will not maintain backward compatibility with v1's API surface, function signatures, or data formats.

**Why:** v2 is an architecture reset. Maintaining v1 compatibility would force v2 to carry forward v1's design limitations (stateless transactions, two-party model, static policies). v1 is frozen at v1.7.0-rc6 and will remain stable for integrators who need it. v2 is a new codebase with new APIs.

**What this means:** Integrators using v1 APIs will need to migrate to v2 APIs. Migration guides will be provided, but there is no drop-in replacement.

---

## Non-Goal 2: Frontend / UI Work

**What we're not doing:** v2 will not include web UIs, dashboards, admin panels, or any frontend components.

**Why:** PACT is a protocol and runtime, not an application. Frontend work belongs to integrators who build on top of PACT. v2 focuses on core protocol, runtime, and API ergonomics.

**What this means:** Integrators who need UIs will build them themselves or use third-party tools. v2 may provide CLI tools for debugging and operations, but no web interfaces.

---

## Non-Goal 3: Chain-Specific Commitments

**What we're not doing:** v2 will not make commitments to specific blockchains, L1s, L2s, or chain-specific features.

**Why:** PACT is payment-rail agnostic. v2's settlement interface is pluggable, allowing integrators to implement on-chain settlements via the extension point. Making chain-specific commitments would fragment the ecosystem and limit adoption.

**What this means:** v2 will not include built-in support for Ethereum, Solana, or any other chain. Integrators can implement chain-specific settlements via the `SettlementProvider` interface. v2 may provide example implementations, but no first-class chain support.

---

## Non-Goal 4: Premature Standardization / Governance

**What we're not doing:** v2 will not establish formal standards bodies, governance processes, or multi-stakeholder decision-making structures.

**Why:** v2 is still in the design phase. Standardization and governance are premature until the architecture is proven, the API surface is stable, and there is a clear need for multi-stakeholder coordination. v1's protocol is documented, but v2 will evolve based on implementation experience.

**What this means:** v2 design decisions will be made by the core team based on technical merit and integrator feedback. Formal governance may emerge later if needed, but not in v2.

---

## Non-Goal 5: "Pact L1/L2" Decisions

**What we're not doing:** v2 will not make decisions about whether PACT should run on its own blockchain, L2, or shared sequencer.

**Why:** This is a massive architectural decision that requires extensive research, economic modeling, and ecosystem analysis. v2 focuses on protocol and runtime design. Infrastructure decisions (L1/L2) are out of scope.

**What this means:** v2 will work with any settlement backend (on-chain, off-chain, hybrid). Infrastructure decisions are deferred to future versions or ecosystem projects.

---

## Non-Goal 6: Refactors in v1 Branch

**What we're not doing:** v1 branch will not receive architectural refactors, new features, or breaking changes.

**Why:** v1 is frozen at v1.7.0-rc6. v1 will only receive critical bug fixes and security patches. All new development happens in v2.

**What this means:** Integrators who need new features should migrate to v2. v1 remains stable for those who need it, but will not evolve.

---

## Non-Goal 7: Built-in Marketplace / Discovery Service

**What we're not doing:** v2 will not include a built-in marketplace, provider discovery service, or centralized directory.

**Why:** Discovery and marketplace logic are application-layer concerns. v2 provides the protocol and runtime; integrators build marketplaces on top. v2 may provide example directory implementations (like v1's `JsonlProviderDirectory`), but no production marketplace.

**What this means:** Integrators who need marketplaces will build them or use third-party services. v2's directory interface is pluggable, allowing custom discovery implementations.

---

## Non-Goal 8: Native Multi-Currency / Cross-Chain Settlement

**What we're not doing:** v2 will not include built-in support for multi-currency settlements, cross-chain atomic swaps, or currency conversion.

**Why:** Currency handling is a settlement concern. v2's settlement interface is pluggable, allowing integrators to implement multi-currency logic. Building this into the core would add complexity and limit flexibility.

**What this means:** Integrators can implement multi-currency settlements via custom `SettlementProvider` implementations. v2 may provide examples, but no first-class multi-currency support.

---

## Non-Goal 9: Built-in ML / AI Agent Logic

**What we're not doing:** v2 will not include machine learning models, AI agent reasoning, or LLM integration.

**Why:** PACT is a protocol and runtime, not an AI framework. Agent logic (how agents make decisions, how they reason about policies, how they negotiate) is implemented by integrators. v2 provides the deterministic execution environment; integrators bring the intelligence.

**What this means:** Integrators can use ML/AI in their agent implementations, but v2 will not include ML models or AI primitives. v2's determinism guarantees require that agent logic be deterministic (or that non-deterministic logic is isolated to non-critical paths).

---

## Non-Goal 10: Real-Time Streaming / WebSocket Protocol

**What we're not doing:** v2 will not define a real-time streaming protocol (e.g., WebSocket, SSE) for negotiation or settlement events.

**Why:** v2's transcript streams are append-only event logs. How those events are transported (HTTP polling, WebSocket, file tailing) is an implementation detail. v2 defines the event format and ordering; transport is left to integrators.

**What this means:** Integrators can implement real-time streaming via custom transport layers. v2 may provide example implementations, but no first-class streaming protocol.

---

## What Stays Stable

Despite the architecture reset, v2 preserves v1's core values:

### Determinism

v2 maintains v1's determinism guarantees: given the same inputs, agents produce the same outputs. This is non-negotiable. v2's new features (concurrency, long-lived sessions, multi-party negotiations) are designed to be deterministic.

### Replayability

v2's transcript streams enable replay, just like v1's transcripts. Replay is incremental (via checkpoints) but the principle remains: any transaction can be replayed to verify correctness.

### Explicit Failure Modes

v2 maintains v1's explicit error codes and failure modes. Agents know why transactions failed, what recovery options exist, and how to handle partial failures.

### Auditability

v2's transcripts are auditable, just like v1's. Transcripts include all negotiation steps, settlement attempts, and outcomes. The format changes (event streams vs. JSON files), but auditability remains.

### Payment-Rail Agnosticism

v2 remains payment-rail agnostic. Settlement is pluggable, allowing integrators to use any payment backend (on-chain, off-chain, hybrid).

### Protocol Semantics

v2's core protocol semantics (intent declaration, negotiation, commitment, settlement) remain similar to v1's, even if the API surface and implementation differ.

---

## Summary

v2's non-goals clarify boundaries: no v1 compatibility, no frontend work, no chain commitments, no premature governance, no infrastructure decisions, no v1 refactors, no built-in marketplaces, no native multi-currency, no ML/AI primitives, no streaming protocol.

What stays stable: determinism, replayability, explicit failure modes, auditability, payment-rail agnosticism, and core protocol semantics.

v2 is a protocol and runtime, not an application, infrastructure, or AI framework. Integrators build on top of v2 to create applications, marketplaces, and agent ecosystems.



