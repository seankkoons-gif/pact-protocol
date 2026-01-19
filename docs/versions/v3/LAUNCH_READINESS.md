# Pact v3 Launch Readiness Checklist

Pre-publication validation checklist for Pact v3. Complete each section before publishing to npm.

---

## 📦 npm Publishing Checks

### Package Configuration

- [ ] **Version number set correctly**
  - SDK version in `packages/sdk/package.json` matches release tag (e.g., `0.3.0`)
  - Root `package.json` remains `private: true` (not published)
  - All workspace packages have consistent versioning strategy

- [ ] **Package name and scope verified**
  - `@pact/sdk` is the published package name
  - No naming conflicts or typos
  - Scope is configured correctly in `publishConfig`

- [ ] **Entry points configured**
  - `main`, `module`, `types` fields point to correct dist files
  - `exports` field properly maps to dist outputs
  - No broken imports in published package

- [ ] **Files included/excluded**
  - `.npmignore` or `files` array excludes source, tests, examples
  - Only `dist/`, `README.md`, `LICENSE`, `package.json` included
  - Type definitions (`.d.ts`) are generated and included

- [ ] **Optional peer dependencies configured**
  - `stripe` and `snarkjs` marked as optional peer dependencies
  - `peerDependenciesMeta` correctly flags them as optional
  - Installation works without optional deps (boundary mode)

- [ ] **License and metadata**
  - `LICENSE` file included and matches `package.json` license field
  - `repository`, `homepage`, `bugs` URLs are correct
  - `author` and `description` fields are accurate

- [ ] **Build artifacts verified**
  - `pnpm build` produces complete `dist/` directory
  - No TypeScript errors in build output
  - All exports from `src/index.ts` are available in dist

### Publishing Process

- [ ] **Dry-run publish successful**
  ```bash
  cd packages/sdk
  npm publish --dry-run
  ```
  - Verify package contents match expectations
  - Check file sizes (no accidental large files)
  - Confirm no secrets or private keys included

- [ ] **npm registry access**
  - Authenticated to npm with correct account
  - Two-factor authentication enabled
  - Publishing scope (`@pact`) has correct permissions

- [ ] **Pre-publish hooks pass**
  - `prepublishOnly` script runs build and tests
  - No broken imports or missing dependencies
  - Type checking passes

---

## 🔒 API Stability Promises

### Public API Surface

- [ ] **Public exports documented**
  - All exports from `packages/sdk/src/index.ts` are intentional public API
  - No internal implementation details leaked (e.g., `_internal/` paths)
  - `api:snapshot` script captures current API surface

- [ ] **Breaking changes identified**
  - Review `CHANGELOG.md` for all breaking changes
  - Breaking changes are clearly marked and justified
  - Migration path documented for breaking changes

- [ ] **Version compatibility strategy defined**
  - Semantic versioning policy documented (MAJOR.MINOR.PATCH)
  - Breaking changes require MAJOR version bump
  - Backward compatibility guarantees stated (see below)

- [ ] **Type stability**
  - TypeScript types are stable and won't change in patch versions
  - No `any` types in public API (or explicitly documented)
  - Optional parameters are backward compatible

### Stability Guarantees

**v3.0.x (Patch releases):**
- No breaking changes to public API
- Bug fixes and security patches only
- Type signatures remain identical

**v3.x.0 (Minor releases):**
- New features and non-breaking enhancements
- Deprecated APIs marked before removal
- Backward compatible additions only

**v4.0.0 (Major releases):**
- Breaking changes allowed
- Migration guide required
- 6+ month deprecation window for removed features

---

## 📚 Documentation Completeness

### Core Documentation

- [ ] **Getting Started guide**
  - `docs/versions/v3/GETTING_STARTED.md` exists and is current
  - Installation instructions verified
  - Quick start example runs successfully

- [ ] **API documentation**
  - All public functions/classes have JSDoc comments
  - Parameter types and return types documented
  - Usage examples for key APIs (`acquire()`, `createDefaultPolicy()`, etc.)

- [ ] **Release Notes**
  - `docs/versions/v3/RELEASE_NOTES.md` summarizes v3 features
  - "What's New", "What's Optional", "What's Experimental" sections clear
  - Links to examples and detailed docs

- [ ] **Pick Your Path guide**
  - `docs/versions/v3/PICK_YOUR_PATH.md` helps developers choose adoption path
  - Code snippets are accurate and runnable
  - Links to full examples are valid

### Integration Guides

- [ ] **Stripe integration**
  - `docs/integrations/INTEGRATION_STRIPE_LIVE.md` documents Stripe settlement
  - Configuration examples work
  - Optional dependency installation instructions clear

