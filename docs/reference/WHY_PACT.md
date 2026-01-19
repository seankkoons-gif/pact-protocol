# Why PACT Exists

This document explains PACT's existence and positioning. It is opinionated, technical, and written for engineers and founders who need to understand why PACT exists and what problems it solves.

---

## 1. The Problem with Fixed Pricing APIs for Autonomous Agents

Most APIs assume static value. A weather API charges $0.0001 per request, regardless of whether the data is fresh or stale, whether the request is urgent or can wait, or whether the provider has a proven track record or is unproven. This model works for human-to-service interactions where humans can evaluate trade-offs and make decisions. It breaks down for autonomous agents.

**Why APIs assume static value:**

APIs are designed for human operators who can reason about context. A human sees a price, evaluates urgency, checks provider reputation, and makes a decision. APIs encode this decision as a fixed price because the human is the decision-maker. The API is just a service boundary.

**Why agents operate under uncertainty:**

Autonomous agents face uncertainty that humans don't. An agent doesn't know:
- Whether a provider will deliver on time
- Whether the data will be fresh enough
- Whether the provider has a history of failures
- Whether the price is fair given current market conditions
- Whether a cheaper alternative exists that meets the same constraints

An agent must make decisions under this uncertainty, and fixed pricing provides no mechanism to resolve it.

**Why negotiation is inevitable:**

When value is uncertain, negotiation is the mechanism that resolves uncertainty. Negotiation allows agents to:
- Express constraints (latency, freshness, trust requirements)
- Receive offers that reflect those constraints
- Counteroffer when initial offers don't meet requirements
- Accept or reject based on policy-driven criteria

Without negotiation, agents must either:
1. Accept whatever price is offered (risking overpayment or poor service)
2. Reject all offers above a threshold (risking no service at all)
3. Hardcode heuristics (brittle, non-adaptive, unverifiable)

Negotiation is not a feature. It is a requirement for autonomous agents operating under uncertainty.

---

## 2. Why Negotiation Beats Markets for Low-Liquidity, Bespoke Services

Markets are excellent for high-liquidity, standardized goods. They aggregate supply and demand, discover prices through competition, and clear efficiently. But markets require volume, standardization, and liquidity. Most agent-to-agent services have none of these.

**Markets need volume:**

A market requires enough participants to create competition. If only three providers offer weather data for a specific region, there's no market—there's a negotiation. Markets also require frequent transactions to maintain price discovery. If transactions are infrequent or one-off, markets can't discover prices effectively.

**Agents need 1:1 contracts:**

Agents don't buy standardized goods. They negotiate bespoke contracts:
- "I need weather data for NYC with <50ms latency and <10s freshness, from a provider with >0.8 trust score, delivered via streaming settlement"
- "I need compute for this specific task with these specific constraints, from a provider that can prove SLA compliance"

These are not market orders. They are negotiation requests that require back-and-forth to resolve.

**Negotiation is a protocol, not a UX:**

Markets optimize for human UX: order books, limit orders, market orders, fills, cancellations. Agents don't need UX. They need a protocol:
- Structured message types (INTENT, ASK, BID, ACCEPT, REJECT)
- Deterministic negotiation flows
- Verifiable commitments
- Auditable outcomes

Negotiation protocols are machine-readable, machine-verifiable, and machine-executable. Markets are human-readable, human-verifiable, and human-executable.

For low-liquidity, bespoke services, negotiation protocols are superior to markets because they:
- Don't require liquidity to function
- Support arbitrary constraints and requirements
- Enable deterministic, verifiable outcomes
- Work for one-off transactions as well as repeated ones

---

## 3. Why Transcripts Matter More Than Outcomes

Most systems optimize for outcomes: did the transaction succeed? did the payment go through? did the data arrive? PACT optimizes for transcripts: what happened, why it happened, and how to verify it happened.

**Determinism:**

Given the same inputs (intent, policy, directory, clock), PACT produces the same transcript. This means:
- Two agents running the same negotiation produce identical transcripts
- Replay verification catches protocol violations and implementation bugs
- Testing is reproducible: same inputs → same outputs → same transcripts

Without determinism, you can't verify correctness, debug failures, or audit decisions.

**Replayability:**

Transcripts are not logs. They are executable specifications. You can replay a transcript to:
- Verify that the outcome was correct given the inputs
- Debug why a negotiation failed
- Audit why a provider was selected or rejected
- Train ML models on historical decisions

Replayability means transcripts are the source of truth, not a side effect of execution.

**Auditability:**

Transcripts capture the complete negotiation and settlement history:
- Which providers were considered
- Which quotes were received
- Why providers were selected or rejected
- What counteroffers were made
- How settlement was executed
- What the final outcome was

This auditability is not optional. It's required for:
- Dispute resolution (prove what happened)
- Regulatory compliance (prove fairness)
- Reputation systems (prove outcomes)
- ML training (prove decisions)

**ML training data:**

Transcripts are structured, deterministic, and complete. They are ideal training data for ML models that learn negotiation strategies, price prediction, and provider selection. But transcripts must be safe: no PII, no keys, no secrets. PACT's training data format strips sensitive data while preserving decision-relevant information.

