# Pre-Publish Checklist

This document defines the **minimum bar for publishing a PACT release**.

Publishing is not a marketing event.  
It is a **contract with downstream users** that the protocol behaves exactly as described.

Nothing should be published unless *all* checks below are satisfied.

---

## 1. Scope of Publication

Before publishing, be explicit about **what is being promised**.

### This release guarantees:
- Deterministic behavior for all exported APIs
- Stable message schemas for the published version
- Correct negotiation and settlement semantics
- Accurate receipts and reputation accounting

### This release does *not* guarantee:
- Backwards compatibility beyond semver rules
- Production readiness for untrusted environments
- Economic safety beyond protocol invariants

If something is experimental, it must be labeled as such.

---

## 2. Versioning Rules

PACT follows **strict semantic versioning**.

### Version format
`MAJOR.MINOR.PATCH`

### Increment rules
- **PATCH**: Bug fixes only, no behavior changes
- **MINOR**: New features, no breaking changes
- **MAJOR**: Any breaking change to protocol surface or semantics

Breaking changes include:
- Message schema changes
- Different settlement behavior
- Changed error codes
- Modified determinism guarantees

If unsure, bump MAJOR.

---

## 3. Build Requirements

Before publishing, the following **must pass cleanly**:

```bash
pnpm -r build
pnpm -r test
```

**Requirements:**

- No warnings treated as errors
- No skipped test suites
- No environment-specific hacks
- No reliance on unpublished artifacts

Build output must be reproducible on a clean machine.

---

## 4. Clean-Room Verification

Every publish candidate must pass a clean-room install test.

### Required checks
- Install from tarball only (`.tgz`)
- No local workspace references
- No implicit file access outside package boundaries

### Example:

```bash
rm -rf /tmp/pact-cleanroom
mkdir /tmp/pact-cleanroom
cd /tmp/pact-cleanroom

npm init -y
npm install pact-sdk-<version>.tgz pact-provider-adapter-<version>.tgz
```

### Validation
- `import('@pact/sdk')` succeeds
- Public APIs are callable
- CLI binaries execute without syntax errors
- No missing files at runtime (e.g. schemas)

If clean-room fails, do not publish.

---

## 5. Runtime Assets

Any runtime-required assets must be explicitly included.

**Examples:**
- JSON schemas
- Static protocol metadata
- Embedded registries

**Rules:**
- Assets must exist in the published package
- Paths must resolve from `node_modules`
- No reliance on `process.cwd()` assumptions

If an asset is required at runtime, it belongs in `dist/`.

---

## 6. Public API Review

Before publishing, review exactly what is exported.

**Checklist:**
- No accidental internal exports
- No duplicate or conflicting symbols
- No unstable types exposed unintentionally
- Clear separation between protocol and helpers

The public surface should be:
- Minimal
- Intentional
- Documented

If something feels "nice to have," it probably doesn't belong.

---

## 7. Explainability Contract

If explain modes are exposed:

- Output must be deterministic
- Keys must be stable
- Meanings must not change silently

Explainability is part of the protocol contract.
Changing it requires a version bump.

---

## 8. Documentation Completeness

The following files must exist and be accurate:

- `README.md` — what this is and who it's for
- `PROTOCOL.md` — how it works
- `PRE_PUBLISH.md` — this checklist

Docs must match actual behavior.
If code and docs disagree, the code is wrong.

---

## 9. Publish Authorization

Before publishing, explicitly confirm:

- ✅ All tests pass
- ✅ Clean-room test passes
- ✅ Version number is correct
- ✅ No uncommitted changes
- ✅ Release scope is understood

Publishing is irreversible.
Do not rush.

---

## 10. Post-Publish Rules

After publishing:

- Do not modify published artifacts
- Do not republish the same version
- Do not hot-patch behavior

If something is wrong:

- Publish a new version
- Document the change
- Move forward cleanly

---

## 11. Philosophy

PACT values:

- Correctness over speed
- Determinism over convenience
- Explicitness over magic

Publishing means standing behind those values.
