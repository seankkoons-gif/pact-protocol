# Pact v4 Use Cases

This document describes the use cases that Pact v4 enables. Because Pact exists, developers can build these systems without building compliance infrastructure themselves.

## Autonomous Procurement Agents

**What it is:** Agents that negotiate and purchase services autonomously within policy constraints.

**How Pact enables it:**
- Policy-as-Code ensures agents never violate spending limits or constraints
- Negotiation protocol enables agents to find best prices while respecting constraints
- Transcripts provide audit trail for every purchase decision
- Evidence bundles enable sharing purchase history with auditors

**Example:** An enterprise agent that procures cloud compute resources, negotiating price and SLA terms while staying within budget and compliance policies.

**Canonical Flow:** See [Autonomous API Procurement Flow](./use_cases/AUTONOMOUS_API_PROCUREMENT.md) for the complete end-to-end flow specification.

## Agent-to-Agent Marketplaces

**What it is:** Marketplaces where agents negotiate directly without centralized order books.

**How Pact enables it:**
- Negotiation protocol enables 1:1 agent-to-agent transactions
- Transcripts provide verifiable proof of all negotiations
- Passport reputation enables agents to assess counterparty risk
- Credit system enables undercollateralized commitments for trusted agents

**Example:** A marketplace where AI agents offer services (data processing, model inference) and other agents purchase them, with reputation and credit enabling trustless transactions.

## SLA-Enforced API Brokers

**What it is:** Brokers that enforce service level agreements through policy and evidence.

**How Pact enables it:**
- Policy-as-Code enforces SLA constraints (latency, freshness, uptime)
- Failure taxonomy classifies SLA violations with blame attribution
- Evidence bundles provide proof of SLA compliance or violation
- Arbitration enables dispute resolution for SLA violations

**Example:** An API broker that routes requests to providers, enforcing latency and freshness SLAs, with automatic dispute resolution when SLAs are violated.

## Agent Credit Systems

**What it is:** Credit systems that enable undercollateralized commitments based on reputation.

**How Pact enables it:**
- Passport v1 provides deterministic reputation scoring
- Credit v1 enables undercollateralized commitments based on Passport score
- Transcripts provide evidence for credit decisions
- Failure taxonomy enables risk pricing

**Example:** A credit system that allows agents with high Passport scores to commit to transactions with reduced escrow, increasing capital velocity while managing risk.

## Machine Insurance Products

**What it is:** Insurance products that price risk based on failure taxonomy and evidence.

**How Pact enables it:**
- Failure taxonomy provides structured risk classification
- Transcripts provide evidence for claims
- Evidence bundles enable claims processing
- Arbitration enables dispute resolution

**Example:** An insurance product that insures agent transactions, pricing premiums based on failure history and Passport scores, with claims processed using evidence bundles.

## Compliance-Grade AI Services

**What it is:** AI services that produce auditable, legally defensible transaction records.

**How Pact enables it:**
- Transcripts provide complete audit trail
- Evidence bundles enable sharing with regulators
- Redaction enables sharing sensitive data while preserving integrity
- Arbitration enables legally defensible dispute resolution

**Example:** An AI service that handles financial transactions, producing evidence bundles that satisfy regulatory requirements for auditability and dispute resolution.

## Enterprise Agent Platforms

**What it is:** Platforms that enable enterprises to deploy autonomous agents at scale with full auditability.

**How Pact enables it:**
- Policy-as-Code enables enterprise governance
- Transcripts provide audit trail for all agent decisions
- Evidence bundles enable compliance reporting
- Redaction enables sharing with partners while preserving confidentiality

**Example:** An enterprise platform that enables companies to deploy autonomous agents for procurement, customer service, and operations, with full auditability and compliance reporting.

## Key Enablers

All these use cases are enabled by Pact v4's core capabilities:

1. **Agents can spend money without trusting themselves** — Boundary runtime ensures all spending occurs within policy
2. **Every negotiation is verifiable** — Hash-linked transcripts prove what happened and why
3. **Policies are hard guarantees** — Policy violations halt transactions; no exceptions
4. **Failures are classified** — Canonical failure taxonomy enables risk pricing
5. **Disputes are evidence-based** — Arbitration decisions are constrained by transcript evidence
6. **Reputation is computable** — Passport scores are derived from deterministic transcript history
7. **Evidence is portable** — Evidence bundles can be shared across trust boundaries

These capabilities establish Pact as **institution-grade autonomous commerce infrastructure**.