- [ ] **ZK-KYA integration**
  - `docs/integrations/INTEGRATION_ZK_KYA.md` documents ZK proof verification
  - External integration interface documented
  - Optional dependency handling explained

- [ ] **Escrow integration**
  - `docs/integrations/INTEGRATION_ESCROW.md` documents EVM escrow contract
  - Security features (ReentrancyGuard, authorization) documented
  - Separate package status clarified

### Reference Documentation

- [ ] **Documentation index**
  - `docs/DOCUMENTATION_INDEX.md` lists all docs
  - Links are correct and up-to-date
  - Documentation is organized by user journey

- [ ] **Error handling guide**
  - `docs/architecture/ERROR_HANDLING.md` covers common error scenarios
  - Retry logic and error recovery documented
  - Network failure handling explained

- [ ] **Performance guide**
  - `docs/architecture/PERFORMANCE.md` covers optimization strategies
  - Memory and network considerations documented
  - Benchmarking guidelines provided

### README Files

- [ ] **Root README.md**
  - Links to v3 documentation
  - Example commands work (`pnpm example:v3:01`, etc.)
  - Installation instructions for monorepo vs npm package clarified

- [ ] **Package README (if published)**
  - SDK package README explains core usage
  - Examples are minimal and clear
  - Links to full documentation

---

## 🛡️ Security Posture

### Security Documentation

- [ ] **Threat model**
  - `docs/SECURITY_THREAT_MODEL.md` covers all attack vectors
  - Trust assumptions clearly stated
  - Known non-goals explicitly listed

- [ ] **Security checklist**
  - `docs/SECURITY_CHECKLIST.md` (if exists) reviewed
  - All security mitigations verified
  - No known critical vulnerabilities

### Code Security

- [ ] **Secret scanning**
  - `pnpm secret:scan` passes with no secrets detected
  - No API keys, private keys, or tokens in codebase
  - Environment variables used for sensitive config

- [ ] **Dependency vulnerabilities**
  - `pnpm audit` run and critical/high vulnerabilities addressed
  - All dependencies are up-to-date or pinned for security
  - Optional dependencies (stripe, snarkjs) don't introduce vulnerabilities

- [ ] **Cryptographic security**
  - Ed25519 signatures verified correctly
  - Message hashing is deterministic and secure
  - No weak cryptographic primitives used

- [ ] **Escrow contract security**
  - ReentrancyGuard implemented and tested
  - Slash authorization model tested
  - Events emitted for all state changes
  - Zero address checks in place

### Security Guarantees

**v3.0.0 Security Commitments:**
- Critical security vulnerabilities patched within 48 hours
- Security advisories published for known issues
- Security contact documented (e.g., security@ email)

---

## 🎯 Example Coverage

### Core Examples

- [ ] **Basic negotiation** (`examples/v3/01-basic-negotiation.ts`)
  - Runs successfully: `pnpm example:v3:01`
  - Demonstrates negotiation without settlement
  - Transcript generation verified

- [ ] **Wallet + escrow boundary** (`examples/v3/02-wallet-escrow-boundary.ts`)
  - Runs successfully: `pnpm example:v3:02`
  - Demonstrates execution boundary
  - Mock escrow integration shown

- [ ] **ML-assisted negotiation** (`examples/v3/03-ml-assisted-negotiation.ts`)
  - Runs successfully: `pnpm example:v3:03`
  - Demonstrates ML scorer integration
  - Training data export verified

### Integration Examples

- [ ] **Stripe integration** (`examples/v3/04-stripe-integration.ts`)
  - Runs successfully with optional deps: `pnpm example:v3:04`
  - Falls back gracefully without stripe package
  - Real Stripe integration demonstrated (sandbox mode)

- [ ] **ZK-KYA verification** (`examples/v3/05-zk-kya-verification.ts`)
  - Runs successfully with optional deps: `pnpm example:v3:05`
  - Falls back gracefully without snarkjs package
  - ZK proof verification demonstrated

- [ ] **Multi-provider marketplace** (`examples/v3/06-weather-api-agent.ts`)
  - Runs successfully: `pnpm example:v3:06`
  - Demonstrates provider selection and comparison
  - Real-world use case validated

### Quick Start

- [ ] **Quickstart demo** (`examples/v3/quickstart-demo.ts`)
  - Runs successfully: `pnpm demo:v3:quickstart`
  - End-to-end negotiation + transcript demo
  - No optional dependencies required

### Provider Templates

