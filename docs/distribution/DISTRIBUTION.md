# PACT Distribution Guide

How to share, install, and use PACT packages.

## Share with a Dev Today

**Quick share (for v1.7.0-rc5):**

```bash
# Clone and checkout
git clone https://github.com/seankkoons-gif/pact_.git
cd pact_
git checkout v1.7.0-rc5

# Run release gate (builds, tests, packs, runs examples, verifies transcripts)
pnpm install
pnpm release:gate
```

The release gate verifies:
- ✅ Build succeeds
- ✅ All tests pass
- ✅ Packages can be packed for distribution
- ✅ All examples run successfully
- ✅ Transcripts verify correctly (strict + terminal-only mode)

**If release:gate passes, the dev is synced and ready to go.**

## Use as a Library Locally

**Build the SDK:**

```bash
pnpm -C packages/sdk build
```

**Use in your code:**

```typescript
import { acquire, createDefaultPolicy, generateKeyPair } from "@pact/sdk";
// ... your code
```

**Run examples:**

```bash
# Requires provider server running (Terminal A)
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve

# Run examples (Terminal B)
pnpm example:happy
pnpm example:timeout
pnpm example:dispute
pnpm example:reconcile
```

## Provider Adapter Usage

**Start provider server:**

```bash
# Dev seed (deterministic identity)
PACT_DEV_IDENTITY_SEED=pact-provider-default-seed-v1 pnpm provider:serve

# Custom identity
PACT_PROVIDER_SECRET_KEY_B58=<your-secret-key> pnpm provider:serve

# Ephemeral (random identity each restart)
pnpm provider:serve
```

**Register provider:**

```bash
pnpm provider:register -- \
  --intent weather.data \
  --pubkey <provider-pubkey> \
  --endpoint http://127.0.0.1:7777 \
  --credentials sla_verified \
  --region us-east \
  --baselineLatencyMs 50
```

**List providers:**

```bash
pnpm provider:list -- --intent weather.data
```

**Example registry:**

See `providers.example.jsonl` at repo root for a valid registry entry. Copy it to `providers.jsonl` and customize as needed.

## Packaging Checks

**Verify packages can be packed:**

```bash
pnpm pack:check
```

This:
1. Builds both `@pact/sdk` and `@pact/provider-adapter`
2. Runs `pnpm pack` on each
3. Verifies no warnings or errors
4. Cleans up generated `.tgz` files

**Manual pack (for local testing):**

```bash
# Pack SDK
pnpm -C packages/sdk pack

# Pack provider-adapter
pnpm -C packages/provider-adapter pack
```

Packages will be created as `.tgz` files in each package directory.

## Planned npm Publish Flow

**Packages to publish:**
- `@pact/sdk` - Main SDK package
- `@pact/provider-adapter` - Provider server adapter

**Pre-publish checklist:**
1. Run release gate: `pnpm release:gate`
2. Check API surface: `pnpm api:check` (must match snapshot)
3. Verify packages: `pnpm pack:check`
4. Test examples: `pnpm examples:all`
5. Verify transcripts: `pnpm replay:verify:strict-terminal`

**Publish process (when ready):**
```bash
# Build both packages
pnpm build

# Publish SDK
pnpm -C packages/sdk publish

# Publish provider-adapter
pnpm -C packages/provider-adapter publish
```

**After publish, users can install:**

```bash
npm install @pact/sdk @pact/provider-adapter
# or
pnpm add @pact/sdk @pact/provider-adapter
```

**Note:** Publishing is not yet enabled. These packages are currently only available via git clone.

## Verifying Transcripts

**Default mode (warnings for pending settlements, expired credentials, and wallet verification failures):**

```bash
pnpm replay:verify -- .pact/transcripts
```

**Strict mode (errors for pending settlements; expired credentials and wallet failures still warnings):**

```bash
pnpm replay:verify --strict -- .pact/transcripts
```

**Strict + terminal-only (skip pending, verify only terminal):**

```bash
pnpm replay:verify --strict --terminal-only -- .pact/transcripts
```

**Note**: `CREDENTIAL_EXPIRED` and `WALLET_VERIFY_FAILED` are always treated as warnings (expected for historical transcripts), even in strict mode.

This mode is used in the release gate to verify only completed transcripts.

## Release Gate

The release gate (`pnpm release:gate`) is the authoritative verification that everything works:

1. **Clean**: Removes `.pact` directory to avoid stale transcripts
2. **Build**: Builds all packages
3. **Test**: Runs all tests
4. **Pack Check**: Verifies packages can be packed
5. **Examples**: Runs all example scripts
6. **Verify**: Verifies transcripts (strict + terminal-only mode)

**If release:gate passes, you're ready to share.**

## Next Steps

- See [getting-started/QUICKSTART.md](../getting-started/QUICKSTART.md) for detailed onboarding
- See [guides/PROVIDER_GUIDE.md](../guides/PROVIDER_GUIDE.md) for provider setup
- See [guides/BUYER_GUIDE.md](../guides/BUYER_GUIDE.md) for buyer usage
- Check [README.md](../README.md) for project overview

