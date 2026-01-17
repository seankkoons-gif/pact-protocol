# create-pact-provider

Scaffolding tool for creating minimal Pact v3 provider projects.

## Usage

```bash
npx create-pact-provider my-provider
# or
pnpm create-pact-provider my-provider
# or
yarn create-pact-provider my-provider
```

## What It Generates

A minimal Pact v3 provider project (~275 LOC) with:

- **`src/index.ts`** - HTTP server entrypoint (Provider logic)
- **`src/handler.ts`** - Pact protocol handler (Pact logic)
- **`src/policy.ts`** - Negotiation policy configuration
- **`src/settlement.ts`** - Settlement adapter stub
- **`src/kya.ts`** - KYA verification stub
- **`README.md`** - 5-minute setup guide
- **`package.json`** - Dependencies and scripts
- **`tsconfig.json`** - TypeScript configuration

## Features

- ✅ Single HTTP endpoint (`/pact`)
- ✅ Health check endpoint (`/health`)
- ✅ Clear separation: Provider logic vs Pact logic
- ✅ Transcript support ready
- ✅ Works with npm, pnpm, or yarn
- ✅ Minimal (~275 LOC total)
- ✅ No databases or auth frameworks

## Generated Project Structure

```
my-provider/
├── src/
│   ├── index.ts       # Provider HTTP server
│   ├── handler.ts     # Pact protocol handler
│   ├── policy.ts      # Negotiation policy
│   ├── settlement.ts  # Settlement adapter (stub)
│   └── kya.ts         # KYA verification (stub)
├── package.json
├── tsconfig.json
└── README.md
```

## Quick Start

1. Generate project:
   ```bash
   npx create-pact-provider my-provider
   ```

2. Start provider:
   ```bash
   cd my-provider
   npm run dev
   ```

3. Test health check:
   ```bash
   curl http://localhost:3000/health
   ```

## Customization

After generation:

1. **Update provider capabilities** in `src/handler.ts`
2. **Configure negotiation policy** in `src/policy.ts`
3. **Implement settlement logic** in `src/settlement.ts`
4. **Add KYA verification** in `src/kya.ts`

## Design Principles

- **Provider logic** (HTTP, routing) separate from **Pact logic** (protocol handling)
- Uses `@pact/sdk` for all protocol operations
- No duplication of negotiation logic
- Minimal, production-ready structure