- [ ] **Express provider template**
  - `examples/express-provider/` demonstrates Express integration
  - README explains request/response flow
  - Code is minimal and understandable

- [ ] **Cloudflare Worker template**
  - `examples/cloudflare-worker-provider/` demonstrates edge deployment
  - Stateless design explained
  - Settlement delegation pattern shown

- [ ] **create-pact-provider CLI**
  - `packages/create-pact-provider/` generates provider scaffold
  - CLI works with pnpm, npm, yarn
  - Generated project is runnable and documented

---

## ✅ CI Status

### Continuous Integration

- [ ] **CI pipeline passes**
  - GitHub Actions workflow (`.github/workflows/ci.yml`) green
  - All matrix jobs pass (with/without optional deps)
  - No flaky tests

- [ ] **Test coverage**
  - All unit tests pass: `pnpm test`
  - Integration tests pass
  - Test coverage is reasonable (>70% for core paths)

- [ ] **Build verification**
  - TypeScript compilation succeeds: `pnpm build`
  - No type errors in public API
  - All packages build successfully

- [ ] **API surface checks**
  - `pnpm api:check` passes (no accidental API changes)
  - API snapshot matches expected surface
  - Breaking changes intentionally documented

- [ ] **Release gate passes**
  - `pnpm release:gate` succeeds
  - Transcript sanitization checks pass
  - No blocking issues identified

### Pre-Publish Verification

- [ ] **Release scripts verified**
  - `pnpm release:gate` script works
  - All pre-publish checks automated
  - No manual steps required that could be missed

- [ ] **Optional dependency matrix**
  - CI tests with `optional-deps: false` (boundary mode)
  - CI tests with `optional-deps: true` (full features)
  - Both paths pass successfully

---

## 🔄 Backward Compatibility Guarantees

### Protocol Version Compatibility

- [ ] **Protocol version stability**
  - `protocol_version: "pact/1.0"` is stable
  - No breaking changes to message schemas in v3
  - Old transcripts remain replayable

- [ ] **Message format compatibility**
  - INTENT, BID, ASK, ACCEPT, REJECT messages unchanged
  - New optional fields are backward compatible
  - Old clients can still negotiate with v3 providers

### SDK Version Compatibility

- [ ] **v2 to v3 migration path**
  - Migration guide documents breaking changes (if any)
  - Deprecated APIs marked before removal
  - Gradual migration path available

- [ ] **API deprecation policy**
  - Deprecated APIs marked with JSDoc `@deprecated`
  - Deprecation warnings in console for deprecated usage
  - Minimum 6-month deprecation window before removal

### Data Format Compatibility

- [ ] **Transcript format**
  - Transcript schema (TranscriptV1) is stable
  - Old transcripts can be replayed with v3 SDK
  - New transcript fields are optional

- [ ] **Policy format**
  - Policy JSON schema is backward compatible
  - Old policies work with v3 SDK
  - New policy fields are optional

---

## 🚀 Final Pre-Launch Checklist

### Last-Minute Verification

- [ ] **All examples run successfully**
  ```bash
  pnpm example:v3:01
  pnpm example:v3:02
  pnpm example:v3:03
  pnpm example:v3:04
  pnpm example:v3:05
  pnpm example:v3:06
  pnpm demo:v3:quickstart
  ```

- [ ] **Documentation links verified**
  - All internal doc links work
  - All external links (if any) are valid
  - Code examples in docs match actual code

- [ ] **Changelog updated**
  - `CHANGELOG.md` includes v3 release notes
  - All breaking changes documented
  - Migration instructions provided

- [ ] **Release tag prepared**
  - Git tag for release version (e.g., `v3.0.0`)
  - Tag message includes release notes summary
  - Tag signed (if using signed tags)

- [ ] **Communication plan**
  - Announcement prepared (blog post, Twitter, etc.)
  - Release notes ready for public consumption
  - Support channels ready for questions

### Launch Command

Once all items are checked, publish with:

```bash
# 1. Final verification
pnpm build
pnpm test
pnpm release:gate

# 2. Publish SDK
cd packages/sdk
npm publish --access public

# 3. Tag release
git tag v3.0.0
git push origin v3.0.0
```

---

## 📋 Sign-Off

- [ ] **Technical lead approval**
  - Code review complete
  - Security review complete
  - Architecture decisions documented

- [ ] **Documentation review**
  - All docs reviewed for accuracy
  - Examples verified as runnable
  - No outdated information

- [ ] **Product approval**
  - Feature set matches v3 goals
  - Breaking changes acceptable
  - Release timing appropriate

---

**Last Updated:** January 2026  
**Next Review:** Before v3.1.0 release