Outcomes tell you what happened. Transcripts tell you why it happened and how to verify it happened. For autonomous agents, the why and how matter more than the what.

---

## 4. Why Policy > Heuristics

Heuristics are rules of thumb. "If price < $0.0001, accept. If trust score > 0.8, accept. If latency < 50ms, accept." Heuristics work until they don't, and when they don't, you can't explain why.

**Explicit constraints:**

Policies are explicit constraints that agents can reason about:
- "Require trust tier >= 'trusted' for prices > $0.0001"
- "Require SLA credential for latency < 50ms"
- "Reject providers with < 5 successful transactions"

These constraints are:
- Machine-readable (agents can evaluate them)
- Machine-verifiable (agents can prove compliance)
- Machine-explainable (agents can explain why a constraint was applied)

Heuristics are implicit, unverifiable, and unexplainable.

**Guardrails over optimization:**

Policies are guardrails, not optimizers. They define what is acceptable, not what is optimal. This is intentional:
- Guardrails are verifiable (did we violate a constraint?)
- Optimizers are not (is this the best outcome?)

PACT uses policies to enforce constraints. Optimization (e.g., ML-based negotiation) happens within those constraints.

**Explainability:**

When a negotiation fails, policies explain why:
- "Provider rejected: trust tier 'untrusted' < required 'trusted'"
- "Provider rejected: quote price $0.0002 > max price $0.0001"
- "Provider rejected: latency 60ms > constraint 50ms"

Heuristics can't explain failures. They just fail.

Policies are not suggestions. They are executable constraints that agents must satisfy. This makes PACT verifiable, explainable, and auditable.

---

## 5. Why ML Must Be Bounded

ML is powerful but unpredictable. Given the same inputs, an ML model might produce different outputs. This violates PACT's determinism requirement. But ML is also valuable: it can learn negotiation strategies, predict prices, and optimize provider selection.

**ML as a scorer, not a decider:**

ML should score candidates, not decide outcomes. The decision logic remains deterministic:
1. Generate candidate counteroffers (deterministic)
2. Score candidates with ML (non-deterministic, but bounded)
3. Select best candidate deterministically (stable tie-breaking, deterministic selection)

The ML scorer is a pluggable component that can be replaced, but the decision logic remains deterministic.

**Deterministic fallbacks:**

If ML fails (model unavailable, scoring error, timeout), PACT falls back to deterministic strategies:
- Baseline: accept quote if within max price
- Banded concession: counteroffer within price band
- Aggressive if urgent: higher counteroffers for urgent requests

ML enhances negotiation but doesn't control it.

**Offline training only:**

ML models are trained offline on historical transcripts. They are not trained online during negotiation. This ensures:
- Training data is safe (no PII, no keys, no secrets)
- Models are versioned and auditable
- Training doesn't affect negotiation determinism

ML is a tool, not a replacement for deterministic negotiation logic.

---

## 6. Why Escrow is Not Part of the SDK

Escrow is the mechanism that holds funds until settlement conditions are met. It's critical for trustless transactions, but it's not part of PACT's core SDK.

**Execution boundary:**

PACT negotiates and coordinates settlement. It doesn't execute settlement. Settlement execution (including escrow) happens outside PACT:
- On-chain smart contracts
- Payment processors (Stripe, PayPal)
- Escrow services
- Custom settlement backends

PACT defines the settlement interface, not the implementation.

**Replaceable settlement:**

Settlement providers are pluggable. Integrators can:
- Use on-chain smart contracts for trustless escrow
- Use payment processors for fiat settlements
- Use custom escrow services for domain-specific requirements
- Mix and match (e.g., on-chain escrow + off-chain reputation)

PACT doesn't care how escrow works, only that it satisfies the settlement interface.

**Chain-agnostic core:**

PACT's core is chain-agnostic. It works with:
- Ethereum, Solana, Bitcoin, Base, Polygon, Arbitrum
- Fiat payment rails
- Custom settlement backends

Escrow is chain-specific. On-chain escrow requires smart contracts. Off-chain escrow requires payment processors. PACT doesn't choose. Integrators choose.

Escrow is essential, but it's an execution detail, not a protocol requirement. PACT defines what settlement should do, not how it should do it.

---

## 7. What PACT Is (and Is Not)

**PACT is:**

- **Negotiation**: A protocol for agents to negotiate terms (price, constraints, settlement mode) through structured message types and deterministic flows.

- **Policy**: Executable constraints that define what is acceptable, not what is optimal. Policies are machine-readable, machine-verifiable, and machine-explainable. In v4, policies are enforced by a non-bypassable execution boundary.

- **Transcripts**: Deterministic, replayable, auditable records of negotiation and settlement. Transcripts are the source of truth, not a side effect of execution. In v4, transcripts are hash-linked and cryptographically verifiable (Proof of Negotiation).

- **Forensics**: Evidence bundles, failure taxonomy, and arbitration that enable post-hoc analysis and dispute resolution. In v4, evidence is portable across trust boundaries while preserving cryptographic integrity.

