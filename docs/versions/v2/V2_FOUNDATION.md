# PACT v2 Foundation & Roadmap

This document outlines the foundation and roadmap for PACT v2 features.

## Overview

PACT v2 represents an architectural reset designed to address fundamental limitations in v1 while preserving core protocol values: determinism, auditability, and explicit failure modes.

**Key Goals:**
1. Agent runtime primitive / long-lived sessions
2. Executable policies (not just JSON)
3. Multi-party negotiations / graph interactions
4. Transcript streams with checkpoints
5. Extensibility boundaries (pluggable settlement, reputation, negotiation)
6. Production-grade ergonomics
7. Deterministic execution model with explicit concurrency

**Status**: v2 is in active development. This document outlines the foundation and roadmap.

---

## Goal 1: Long-Lived Sessions / Agent Runtime Primitive

### Current State (v1)

v1 treats each `acquire()` call as a stateless, atomic transaction:
- No session state between calls
- No relationship tracking across transactions
- Manual state management required by integrators

### v2 Vision

Agents operate as persistent runtime entities with:
- **Persistent identities** that survive process restarts
- **Session handles** that maintain state across API calls
- **Explicit session lifecycle**: create, resume, suspend, terminate
- **Checkpointing** for crash recovery and audit trails

### Foundation Work Needed

1. **Session Storage Interface**
   ```typescript
   interface SessionStore {
     create(sessionId: string, initialState: SessionState): Promise<void>;
     get(sessionId: string): Promise<SessionState | null>;
     update(sessionId: string, state: SessionState): Promise<void>;
     checkpoint(sessionId: string, checkpoint: Checkpoint): Promise<void>;
     list(agentId: string): Promise<string[]>; // List sessions for agent
   }
   ```

2. **Session State Structure**
   ```typescript
   interface SessionState {
     session_id: string;
     agent_id: string;
     created_at_ms: number;
     last_updated_ms: number;
     status: "active" | "suspended" | "terminated";
     current_negotiations: NegotiationHandle[];
     partial_settlements: SettlementHandle[];
     checkpoints: Checkpoint[];
   }
   ```

3. **Session API**
   ```typescript
   interface SessionAPI {
     create(intent: Intent): Promise<SessionHandle>;
     resume(sessionId: string): Promise<SessionState>;
     suspend(sessionId: string): Promise<void>;
     terminate(sessionId: string): Promise<void>;
     checkpoint(sessionId: string): Promise<Checkpoint>;
   }
   ```

### Implementation Roadmap

- **Phase 1**: Define session interfaces and state structures
- **Phase 2**: Implement in-memory session store (for testing)
- **Phase 3**: Add session persistence (file-based or database)
- **Phase 4**: Integrate with acquire() to support session continuation
- **Phase 5**: Add checkpointing support

---

## Goal 2: Executable Policies

### Current State (v1)

v1 policies are declarative JSON schemas:
- Static configuration (`createDefaultPolicy()`)
- Limited dynamic adaptation
- No complex conditional logic
- No policy composition/inheritance

### v2 Vision

Policies as executable, composable logic:
- **Executable code** (WASM modules, DSL, or typed functions)
- **Dynamic adaptation** based on market conditions, reputation changes
- **Composition and inheritance** (base policy + domain-specific overrides)
- **Runtime verification** with execution traces

### Foundation Work Needed

1. **Policy Execution Interface**
   ```typescript
   interface PolicyExecutor {
     evaluate(policy: ExecutablePolicy, context: PolicyContext): Promise<PolicyResult>;
     explain(result: PolicyResult): string; // Execution trace
     validate(policy: ExecutablePolicy): ValidationResult;
   }
   ```

2. **Executable Policy Structure**
   ```typescript
   interface ExecutablePolicy {
     policy_id: string;
     version: string;
     engine: "wasm" | "dsl" | "typescript" | "json"; // Execution engine
     code: string | Uint8Array; // Policy code (WASM, DSL, TS, or JSON fallback)
     dependencies?: string[]; // Other policy IDs this depends on
     metadata?: Record<string, unknown>;
   }
   ```

3. **Policy DSL (Domain-Specific Language)**
   ```typescript
   // Example DSL syntax (to be defined)
   const policy = {
     engine: "dsl",
     code: `
       require trust_tier >= "trusted" for price > 0.0001;
       require sla_credential for latency < 50ms;
       reject if failure_rate > 0.1;
     `,
   };
   ```

### Implementation Roadmap

- **Phase 1**: Define policy execution interfaces
- **Phase 2**: Implement TypeScript policy executor (runtime evaluation)
- **Phase 3**: Design and implement policy DSL
- **Phase 4**: Add WASM policy executor (for sandboxing)
- **Phase 5**: Add policy composition and inheritance
- **Phase 6**: Add execution trace/explanation generation

---

## Goal 3: Multi-Party Negotiations / Graph Interactions

### Current State (v1)

v1 is fundamentally a two-party protocol (buyer ↔ seller):
- No multi-provider aggregation
- No delegation chains
- No coalition formation
- Manual orchestration required for multi-party scenarios

### v2 Vision

Negotiations involve multiple agents in graph-structured interactions:
- **N-party negotiations** (not just 2)
- **Graph topology** with explicit relationships
- **Sub-graphs** (coalitions, delegations) with their own rules
- **Atomic multi-party settlements** (all commit or all abort)

