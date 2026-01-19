# PACT v2 Architecture Reset

## Summary

PACT v1 shipped at v1.7.0-rc6 and is frozen with a stable API surface. v2 resets the core abstraction: instead of `acquire(intent) -> receipt` as a stateless function call, v2 introduces a persistent runtime where agents maintain long-lived sessions, negotiate over multiple rounds, and coordinate multi-party interactions. The runtime manages session state, transcript streams, and settlement graphs, while agents interact through typed APIs that preserve v1's core invariants (determinism, replayability, explicit failure modes, auditability).

---

## What v1 Proved

v1's implementation validated several core design decisions:

- **Deterministic negotiation**: Given the same inputs (intent, policy, directory), agents select the same provider and produce the same receipt. This enables reproducible testing and audit trails.

- **Verifiable settlement**: Settlement operations (commit, reveal, streaming) are deterministic and auditable. Settlement providers implement a clear interface with explicit state transitions.

- **Transcript truth**: Transcripts capture the complete negotiation and settlement history. Replay verification catches protocol violations and implementation bugs.

- **Disputes**: Dispute resolution with signed decisions provides a mechanism for handling settlement failures and policy violations.

- **Replay**: Transcript replay enables post-hoc verification, debugging, and audit trail validation.

- **Distribution**: The protocol is payment-rail agnostic. Settlement providers are pluggable, allowing integration with any payment backend.

These properties are non-negotiable in v2. The architecture reset changes how agents interact with the protocol, not what the protocol guarantees.

---

## Core Shift

### From: `acquire(intent) -> receipt`

v1's model is a stateless function call:
- Buyer calls `acquire()` with an intent
- SDK discovers providers, negotiates, settles
- Returns a receipt (or failure)
- No persistent state between calls
- Each transaction is atomic and isolated

### To: `Agent <-> Pact Runtime <-> Agent`

v2's model is a persistent runtime with agent sessions:
- Agents connect to a Pact Runtime (in-process or remote)
- Runtime maintains session state, transcript streams, and settlement graphs
- Agents interact through session handles, not direct function calls
- Sessions persist across process restarts (checkpointed state)
- Multiple agents can participate in the same negotiation (multi-party)
- Negotiations can span multiple API calls (long-lived sessions)
- Runtime coordinates agent interactions and enforces protocol invariants

**Why this shift matters:**

- **State management**: v1 forces integrators to manually manage state (which providers were queried, which quotes were received, which settlements are pending). v2's runtime manages this state explicitly.

- **Multi-party coordination**: v1's two-party model requires manual orchestration for multi-provider scenarios. v2's runtime coordinates multiple agents in graph-structured negotiations.

- **Long-lived workflows**: v1's atomic transactions don't fit subscription services, multi-phase projects, or ongoing relationships. v2's sessions enable these patterns.

- **Concurrency**: v1 is sequential (one negotiation at a time). v2's runtime supports explicit concurrency with deterministic ordering.

- **Extensibility**: v1's hardcoded settlement and reputation logic limits adoption. v2's runtime provides clear extension points for custom implementations.

- **Observability**: v1's transcripts are written at completion. v2's transcript streams enable real-time monitoring and incremental verification.

- **Recovery**: v1 has no crash recovery mechanism. v2's checkpointed sessions enable recovery from failures.

- **Protocol enforcement**: v1's SDK enforces protocol rules in library code. v2's runtime enforces protocol rules as a separate process/service, enabling centralized policy enforcement and audit.

---

## New Primitives

### AgentRuntime

The core runtime that manages agent sessions, transcript streams, and settlement graphs.

**API shape hints:**
```typescript
interface AgentRuntime {
  createSession(agentId: string, config: SessionConfig): Promise<SessionHandle>;
  resumeSession(sessionId: string): Promise<SessionHandle>;
  getSessionState(sessionId: string): Promise<SessionState>;
  checkpoint(sessionId: string): Promise<CheckpointId>;
  closeSession(sessionId: string): Promise<void>;
}
```

The runtime is the single source of truth for session state, transcript events, and protocol enforcement. It can run in-process (library mode) or as a separate service (runtime mode).

### NegotiationSession

A persistent session that spans multiple API calls and maintains negotiation state.

**API shape hints:**
```typescript
interface NegotiationSession {
  sessionId: string;
  agentId: string;
  intent: Intent;
  state: "discovering" | "negotiating" | "committed" | "settling" | "completed" | "failed";
  
  discoverProviders(options: DiscoveryOptions): Promise<Provider[]>;
  requestQuotes(providers: Provider[]): Promise<Quote[]>;
  acceptQuote(quoteId: string): Promise<Commitment>;
  continueNegotiation(round: NegotiationRound): Promise<NegotiationResult>;
  checkpoint(): Promise<CheckpointId>;
}
```

Sessions are long-lived: they can be suspended, resumed, and checkpointed. Multiple agents can participate in the same session (multi-party negotiations).

### SettlementGraph

A graph-structured representation of multi-party settlements, where nodes are agents and edges are settlement commitments.

**API shape hints:**
```typescript
interface SettlementGraph {
  graphId: string;
  nodes: AgentNode[];
  edges: SettlementEdge[];
  state: "prepared" | "committing" | "committed" | "failed";
  
  addNode(agent: Agent): Promise<NodeId>;
  addEdge(from: NodeId, to: NodeId, commitment: Commitment): Promise<EdgeId>;
  commitGraph(): Promise<SettlementResult>;
  getGraphState(): Promise<GraphState>;
}
```

Settlements can involve multiple agents (not just buyer-seller pairs). The graph structure enables multi-hop payments, delegation chains, and coalition settlements.

