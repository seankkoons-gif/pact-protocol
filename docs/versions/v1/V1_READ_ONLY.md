# PACT v1: Read-Only Status

## Status

PACT v1 is **feature-complete and frozen** at tag `v1.7.0-rc6`. v1 will receive no new features, architectural changes, or breaking modifications. Only critical bug fixes and security patches may be applied if required.

## What This Means

- **No new features**: v1's API surface and functionality are locked. New capabilities will be added in v2.
- **No breaking changes**: v1 maintains backward compatibility within the v1 major version (see [V1_CONTRACT.md](./V1_CONTRACT.md)).
- **Critical fixes only**: Only security vulnerabilities or critical bugs that prevent v1 from functioning will be addressed.
- **v2 is an architectural reset**: v2 will break compatibility with v1 APIs. v2 is a new codebase with new primitives (see [versions/v2/ARCHITECTURE.md](../versions/v2/ARCHITECTURE.md)).

## How to Use v1 Safely

### Option 1: Pin to Tag (Recommended)

Pin your dependency to the frozen tag:

```bash
git clone https://github.com/seankkoons-gif/pact_.git
cd pact_
git checkout v1.7.0-rc6
```

This ensures you're using the exact frozen version with no risk of breaking changes.

### Option 2: Track v1.7 Branch

If you need to receive critical fixes (if any are applied), track the `v1.7` branch:

```bash
git checkout v1.7
```

The `v1.7` branch will only receive critical fixes. No new features or breaking changes.

### Package Installation

If v1 packages are published to npm (future), pin to the exact version:

```json
{
  "dependencies": {
    "@pact/sdk": "1.7.0-rc6",
    "@pact/provider-adapter": "1.7.0-rc6"
  }
}
```

## How to Participate in v2

v2 development is active on the `v2` branch. v2 is an architectural reset with:

- **Breaking changes**: v2 APIs are not compatible with v1. Migration guides will be provided.
- **New primitives**: AgentRuntime, NegotiationSession, SettlementGraph, TranscriptStream, PolicyEngineV2 (see [versions/v2/ARCHITECTURE.md](../versions/v2/ARCHITECTURE.md)).
- **Design discussions**: v2 design is evolving. See [versions/v2/GOALS.md](../versions/v2/GOALS.md) and [versions/v2/NON_GOALS.md](../versions/v2/NON_GOALS.md).

To participate:

1. **Review v2 docs**: Read the architecture, goals, and non-goals documents.
2. **Follow v2 branch**: Check out `v2` branch for active development.
3. **Provide feedback**: Design discussions welcome on issues/PRs tagged with `v2`.
4. **Expect breaking changes**: v2 is in active development; APIs will change.

## v1 Resources

- **Documentation**: [getting-started/QUICKSTART.md](../getting-started/QUICKSTART.md), [guides/PROVIDER_GUIDE.md](../guides/PROVIDER_GUIDE.md), [guides/BUYER_GUIDE.md](../guides/BUYER_GUIDE.md)
- **API Contract**: [V1_CONTRACT.md](./V1_CONTRACT.md)
- **Examples**: [examples/](../../examples/)
- **Protocol**: [PROTOCOL.md](../../reference/PROTOCOL.md)

## Summary

v1 is frozen at `v1.7.0-rc6`. Use the tag for stability, or track `v1.7` branch for critical fixes only. v2 is the active development branch with architectural changes and breaking API modifications.



