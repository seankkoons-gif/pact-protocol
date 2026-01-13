# PACT Quickstart Guide

Get PACT running in under 10 minutes.

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0

## Setup (2 minutes)

```bash
# Install dependencies
pnpm install

# Build packages
pnpm build

# Verify installation
pnpm test
```

## Run Your First Transaction (5 minutes)

### Step 1: Start Provider Server

In **Terminal 1**:

```bash
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve
```

You should see:
```
[Provider Server] sellerId: 8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp
[Provider Server] Started on http://127.0.0.1:7777
[Provider Server] Identity mode: dev-seed
```

**Note:** The `sellerId` will be the same every time with the deterministic seed.

### Step 2: Register Provider

In **Terminal 2**:

```bash
pnpm provider:register -- \
  --intent weather.data \
  --pubkey 8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp \
  --endpoint http://127.0.0.1:7777 \
  --credentials sla_verified \
  --region us-east \
  --baselineLatencyMs 50
```

This creates/updates `providers.jsonl` in the repo root.

### Step 3: Run Happy Demo

```bash
pnpm demo:happy
```

**Expected output:**
- Provider discovery
- Credential verification
- Quote negotiation
- Settlement execution (hash_reveal)
- Receipt with balances
- Transcript saved to `.pact/transcripts/`

### Step 4: Run Timeout Demo

```bash
pnpm demo:timeout
```

This demonstrates a timeout scenario where negotiation fails.

## Examples

PACT includes several example scripts to demonstrate different features:

### Basic Happy Path

```bash
pnpm example:happy
```

Runs a simple acquisition against the registry and prints the receipt.

### Timeout Streaming

```bash
pnpm example:timeout
```

Forces streaming mode with buyer stop after 1 tick.

### Dispute & Refund

```bash
pnpm example:dispute
```

Creates a dispute, resolves it, executes a refund, and verifies balances.

### Reconcile Pending

```bash
pnpm example:reconcile
```

Creates an async stripe_like settlement in pending state, then calls `reconcile()` to update the transcript.

## Verify Transcripts

After running demos or examples, transcripts are saved to `.pact/transcripts/`.

To verify a transcript:

```bash
# Verify a specific transcript
pnpm replay:verify -- .pact/transcripts/intent-123-1234567890-abc123.json

# Verify all transcripts in directory
pnpm replay:verify -- .pact/transcripts
```

## Check Environment

Run the doctor command to check your environment:

```bash
pnpm doctor
```

This verifies:
- Node.js and pnpm versions
- Workspace installation
- Provider registry existence
- Provider endpoint reachability
- Deterministic seed configuration

## Next Steps

- Read `README.md` for detailed documentation
- Check `PROTOCOL.md` for protocol semantics
- Explore `examples/` folder for more examples
- Review `RECAP.md` for a comprehensive overview

## Troubleshooting

**Provider not found:**
- Ensure provider server is running (Terminal 1)
- Verify provider is registered: `pnpm provider:list -- --intent weather.data`
- Check `providers.jsonl` exists and contains your provider

**Settlement fails:**
- Verify provider server is responding: `curl http://127.0.0.1:7777/health`
- Check provider server logs for errors

**Transcript verification fails:**
- Ensure transcript file exists
- Check transcript version (should be "1.0" for new transcripts)
- Run `pnpm replay:verify` with `--` separator

## Tips

- Use `PACT_DEV_IDENTITY_SEED` for deterministic demo identities
- Transcripts are saved to `.pact/transcripts/` (git-ignored)
- Provider registry is `providers.jsonl` at repo root
- All examples write transcripts automatically