- **Reputation & Credit**: Passport v1 provides agent reputation scoring. Credit v1 enables undercollateralized commitments based on reputation. Both are derived from deterministic transcript history.

**PACT is not:**

- **A chain**: PACT doesn't run on a blockchain. It's a protocol that can work with any chain (or no chain).

- **A wallet**: PACT doesn't custody assets or manage keys. It coordinates settlement through pluggable settlement providers.

- **A market**: PACT doesn't aggregate supply and demand or discover prices through competition. It enables 1:1 negotiations between agents.

- **A payments company**: PACT doesn't move money. It defines how agents agree on terms and coordinate settlement. Settlement execution happens outside PACT.

- **A marketplace**: PACT doesn't provide order books, limit orders, or real-time price feeds. It's a deterministic negotiation protocol.

PACT is a coordination, negotiation, and forensic layer for autonomous agents. It sits upstream of execution (settlement, delivery) and downstream of intent (what agents want). It doesn't replace markets, chains, wallets, or payment processors. It enables agents to use them safely and verifiably.

## 8. What Pact v4 Enables (New Capabilities)

Pact v4 introduces capabilities that were not possible before:

**Agents Can Spend Money Without Trusting Themselves**

Before Pact: An agent spends money. If it goes wrong, you inspect logs. Logs are mutable, contextual, and non-authoritative.

With Pact: An agent can only spend money inside a Pact Boundary. Every decision is cryptographically recorded before settlement. If money moves, a PoN transcript exists. If it doesn't exist, money cannot move.

**Negotiation Becomes a First-Class, Verifiable Primitive**

Before Pact: Price is hardcoded, heuristic, or implicit. No record of why a price was chosen.

With Pact: Price discovery is explicit negotiation. Every ASK/BID/COUNTER is recorded and signed. You can audit price formation, prove an agent did not overpay, and detect predatory counterparties.

**Policies Are Now Hard Guarantees, Not Suggestions**

Before Pact: Policies live in app code. Agents can violate them due to bugs, race conditions, or prompt drift.

With Pact: Policy-as-Code is enforced before settlement. Violations halt the transaction. You can promise "This agent will never pay more than $0.05" and prove it.

**Failure Is No Longer Ambiguous — It's Classified**

Before Pact: Failures are strings: "timeout", "error", "exception".

With Pact: Failures are typed events with blame attribution (PACT-101, PACT-202, etc.). You can distinguish who caused a failure, price risk, build insurance, and automate retries correctly.

**Disputes Can Be Resolved Without Humans or Logs**

Before Pact: Disputes require humans reading logs. Logs are incomplete and disputable.

With Pact: Disputes are resolved using only the transcript. Arbiters issue signed decisions constrained by evidence. No trust in narratives—only evidence.

**Agents Now Have Reputation and Credit, Not Just Wallets**

Before Pact: Agents are anonymous wallets. Every transaction requires full collateral.

With Pact: Agents have Passports (history, reliability, failure patterns). Credit can be extended safely. You can allow undercollateralized commitments, deny risky agents automatically, and increase capital velocity.

**Evidence Is Now Portable and Role-Aware**

Before Pact: Logs are internal. Sharing requires trust and context.

With Pact: Evidence bundles are cryptographically sealed. Different views for different audiences (internal, partner, auditor). Each sees exactly what they are allowed to see.

**Time Travel Debugging for Autonomous Systems Exists**

Before Pact: You can't replay decisions. You can only inspect outcomes.

With Pact: You can deterministically replay decisions. You can debug agent behavior post-mortem, explain decisions to humans, train better strategies, and satisfy regulators. This is the "flight recorder" moment.

---

## Conclusion

PACT exists because autonomous agents need a way to negotiate under uncertainty, coordinate settlement without trust, and audit decisions after the fact. Fixed pricing APIs don't work for agents. Markets don't work for low-liquidity, bespoke services. Heuristics don't work for verifiable, explainable decisions.

PACT provides:
- A negotiation protocol for agents operating under uncertainty
- Policy-driven constraints that are verifiable and explainable (enforced by non-bypassable boundary in v4)
- Transcripts that enable determinism, replayability, and auditability (hash-linked PoN in v4)
- Bounded ML that enhances negotiation without breaking determinism
- Pluggable settlement that works with any execution backend
- Canonical failure taxonomy with blame attribution (v4)
- Transcript-constrained arbitration with signed decision artifacts (v4)
- Agent reputation and credit systems (Passport v1, Credit v1)
- Evidence bundles for cross-trust-boundary sharing (v4)

PACT is not a chain, wallet, market, or payments company. It is a protocol layer that enables agents to negotiate, coordinate, and settle transactions safely and verifiably.

**Pact v4 establishes a new standard**: Institution-grade autonomous commerce infrastructure where agents can spend money without trusting themselves, policies are hard guarantees, failures are classified, disputes are evidence-based, and every decision is replayable and auditable.

If you're building autonomous agents that need to transact with other agents, PACT is the protocol you need. If you're building a chain, wallet, market, or payments company, PACT is the protocol your users need.
