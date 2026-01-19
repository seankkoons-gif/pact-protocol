# npm Publishing Guide

This guide explains how to publish PACT packages to npm.

## Overview

PACT publishes two packages to npm:
- `@pact/sdk` - Main SDK package (v0.1.0)
- `@pact/provider-adapter` - Provider server adapter (v0.1.0)

Both packages are configured for public access and ready for publishing.

## Prerequisites

Before publishing, ensure you have:

1. **npm account** with access to `@pact` organization (or publish to your own scope)
2. **npm authentication** configured (`npm login` or `.npmrc` with token)
3. **All tests passing** (`pnpm release:gate`)
4. **Clean git state** (all changes committed)
5. **Version bumped** (if needed, using `changeset`)

## Pre-Publish Checklist

Run the complete release gate to verify everything is ready:

```bash
# 1. Run full release gate (builds, tests, examples, transcripts)
pnpm release:gate

# 2. Check API surface matches snapshot
pnpm api:check

# 3. Verify packages can be packed
pnpm pack:check

# 4. Test all examples
pnpm examples:all

# 5. Verify transcripts (strict mode)
pnpm replay:verify:strict-terminal
```

If all checks pass, you're ready to publish.

## Publishing Process

### Step 1: Build Packages

```bash
# Build both packages
pnpm build

# Verify dist/ directories exist and are populated
ls -la packages/sdk/dist/
ls -la packages/provider-adapter/dist/
```

### Step 2: Verify Package Contents

Each package's `files` field specifies what gets published:

**@pact/sdk:**
- `dist/` - Built JavaScript and TypeScript definitions
- `README.md` - Package documentation
- `LICENSE` - License file

**@pact/provider-adapter:**
- `dist/` - Built JavaScript and TypeScript definitions
- `README.md` - Package documentation
- `LICENSE` - License file

Verify these files exist before publishing.

### Step 3: Check Package Configuration

Verify `package.json` for both packages:

```bash
# Check SDK package.json
cat packages/sdk/package.json | grep -A 5 '"name"\|"version"\|"private"\|"publishConfig"'

# Check provider-adapter package.json
cat packages/provider-adapter/package.json | grep -A 5 '"name"\|"version"\|"private"\|"publishConfig"'
```

Expected:
- `"private": false`
- `"publishConfig": { "access": "public" }`
- `"version": "0.1.0"` (or desired version)

### Step 4: Authenticate with npm

```bash
# Login to npm (if not already authenticated)
npm login

# Verify authentication
npm whoami
```

### Step 5: Publish Packages

**Option A: Publish Both Packages (Recommended)**

```bash
# Publish SDK first
pnpm -C packages/sdk publish

# Publish provider-adapter second
pnpm -C packages/provider-adapter publish
```

**Option B: Publish Individually with Version Bump**

```bash
# Publish SDK with specific version
cd packages/sdk
npm version patch  # or minor, major
npm publish
cd ../..

# Publish provider-adapter with same version
cd packages/provider-adapter
npm version patch  # or minor, major
npm publish
cd ../..
```

### Step 6: Verify Published Packages

```bash
# Check SDK package
npm view @pact/sdk

# Check provider-adapter package
npm view @pact/provider-adapter

# Install and verify
npm install @pact/sdk @pact/provider-adapter
```

## Post-Publish Steps

### 1. Update Documentation

Update `docs/DISTRIBUTION.md` to reflect published status:

```markdown
**Note:** Packages are now available on npm:
- `npm install @pact/sdk`
- `npm install @pact/provider-adapter`
```

### 2. Update README

Update main `README.md` with npm installation instructions:

```markdown
## Installation

```bash
npm install @pact/sdk @pact/provider-adapter
# or
pnpm add @pact/sdk @pact/provider-adapter
```
```

### 3. Create Release Notes

Document what's included in this release:
- New features
- Bug fixes
- Breaking changes
- Migration guide (if needed)

### 4. Tag Git Release

```bash
# Create git tag for this release
git tag -a v0.1.0 -m "Release v0.1.0"
git push origin v0.1.0
```

## Version Management

### Using Changesets (Recommended)

PACT uses `changeset` for version management:

```bash
# Create changeset for changes
pnpm changeset

# Bump versions based on changesets
pnpm version-packages

# Publish (this also publishes to npm if configured)
pnpm release
```

### Manual Version Bump

If not using changesets:

```bash
# Update version in package.json
# Then publish
pnpm -C packages/sdk publish
pnpm -C packages/provider-adapter publish
```

## Troubleshooting

### "Package name already exists"

If package already exists on npm:
- Check if you have access to `@pact` organization
- Verify version isn't already published
- Use a new version number

### "Insufficient permissions"

If you get permission errors:
- Verify npm authentication: `npm whoami`
- Check if you have access to `@pact` scope
- Ensure `.npmrc` is configured correctly

### "Missing files in package"

If files are missing:
- Verify `files` field in `package.json`
- Check `dist/` directory exists and is built
- Run `pnpm build` again

### "TypeScript types missing"

If types aren't included:
- Verify `types` field in `package.json`
- Check `dist/index.d.ts` exists
- Ensure `tsup` generated `.d.ts` files

## Dry Run (Testing Without Publishing)

Test publishing without actually publishing:

```bash
# Pack SDK (creates .tgz file locally)
cd packages/sdk
npm pack
# Inspect .tgz file contents
tar -tzf pact-sdk-0.1.0.tgz
cd ../..

# Pack provider-adapter
cd packages/provider-adapter
npm pack
# Inspect .tgz file contents
tar -tzf pact-provider-adapter-0.1.0.tgz
cd ../..
```

## Unpublishing (Emergency Only)

⚠️ **Warning**: Unpublishing should only be done in emergencies and within 72 hours of publishing.

```bash
# Unpublish specific version
npm unpublish @pact/sdk@0.1.0

# Unpublish entire package (requires special npm support)
# Contact npm support for this
```

## Best Practices

1. **Always run release gate** before publishing
2. **Test packed packages** locally before publishing
3. **Use semantic versioning** (major.minor.patch)
4. **Document breaking changes** in release notes
5. **Tag git releases** for easy reference
6. **Never publish** from local machine (use CI/CD if possible)

## CI/CD Integration (Future)

For automated publishing, set up CI/CD:

```yaml
# Example GitHub Actions workflow
name: Publish
on:
  release:
    types: [created]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: pnpm/action-setup@v2
      - uses: actions/setup-node@v3
        with:
          registry-url: 'https://registry.npmjs.org'
      - run: pnpm install
      - run: pnpm release:gate
      - run: pnpm -C packages/sdk publish
      - run: pnpm -C packages/provider-adapter publish
```

---

**Status**: Packages are ready for publishing. Follow this guide when ready to publish to npm.
