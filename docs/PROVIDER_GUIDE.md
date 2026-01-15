# PACT Provider Guide

This guide explains how to run and configure PACT providers using the `@pact/provider-adapter` package.

## What is provider-adapter?

The `provider-adapter` package provides a standalone HTTP server that implements the PACT provider protocol. It handles:
- Credential requests
- Quote requests
- Commit/reveal settlement
- Streaming settlement

## Running a Provider

### Basic Usage

```bash
# Start provider server (ephemeral identity)
pnpm provider:serve

# Start with deterministic dev identity
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve
```

The server will start on `http://127.0.0.1:7777` by default (or a random port if 7777 is taken).

## Provider Identity Modes

Providers need an Ed25519 keypair for signing credentials and quotes. The adapter supports four identity loading modes, in order of precedence:

### 1. Environment Secret Key (`env-secret-key`)

Set `PACT_PROVIDER_SECRET_KEY_B58` to a base58-encoded 64-byte Ed25519 secret key:

```bash
export PACT_PROVIDER_SECRET_KEY_B58="your-secret-key-base58"
pnpm provider:serve
```

**Use case:** Production deployments with secrets management.

### 2. Keypair File (`keypair-file`)

Set `PACT_PROVIDER_KEYPAIR_FILE` to a path to a JSON file:

```json
{
  "publicKeyB58": "...",
  "secretKeyB58": "..."
}
```

Or just:
```json
{
  "secretKeyB58": "..."
}
```

```bash
export PACT_PROVIDER_KEYPAIR_FILE="./keypair.json"
pnpm provider:serve
```

**Use case:** Local development with persistent identity.

### 3. Dev Seed (`dev-seed`)

Set `PACT_DEV_IDENTITY_SEED` to a string seed:

```bash
export PACT_DEV_IDENTITY_SEED="my-dev-seed-v1"
pnpm provider:serve
```

This generates a deterministic keypair from the seed using PBKDF2. The same seed always produces the same keypair.

**Use case:** Development and demos where you want consistent provider identity.

**Warning:** Only use in development. The seed is not cryptographically secure for production.

### 4. Ephemeral (`ephemeral`)

If no identity is configured, the adapter generates a random keypair on startup:

```bash
pnpm provider:serve
```

**Use case:** Quick testing where identity doesn't matter.

**Note:** Each restart generates a new identity, so buyers won't recognize the provider across restarts.

## Health Endpoint

The provider exposes a health check endpoint:

```bash
curl http://127.0.0.1:7777/health
```

Response:
```json
{
  "ok": true,
  "sellerId": "8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp",
  "seller_pubkey_b58": "8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp",
  "mode": "dev-seed"
}
```

## Registering a Provider

After starting the provider server, register it in the provider registry:

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

### Registry Fields

- `provider_id`: Unique identifier (defaults to first 8 chars of pubkey)
- `intentType`: Intent type the provider can fulfill (e.g., `weather.data`)
- `pubkey_b58`: Provider's public key (base58)
- `endpoint`: HTTP endpoint URL (required for remote providers)
- `credentials`: Array of credentials (e.g., `["sla_verified", "bonded"]`)
- `region`: Geographic region (e.g., `us-east`)
- `baseline_latency_ms`: Expected latency in milliseconds

## KYA (Know Your Agent) Credentials

Providers can advertise credentials that buyers can require:

- `sla_verified`: Provider has verified SLA guarantees
- `bonded`: Provider has posted a bond
- `kyc_verified`: Provider has completed KYC
- Custom credentials: Any string can be used

Buyers can require credentials via policy:

```typescript
const policy = createDefaultPolicy({
  requireCredential: ["sla_verified"],
  minTrustTier: 1,
});
```

## Trust Tiers

Providers can have trust tiers (0-3) based on their reputation. Buyers can require minimum trust tiers:

```typescript
const policy = createDefaultPolicy({
  minTrustTier: 2, // Require tier 2 or higher
});
```

## Troubleshooting

### Signer Mismatch

**Error:** `CREDENTIAL_SIGNER_MISMATCH` or `QUOTE_SIGNER_MISMATCH`

**Cause:** The provider's public key doesn't match the keypair used for signing.

**Fix:**
1. Check that `--pubkey` in `provider:register` matches the provider's actual public key
2. Verify the identity mode is consistent (same seed/file/env var)
3. Check the provider server logs for the `sellerId` it's using

### Endpoint Mismatch

**Error:** Provider not reachable

**Cause:** The endpoint in `providers.jsonl` doesn't match where the server is running.

**Fix:**
1. Verify the provider server is running: `curl http://127.0.0.1:7777/health`
2. Update the registry: `pnpm provider:register -- --endpoint <correct-url> ...`

### Missing Registry

**Error:** `NO_ELIGIBLE_PROVIDERS`

**Cause:** No providers registered in `providers.jsonl` for the requested intent.

**Fix:**
1. Start provider server
2. Register provider: `pnpm provider:register -- --intent <intent> --pubkey <pubkey> --endpoint <endpoint>`
3. Verify: `pnpm provider:list -- --intent <intent>`

### Provider Not Responding

**Error:** Network timeouts or connection errors

**Fix:**
1. Check provider server is running: `curl http://127.0.0.1:7777/health`
2. Check firewall/network settings
3. Verify endpoint URL is correct (http://127.0.0.1:7777, not https://)

## Next Steps

- See [QUICKSTART.md](./QUICKSTART.md) for end-to-end examples
- See [BUYER_GUIDE.md](./BUYER_GUIDE.md) for buyer-side usage
- Check [PROTOCOL.md](../PROTOCOL.md) for protocol details



