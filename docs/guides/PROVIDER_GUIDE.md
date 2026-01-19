# PACT Provider Guide

This guide explains how to run and configure PACT providers using the `@pact/provider-adapter` package.

> **v4 is complete and production-ready!** For v4 features (Policy-as-Code, Boundary Runtime, Evidence Bundles), see [versions/v4/STATUS.md](../versions/v4/STATUS.md). This guide covers v3 (stable and maintained).

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

The server will start on a random available port by default (`port: 0`). The server will output the actual port after binding. You can also specify a port explicitly (e.g., `--port 7777`) if you need a fixed port for registry entries.

**Note**: When using a random port, check the server output for the actual URL and use that when registering the provider.

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
# Use the actual port from server output (or specify a fixed port with --port)
pnpm provider:register -- \
  --intent weather.data \
  --pubkey 8MAHFtsAtkENKMukXZoRUhNXCtJExDHEsUPSR19rjBDp \
  --endpoint http://127.0.0.1:<actual-port> \
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

## ZK-KYA Identity Verification (v2 Phase 5)

Providers can require buyers to provide zero-knowledge proof-based identity verification (ZK-KYA) to prove their identity and credentials. This is configured in the provider's policy.

### Requiring ZK-KYA from Buyers

To require ZK-KYA proofs from buyers, configure your policy:

```typescript
import { createDefaultPolicy } from "@pact/sdk";

const policy = createDefaultPolicy();
policy.base.kya.zk_kya = {
  required: true,                        // Require ZK-KYA proof from buyers
  min_tier: "trusted",                   // Minimum trust tier (untrusted, low, trusted)
  require_issuer: true,                  // Require issuer_id to be present
  allowed_issuers: [                    // Whitelist of trusted issuers
    "issuer_pact_registry",
    "issuer_kyc_provider_v1"
  ]
};
```

### How It Works

1. **Buyer provides proof**: Buyers include a `zk_kya_proof` in their `acquire()` input
2. **Pact verifies**: Pact checks expiry, issuer allow-list, and minimum tier
3. **Verification result**: The proof is verified (by default, returns `ZK_KYA_NOT_IMPLEMENTED` unless external verifier is used)
4. **Transcript recording**: Only hashes are stored in transcripts (never raw proof data)

### Important Notes

- **Default verifier**: Pact's default verifier returns `ZK_KYA_NOT_IMPLEMENTED` (for deterministic CI). Real ZK verification must be implemented externally.
- **Transcript policy**: Pact automatically hashes proofs before storing in transcripts (no raw data)
- **Issuer allow-listing**: Use `allowed_issuers` to restrict which credential issuers you trust
- **Tier enforcement**: Set `min_tier` to enforce minimum trust requirements

### Failure Codes

If a buyer's ZK-KYA proof fails validation, `acquire()` returns:

- `ZK_KYA_REQUIRED`: Policy requires ZK-KYA but buyer didn't provide proof
- `ZK_KYA_NOT_IMPLEMENTED`: Default verifier (no external ZK implementation)
- `ZK_KYA_INVALID`: Proof verification failed
- `ZK_KYA_EXPIRED`: Proof has expired
- `ZK_KYA_TIER_TOO_LOW`: Trust tier below required minimum
- `ZK_KYA_ISSUER_NOT_ALLOWED`: Issuer not in allowed list

See [ZK-KYA Documentation](../security/ZK_KYA.md) for detailed information about proof structure, hashing rules, and security considerations.

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

- See [getting-started/QUICKSTART.md](../getting-started/QUICKSTART.md) for end-to-end examples
- See [BUYER_GUIDE.md](./BUYER_GUIDE.md) for buyer-side usage
- Check [PROTOCOL.md](../reference/PROTOCOL.md) for protocol details



