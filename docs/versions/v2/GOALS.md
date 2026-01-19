# PACT v2 Goals

## Introduction

PACT v1 is frozen at v1.7.0-rc6 with a stable API surface and backward-compatibility guarantees. v2 represents an architecture reset, designed to address fundamental limitations in v1's design while preserving core protocol values: determinism, auditability, and explicit failure modes.

v2 is not an incremental evolution of v1. It is a reimagining of how agents negotiate, execute, and settle transactions in a multi-party, long-lived, and extensible system.

---

## Goal 1: Agent Runtime Primitive / Long-Lived Sessions

**Outcome:** Agents operate as persistent runtime entities with long-lived negotiation sessions that span multiple transactions, maintain state across interactions, and support incremental commitment.

**Why it matters:**

v1 treats each `acquire()` call as a stateless, atomic transaction. This works for simple one-shot exchanges but breaks down when:
- Agents need to maintain relationships across multiple transactions
- Negotiations require multiple rounds of back-and-forth
- State must persist between interactions (e.g., ongoing service subscriptions, multi-step workflows)
- Agents need to reason about historical context when making decisions

v1's stateless model forces integrators to manually manage session state, relationship tracking, and cross-transaction context, leading to brittle integrations and lost opportunities for optimization.

**What success looks like:**

- Agents have persistent identities and session handles that survive process restarts
- Negotiations can span multiple API calls with explicit session continuation
- Session state (quotes, commitments, partial settlements) is queryable and replayable
- Integrators can implement long-running workflows (e.g., subscription services, multi-phase projects) without manual state management
- Session lifecycle is explicit: create, resume, suspend, terminate
- Sessions support checkpointing for crash recovery and audit trails

---

## Goal 2: Policy as Executable Logic Surface

**Outcome:** Policies are not static JSON configurations but executable, composable logic that agents can reason about, modify dynamically, and verify at runtime.

**Why it matters:**

v1 policies are declarative JSON schemas (`createDefaultPolicy()`). This limits:
- Dynamic policy adaptation based on market conditions, reputation changes, or agent preferences
- Complex conditional logic (e.g., "require SLA credential if price > X, otherwise allow unverified")
- Policy composition and inheritance (e.g., base policy + domain-specific overrides)
- Runtime policy verification and explanation ("why was this policy applied?")
- Agent-to-agent policy negotiation ("I can accept your policy if you modify constraint Y")

Static policies force integrators to pre-compute all possible scenarios, leading to either overly permissive policies (security risk) or overly restrictive ones (reduced match rate).

**What success looks like:**

- Policies are expressed as executable code (e.g., WASM modules, DSL, or typed functions)
- Policies can be composed, inherited, and dynamically modified
- Policy evaluation is deterministic and auditable (inputs → outputs are traceable)
- Agents can negotiate policy terms ("I'll accept your policy if you lower the trust tier requirement")
- Policy logic is testable, versionable, and can be shared between agents
- Policy violations produce clear explanations with execution traces

---

## Goal 3: Multi-Party Negotiations / Graph Interactions

**Outcome:** Negotiations involve multiple agents in graph-structured interactions, not just buyer-seller pairs. Agents can form coalitions, delegate, and participate in multi-hop transactions.

**Why it matters:**

v1 is fundamentally a two-party protocol (buyer ↔ seller). Real-world agent ecosystems require:
- Multi-provider aggregation (e.g., "I need weather data from 3 providers and combine them")
- Delegation chains (e.g., "Agent A delegates to Agent B, who delegates to Agent C")
- Coalition formation (e.g., "Agents X, Y, Z form a coalition to fulfill a complex intent")
- Multi-hop settlements (e.g., "Payment flows through intermediaries with escrow at each hop")
- Graph-structured negotiations (e.g., "Agent A negotiates with B and C simultaneously, then coordinates their outputs")

v1's two-party model forces integrators to manually orchestrate multi-party scenarios, leading to complex coordination logic, lost atomicity guarantees, and increased failure modes.

**What success looks like:**

- Negotiations can involve N agents (not just 2) with explicit graph topology
- Agents can form sub-graphs (coalitions, delegations) with their own negotiation rules
- Multi-party settlements are atomic: all parties commit or all abort
- Graph interactions are deterministic and replayable (graph structure is part of transcript)
- Integrators can express complex intents that require multiple providers without manual orchestration
- Failure modes are explicit: which agents failed, which sub-graphs are affected, what recovery options exist

---

## Goal 4: Transcript Streams (Append-Only Event Log) + Replay Checkpoints

**Outcome:** Transcripts are not static JSON files but append-only event streams with explicit checkpoints, enabling incremental replay, state reconstruction, and audit trail verification.

**Why it matters:**

v1 transcripts are monolithic JSON files written at transaction completion. This limits:
- Incremental state reconstruction (e.g., "replay from checkpoint X to checkpoint Y")
- Real-time audit trail verification (e.g., "verify transcript as events arrive")
- Crash recovery (e.g., "agent crashed at event 42, resume from checkpoint 40")
- Partial replay for debugging (e.g., "replay only settlement phase, skip negotiation")
- Transcript streaming for long-running sessions (e.g., "stream transcript events as they occur")

Monolithic transcripts force integrators to replay entire transactions even when only a subset of events are relevant, leading to slow verification, poor debugging ergonomics, and limited recovery options.

**What success looks like:**

