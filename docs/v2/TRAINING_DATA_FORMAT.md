# Training Data Format (Phase 6)

## Overview

This document defines the JSONL (JSON Lines) format for training data derived from PACT transcripts. Each line is a JSON object representing a single negotiation outcome, suitable for ML model training.

## Security & Privacy

**Critical:** This format explicitly excludes:
- **No PII**: No personally identifiable information (buyer/seller IDs, addresses, etc.)
- **No Keys**: No private keys, secret keys, or signing keys
- **No Wallet Secrets**: No mnemonics, seed phrases, or wallet secrets
- **No Full Transcripts**: Only aggregated summaries, not raw message arrays

All data is derived from public transaction outcomes and aggregated metadata only.

## JSONL Row Format

Each training row is a JSON object with the following structure:

### Required Fields

#### Intent & Constraints
- `intent_type` (string): The intent type (e.g., "weather.data", "compute.task")
- `constraints` (object): Small constraints object with:
  - `latency_ms` (number): Maximum acceptable latency in milliseconds
  - `freshness_sec` (number): Maximum acceptable age of data in seconds

#### Asset & Chain
- `asset` (string, optional): Asset symbol used (e.g., "USDC", "ETH", "SOL")
- `chain` (string, optional): Chain identifier (e.g., "evm", "solana", "bitcoin")

#### Negotiation Strategy
- `negotiation_strategy` (string): Strategy used (e.g., "baseline", "banded_concession", "aggressive_if_urgent", "ml_stub")
- `rounds_summary` (object): Summary of negotiation rounds:
  - `rounds_used` (number): Total number of rounds executed
  - `final_round_accepted` (boolean): Whether the final round was accepted
  - `avg_counter_ratio` (number, optional): Average ratio of counter_price to ask_price across rounds
  - `final_counter_ratio` (number, optional): Final counter_price / ask_price ratio

#### Pricing
- `accepted_price` (number, optional): Final agreed price (null if negotiation failed)
- `reference_price` (number, optional): Reference price (e.g., P50 from history)
- `band_pct` (number, optional): Band percentage used (if applicable)
- `quote_price` (number, optional): Initial quote price from provider
- `max_price` (number, optional): Buyer's maximum price

#### Outcome
- `outcome` (string): One of:
  - `"accepted"`: Negotiation succeeded and price was agreed
  - `"rejected"`: Negotiation was rejected (e.g., quote exceeded max price)
  - `"timeout"`: Negotiation timed out
  - `"failed"`: Negotiation failed for other reasons

### Optional Features

#### Urgency
- `urgent` (boolean, optional): Whether the request was marked as urgent

#### Trust & Credentials
- `trust_tier` (string, optional): Trust tier assigned ("untrusted" | "low" | "trusted")
- `trust_score` (number, optional): Trust score (0.0 to 1.0)

#### Wallet Capabilities
- `wallet_can_sign_message` (boolean, optional): Whether wallet can sign messages
- `wallet_can_sign_transaction` (boolean, optional): Whether wallet can sign transactions
- `wallet_chain` (string, optional): Wallet chain type ("solana" | "evm" | "unknown")

#### ML Metadata (if ML strategy used)
- `ml_scorer` (string, optional): ML scorer type used (e.g., "stub")
- `ml_selected_candidate_idx` (number, optional): Index of selected candidate
- `ml_top_score` (number, optional): Score of top-ranked candidate

## Example Row

```json
{
  "intent_type": "weather.data",
  "constraints": {
    "latency_ms": 50,
    "freshness_sec": 10
  },
  "asset": "USDC",
  "chain": "evm",
  "negotiation_strategy": "ml_stub",
  "rounds_summary": {
    "rounds_used": 2,
    "final_round_accepted": true,
    "avg_counter_ratio": 0.92,
    "final_counter_ratio": 0.95
  },
  "accepted_price": 0.000095,
  "reference_price": 0.0001,
  "band_pct": 0.1,
  "quote_price": 0.0001,
  "max_price": 0.0002,
  "outcome": "accepted",
  "urgent": false,
  "trust_tier": "trusted",
  "trust_score": 0.85,
  "wallet_can_sign_message": true,
  "wallet_can_sign_transaction": true,
  "wallet_chain": "evm",
  "ml_scorer": "stub",
  "ml_selected_candidate_idx": 1,
  "ml_top_score": 150.5
}
```

## Data Derivation Rules

1. **Aggregation**: Large arrays (e.g., `negotiation.log`, `negotiation_rounds`) are converted to summary statistics only
2. **Stripping**: All sensitive fields are omitted (keys, secrets, full addresses, etc.)
3. **Determinism**: Same transcript always produces the same training row
4. **Null Handling**: Missing optional fields are omitted (not set to null)

## Usage

Training rows are generated using the `transcriptToTrainingRow()` helper function:

```typescript
import { transcriptToTrainingRow } from "@pact/sdk";

const trainingRow = transcriptToTrainingRow(transcript);
if (trainingRow) {
  // Write to JSONL file
  console.log(JSON.stringify(trainingRow));
}
```

Rows that cannot be converted (e.g., missing required fields) return `null` and should be skipped.
