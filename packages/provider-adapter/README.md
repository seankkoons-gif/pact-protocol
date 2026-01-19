# @pact/provider-adapter

HTTP server adapter for implementing Pact provider agents. This package provides a minimal HTTP server that implements the seller agent interface for the Pact protocol.

## Installation

```bash
npm install @pact/provider-adapter
# or
pnpm add @pact/provider-adapter
# or
yarn add @pact/provider-adapter
```

## Features

- **HTTP Server**: Minimal Node.js HTTP server for provider endpoints
- **Signed Envelopes**: Returns cryptographically signed Pact protocol envelopes
- **CLI Tools**: Registry management commands for provider registration and discovery

## Quick Start

### Start a Provider Server

```typescript
import { startProviderServer } from "@pact/provider-adapter";
import nacl from "tweetnacl";

const keyPair = nacl.sign.keyPair();
const sellerId = bs58.encode(Buffer.from(keyPair.publicKey));

const server = startProviderServer({
  port: 7777,
  sellerKeyPair: keyPair,
  sellerId,
});

console.log(`Provider server running at ${server.url}`);
```

### Development Identity

⚠️ **DEV-ONLY**: When running the provider server via CLI (`pact-provider start`), it uses a deterministic keypair derived from a fixed seed for development convenience. This allows registry entries to remain valid across server restarts.

**This is NOT suitable for production use.** Production providers must use cryptographically secure random keypairs stored securely.

The default seed `"pact-provider-default-seed-v1"` produces a stable `sellerId` for development. You can override it with `--seed <custom-seed>`.

**Production Warning**: Deterministic identities violate security best practices and should never be used in environments where identity verification matters. See the server source code for detailed warnings.

### Using the CLI

```bash
# Register a provider
pnpm provider-adapter registry:register -- \
  --intent weather.data \
  --pubkey <pubkey_b58> \
  --endpoint http://127.0.0.1:7777  # Replace with actual port if using random port (0)

# List providers
pnpm provider-adapter registry:list -- \
  --intent weather.data \
  --registry ./providers.jsonl
```

## Endpoints

The provider server implements the following endpoints:

- `POST /quote` - Returns a signed ASK envelope
- `POST /commit` - Returns a signed COMMIT envelope
- `POST /reveal` - Returns a signed REVEAL envelope
- `POST /stream/chunk` - Returns a signed STREAM_CHUNK envelope
- `GET /health` - Health check endpoint

All responses are signed Pact protocol envelopes that can be verified by buyers using the SDK.

## Registry Management

The provider adapter includes CLI tools for managing a persistent provider directory:

- **Register**: Add providers to a JSONL registry file
- **List**: List providers for a specific intent type

## License

MIT


