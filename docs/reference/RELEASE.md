# RELEASE.md

This document defines how PACT versions are released, what guarantees are provided, and how consumers should reason about upgrades.

PACT follows **semantic versioning**, but with stricter discipline around protocol behavior than typical libraries.

---

## Versioning Policy

PACT uses **SemVer**: `MAJOR.MINOR.PATCH`

### MAJOR (`X.0.0`)
A major version indicates a **protocol-level breaking change**.

This includes:
- Changes to message semantics
- Changes to settlement guarantees
- Changes that invalidate previously valid receipts
- Changes that alter deterministic outcomes for the same inputs

**Upgrading a major version may require coordination across agents.**

---

### MINOR (`0.Y.0`)
A minor version indicates **backward-compatible feature additions**.

This includes:
- New settlement modes
- New optional fields
- New explanation metadata
- Additional helper APIs
- New CLI commands

Existing integrations should continue to function unchanged.

---

### PATCH (`0.0.Z`)
A patch version indicates **bug fixes only**.

This includes:
- Incorrect behavior relative to the documented protocol
- Determinism bugs
- Performance improvements
- Test coverage improvements
- Documentation corrections

Patch releases must not change externally observable behavior except to fix a bug.

---

## Stability Guarantees

### What Is Guaranteed

For a given major version:

- Message schemas are stable
- Settlement semantics are stable
- Receipts are comparable across versions
- Deterministic execution is preserved
- Explainability output is additive only

If two agents run compatible versions, they will agree on outcomes.

---

### What Is Not Guaranteed

- Internal function signatures
- Internal file layout
- Private helper APIs
- CLI output formatting (unless documented)

Consumers should treat undocumented APIs as unstable.

---

## Release Process

Every release must satisfy the following:

1. **All tests pass**
   ```bash
   pnpm -r test
   ```

2. **Clean build artifacts**
   ```bash
   pnpm -r build
   ```

3. **Pack validation**
   ```bash
   pnpm -C packages/sdk pack
   pnpm -C packages/provider-adapter pack
   ```

4. **Clean-room install verification**
   - Install tarballs into a fresh directory
   - Import `@pact/sdk`
   - Run `pact-provider --help`

5. **Documentation consistency**
   - `README.md` matches behavior
   - `PROTOCOL.md` reflects actual semantics
   - `PRE_PUBLISH.md` checklist is complete

A release that does not meet all criteria should not be published.

---

## Changelog Discipline

Each release should be accompanied by a concise changelog entry:

- **Added** — new features
- **Fixed** — bug fixes
- **Changed** — behavior changes (minor only)
- **Deprecated** — features slated for removal

Breaking changes must be clearly marked and justified.

---

## Deprecation Policy

Deprecated features:

- Remain supported for at least one MINOR release
- Are documented with migration guidance
- Are removed only in MAJOR releases

Silent removal is not permitted.

---

## Emergency Releases

If a critical bug compromises:

- Settlement correctness
- Determinism
- Security guarantees

A PATCH release may be issued immediately, but must still:

- Include tests reproducing the issue
- Include a clear explanation of impact

---

## Trust Model

PACT releases are intended to be:

- Auditable
- Reproducible
- Deterministic

Users should be able to:

- Inspect the source
- Rebuild artifacts
- Verify behavior independently

If a release violates these properties, it should be considered invalid.