- Transcripts are append-only event streams (not single JSON files)
- Events are immutable, ordered, and hash-linked (event N includes hash of event N-1)
- Checkpoints are explicit: agents can create checkpoints at any point (e.g., after negotiation, after settlement)
- Replay is incremental: "replay from checkpoint X" only processes events after X
- Transcript streams can be consumed in real-time (e.g., WebSocket, SSE, or file tailing)
- State reconstruction is efficient: "reconstruct agent state at checkpoint Y" without replaying from start
- Transcript verification is parallelizable: verify events in batches, verify checkpoints independently

---

## Goal 5: Extensibility Boundaries (Pluggable Settlement, Reputation, Negotiation)

**Outcome:** Core protocol defines clear extension points for settlement, reputation, and negotiation logic. Integrators can plug in custom implementations without modifying core code.

**Why it matters:**

v1 has hardcoded settlement providers (`MockSettlementProvider`, `StripeLikeSettlementProvider`), reputation algorithms (`agentScore`, `priceStats`), and negotiation flows (fixed INTENT → QUOTE → ACCEPT → COMMIT → REVEAL sequence). This forces integrators to:
- Fork the codebase to add custom settlement logic
- Work around reputation algorithms that don't fit their use case
- Accept negotiation flows that don't match their domain requirements

Hardcoded implementations limit adoption in domains with unique requirements (e.g., on-chain settlements, custom reputation models, domain-specific negotiation protocols).

**What success looks like:**

- Settlement is a pluggable interface: integrators implement `SettlementProvider` with custom logic (e.g., on-chain smart contracts, payment processors, escrow services)
- Reputation is a pluggable interface: integrators implement `ReputationProvider` with custom algorithms (e.g., on-chain reputation, centralized scoring, ML-based models)
- Negotiation flow is extensible: core protocol defines phases (e.g., DISCOVERY, NEGOTIATE, COMMIT, SETTLE) but allows custom phase implementations
- Extension points are typed, documented, and have clear contracts (e.g., "SettlementProvider must implement these methods with these guarantees")
- Core protocol remains deterministic even with custom extensions (extensions must be deterministic and auditable)
- Extensions are composable: integrators can mix and match (e.g., on-chain settlement + centralized reputation)

---

## Goal 6: Production-Grade Ergonomics for Integrators

**Outcome:** Integrators have clear contracts, typed APIs, comprehensive error handling, and tooling that makes PACT easy to integrate, debug, and operate in production.

**Why it matters:**

v1's API surface, while stable, has ergonomic gaps:
- Error handling is ad-hoc (some functions return `{ ok: boolean }`, others throw)
- Type safety is incomplete (many `any` types, loose type boundaries)
- Debugging is difficult (limited observability, unclear failure modes)
- Integration patterns are unclear (e.g., "how do I handle retries?", "how do I monitor sessions?")
- Tooling is minimal (no CLI for common operations, no IDE support)

Poor ergonomics increase integration time, production incidents, and maintenance burden.

**What success looks like:**

- All APIs are fully typed with no `any` types (TypeScript strict mode)
- Error handling is consistent: all functions return `Result<T, E>` or throw typed exceptions
- Contracts are explicit: "this function guarantees X, requires Y, may fail with Z"
- Observability is built-in: structured logging, metrics, tracing hooks
- Debugging tools exist: CLI for transcript inspection, session state queries, replay debugging
- Integration patterns are documented: "how to handle retries", "how to monitor sessions", "how to handle partial failures"
- IDE support: type hints, autocomplete, inline documentation
- Testing utilities: mock providers, test fixtures, scenario generators

---

## Goal 7: Deterministic Execution Model with Explicit Concurrency

**Outcome:** v2 maintains v1's determinism guarantees while supporting explicit concurrency primitives (e.g., parallel negotiations, concurrent settlements) with deterministic ordering.

**Why it matters:**

v1 is single-threaded and sequential: one negotiation at a time, one settlement at a time. This limits:
- Parallel provider discovery (e.g., "query 10 providers simultaneously")
- Concurrent settlement execution (e.g., "settle 5 transactions in parallel")
- Multi-party coordination (e.g., "wait for 3 providers to commit before proceeding")

Sequential execution is safe but slow. Integrators need parallelism for performance, but v1's model doesn't provide deterministic concurrency primitives.

**What success looks like:**

- Concurrency is explicit: integrators declare parallel operations (e.g., "negotiate with providers A, B, C in parallel")
- Deterministic ordering: parallel operations have deterministic merge semantics (e.g., "merge results by provider ID, then by timestamp")
- Concurrency is auditable: transcript includes concurrency metadata (e.g., "these 3 negotiations ran in parallel, merged at checkpoint X")
- Core protocol guarantees: "if two agents run the same parallel operation with the same inputs, they produce the same merged result"
- Integrators can opt into parallelism without sacrificing determinism or auditability

---

## Summary

v2's goals are interconnected: long-lived sessions enable multi-party negotiations; executable policies enable dynamic adaptation; transcript streams enable incremental replay; extensibility enables domain-specific implementations; production ergonomics enable adoption; deterministic concurrency enables performance.

Together, these goals transform PACT from a transaction protocol into an agent runtime: a platform where agents can form persistent relationships, negotiate complex terms, coordinate multi-party interactions, and settle transactions—all with determinism, auditability, and extensibility.