### TranscriptStream

An append-only event log with explicit checkpoints, enabling incremental replay and state reconstruction.

**API shape hints:**
```typescript
interface TranscriptStream {
  streamId: string;
  events: Event[];
  checkpoints: Checkpoint[];
  
  append(event: Event): Promise<EventId>;
  createCheckpoint(): Promise<CheckpointId>;
  replay(fromCheckpoint?: CheckpointId): Promise<ReplayResult>;
  getStateAtCheckpoint(checkpointId: CheckpointId): Promise<State>;
  verify(events: Event[]): Promise<VerificationResult>;
}
```

Transcripts are event streams, not monolithic JSON files. Events are immutable, ordered, and hash-linked. Checkpoints enable efficient replay and state reconstruction.

### PolicyEngineV2

An executable policy evaluation engine that supports dynamic, composable policy logic.

**API shape hints:**
```typescript
interface PolicyEngineV2 {
  evaluate(policy: Policy, context: EvaluationContext): Promise<EvaluationResult>;
  compose(policies: Policy[]): Promise<Policy>;
  explain(result: EvaluationResult): Promise<Explanation>;
  verify(policy: Policy, execution: PolicyExecution): Promise<VerificationResult>;
}

interface Policy {
  code: PolicyCode; // WASM, DSL, or typed function
  version: string;
  metadata: PolicyMetadata;
}
```

Policies are executable code (not static JSON). They can be composed, inherited, and dynamically modified. Policy evaluation is deterministic and auditable.

---

## Boundary Rules

### Invariants (Must Remain True)

These properties are non-negotiable. v2's architecture must preserve them:

- **Determinism**: Given the same inputs (session state, events, policies), the runtime produces the same outputs. This enables reproducible testing, audit trails, and protocol verification.

- **Replayability**: Any session can be replayed from its transcript stream. Replay produces the same state transitions and outcomes as the original execution.

- **Explicit failure modes**: All failures have explicit error codes and reasons. Agents know why operations failed and what recovery options exist.

- **Auditability**: All protocol operations are recorded in transcript streams. Transcripts are immutable, ordered, and verifiable.

- **Payment-rail agnosticism**: Settlement is pluggable. The protocol does not commit to specific payment backends.

- **Protocol semantics**: Core protocol concepts (intent, negotiation, commitment, settlement) remain, even if the API surface changes.

### What Can Change

These aspects can evolve in v2 without breaking core invariants:

- **APIs**: Function signatures, return types, and parameter structures can change. v2 is not backward-compatible with v1 APIs.

- **Formats**: Data formats (JSON schemas, event formats, checkpoint formats) can change. Migration tools will be provided.

- **Flow shape**: The sequence of operations (discovery → negotiation → settlement) can be extended, reordered, or made concurrent. The core semantics remain.

- **Control boundaries**: What runs in-process vs. out-of-process, what is synchronous vs. asynchronous, what is local vs. remote—these can change.

- **Extension points**: The interfaces for settlement, reputation, and negotiation can evolve. Integrators implement these interfaces; changes require migration.

- **Performance characteristics**: Latency, throughput, and resource usage can change. Determinism and replayability are preserved.

---

## First Slice

The minimal v2 implementation that proves the architecture:

### Components

1. **Minimal Runtime**: In-process runtime that manages a single session type (two-party negotiation). No multi-party, no graph settlements, no concurrency. Just: create session, negotiate, settle, close session.

2. **Transcript Stream**: Append-only event log with basic checkpointing. Events are JSON objects with type, timestamp, and hash. Checkpoints enable replay from a specific point.

3. **One Session Type**: Two-party negotiation session (buyer-seller). No multi-party, no delegation, no coalitions. Just the minimal case that proves sessions work.

### What This Proves

- Sessions persist state across API calls
- Transcript streams enable incremental replay
- Runtime enforces protocol invariants
- Checkpointing enables crash recovery

### What's Deferred

- Multi-party negotiations
- Settlement graphs
- Policy engine v2 (use static policies for first slice)
- Concurrency primitives
- Remote runtime mode
- Advanced checkpointing (just basic checkpoint-at-negotiation-complete)

### Success Criteria

- Create a session, negotiate with one provider, settle, close session
- Replay session from transcript stream
- Resume session from checkpoint after crash
- Verify transcript stream integrity

This first slice is the minimal viable architecture reset. Once proven, we can add multi-party, graphs, policies, and concurrency.

---

## Implementation Notes

- **Language**: v2 will likely be TypeScript/JavaScript (like v1) for consistency, but the architecture is language-agnostic.

- **Storage**: Session state and transcript streams need persistent storage. First slice can use in-memory storage; production will need pluggable storage backends.

- **Transport**: Agents communicate with runtime via typed APIs. First slice is in-process; remote mode (HTTP, WebSocket) is deferred.

- **Testing**: First slice must pass the same determinism and replayability tests as v1. New tests for session persistence and checkpoint recovery.

- **Migration**: v1 integrators will need migration guides. No automated migration; APIs are too different.

---

## Summary

v2 resets the core abstraction from stateless function calls to a persistent runtime with agent sessions. The runtime manages state, coordinates multi-party interactions, and enforces protocol invariants. New primitives (AgentRuntime, NegotiationSession, SettlementGraph, TranscriptStream, PolicyEngineV2) enable long-lived workflows, multi-party negotiations, and extensible implementations. Core invariants (determinism, replayability, explicit failure modes, auditability) are preserved. The first slice proves the architecture with minimal runtime, transcript streams, and one session type.