### Foundation Work Needed

1. **Graph Negotiation Structure**
   ```typescript
   interface NegotiationGraph {
     graph_id: string;
     nodes: NegotiationNode[];
     edges: NegotiationEdge[];
     topology: "star" | "chain" | "mesh" | "tree";
     coordinator: string; // Agent ID of coordinator
   }
   
   interface NegotiationNode {
     node_id: string;
     agent_id: string;
     role: "buyer" | "seller" | "coordinator" | "delegate";
     intent: Intent;
     status: "pending" | "negotiating" | "accepted" | "rejected";
   }
   
   interface NegotiationEdge {
     from: string; // node_id
     to: string;   // node_id
     relationship: "buyer_seller" | "coordinator" | "delegate" | "aggregate";
   }
   ```

2. **Multi-Party Settlement**
   ```typescript
   interface MultiPartySettlement {
     settlement_id: string;
     graph_id: string;
     participants: string[]; // agent_ids
     atomic: boolean; // All commit or all abort
     status: "pending" | "committing" | "committed" | "aborted";
     partial_commits: Map<string, SettlementHandle>; // agent_id -> handle
   }
   ```

3. **Graph Negotiation API**
   ```typescript
   interface GraphNegotiationAPI {
     createGraph(topology: GraphTopology, nodes: NegotiationNode[]): Promise<NegotiationGraph>;
     addNode(graphId: string, node: NegotiationNode): Promise<void>;
     negotiate(graphId: string): Promise<NegotiationResult>;
     settle(graphId: string): Promise<MultiPartySettlementResult>;
   }
   ```

### Implementation Roadmap

- **Phase 1**: Define graph structures and interfaces
- **Phase 2**: Implement basic graph negotiation (star topology)
- **Phase 3**: Add delegation chains
- **Phase 4**: Add coalition formation
- **Phase 5**: Implement atomic multi-party settlement
- **Phase 6**: Support complex topologies (mesh, tree)

---

## Goal 4: Transcript Streams with Checkpoints

### Current State (v1)

v1 transcripts are monolithic JSON files:
- Written at transaction completion
- No incremental replay
- No checkpointing
- No real-time streaming

### v2 Vision

Transcripts as append-only event streams:
- **Event streams** (not single JSON files)
- **Explicit checkpoints** for incremental replay
- **Hash-linked events** for integrity verification
- **Real-time streaming** support (WebSocket, SSE, file tailing)

### Foundation Work Needed

1. **Event Stream Interface**
   ```typescript
   interface TranscriptStream {
     stream_id: string;
     create(): Promise<void>;
     append(event: TranscriptEvent): Promise<void>;
     checkpoint(checkpointId: string): Promise<void>;
     replay(fromCheckpoint?: string): AsyncIterable<TranscriptEvent>;
     verify(): Promise<VerificationResult>;
   }
   ```

2. **Event Structure**
   ```typescript
   interface TranscriptEvent {
     event_id: string;
     event_type: "negotiation" | "settlement" | "checkpoint" | "error";
     timestamp_ms: number;
     previous_hash: string; // Hash of previous event
     hash: string; // Hash of this event
     data: unknown; // Event-specific data
   }
   ```

3. **Checkpoint Structure**
   ```typescript
   interface Checkpoint {
     checkpoint_id: string;
     event_id: string; // Last event before checkpoint
     state_hash: string; // Hash of reconstructed state
     created_at_ms: number;
   }
   ```

### Implementation Roadmap

- **Phase 1**: Define event stream interfaces
- **Phase 2**: Implement file-based event stream
- **Phase 3**: Add checkpointing support
- **Phase 4**: Add incremental replay from checkpoints
- **Phase 5**: Add real-time streaming (WebSocket/SSE)
- **Phase 6**: Add parallel verification

---

## Implementation Strategy

### Incremental Development

v2 features will be implemented incrementally:
1. **Foundation first**: Define interfaces and data structures
2. **In-memory implementations**: Build testable implementations
3. **Persistence layer**: Add storage backends (file, database)
4. **Integration**: Wire into acquire() and core runtime
5. **Optimization**: Performance tuning and caching

### Backward Compatibility

v1 and v2 will coexist:
- v1 remains stable (frozen at v1.7.0-rc6)
- v2 is new codebase with new APIs
- Migration guides provided (but no drop-in replacement)

### Testing Strategy

- Unit tests for each component
- Integration tests for multi-party scenarios
- Determinism tests (same inputs → same outputs)
- Replay tests (transcripts → reconstructed state)

---

## Timeline (Tentative)

- **Q1 2024**: Foundation interfaces and in-memory implementations
- **Q2 2024**: Session storage and persistence
- **Q3 2024**: Executable policies (TypeScript executor)
- **Q4 2024**: Multi-party negotiations (basic topologies)
- **2025**: Transcript streams, WASM policies, complex graph topologies

---

## Contributing

v2 is in active development. Contributions welcome:

1. Review interface designs
2. Implement in-memory prototypes
3. Add test cases
4. Improve documentation
5. Provide feedback on API ergonomics

---

**Status**: This is a living document. Interface designs and roadmap may evolve based on implementation experience.
