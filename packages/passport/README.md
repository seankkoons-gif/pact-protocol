# @pact/passport

Pact Passport v4 - Agent reputation and credit scoring system.

## Overview

Passport is a credit bureau for agents: a deterministic scoring system that aggregates verifiable transaction outcomes to produce reputation scores. It enables agents to assess counterparty risk before entering negotiations.

## Features

- **Persistent Storage**: SQLite-based storage for passport events and scores
- **Transcript Ingestion**: Idempotent ingestion of Pact v4 transcripts
- **Event Types**: Supports settlement success, settlement failure, and dispute resolution events
- **Deterministic**: All writes are deterministic and replayable

## Installation

```bash
pnpm add @pact/passport
```

## Usage

### Initialize Storage

```typescript
import { PassportStorage } from "@pact/passport";

const storage = new PassportStorage("./passport.db");
```

### Ingest Transcripts

```typescript
import { ingestTranscriptOutcome } from "@pact/passport";
import type { TranscriptV4 } from "@pact/passport";

const transcript: TranscriptV4 = { /* ... */ };
const result = ingestTranscriptOutcome(storage, transcript);

if (result.ingested) {
  console.log(`Ingested ${result.event_type} event`);
}
```

### Idempotency

Ingestion is idempotent: calling `ingestTranscriptOutcome` multiple times with the same transcript will only insert events once. The function checks for existing events using the `transcript_hash` + `agent_id` composite key.

## Database Schema

### `agents`

- `agent_id` (TEXT, PRIMARY KEY)
- `created_at` (INTEGER)
- `identity_snapshot_hash` (TEXT)

### `passport_events`

- `id` (INTEGER, PRIMARY KEY AUTOINCREMENT)
- `agent_id` (TEXT, FOREIGN KEY → agents.agent_id)
- `event_type` (TEXT: 'settlement_success', 'settlement_failure', 'dispute_resolved')
- `ts` (INTEGER)
- `transcript_hash` (TEXT)
- `counterparty_agent_id` (TEXT)
- `value_usd` (REAL)
- `failure_code` (TEXT)
- `stage` (TEXT)
- `fault_domain` (TEXT)
- `terminality` (TEXT: 'terminal', 'non_terminal')
- `dispute_outcome` (TEXT)
- `metadata_json` (TEXT)

**Unique Constraint**: `(transcript_hash, agent_id)` - ensures idempotency per agent per transcript

### `passport_scores`

- `agent_id` (TEXT, PRIMARY KEY, FOREIGN KEY → agents.agent_id)
- `computed_at` (INTEGER)
- `score` (REAL, 0-100)
- `confidence` (REAL, 0-1)
- `breakdown_json` (TEXT)

## Testing

Tests use fixtures from `fixtures/failures/` and `fixtures/success/`:

```bash
pnpm test
```

## License

MIT
