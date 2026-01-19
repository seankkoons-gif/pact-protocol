# Pact Evidence Bundle v4

Protocol Identifier: pact-evidence-bundle/4.0  
Status: Draft (Normative)  
Scope: Structured evidence bundles for Pact v4 arbitration and compliance.

## 1. Design Goals (Normative)

Evidence bundles provide a structured, hash-verifiable format for aggregating evidence used in Pact arbitration and compliance audits.

Evidence bundles MUST:

1. **Hash-Verifiable**: All referenced evidence MUST be hash-verifiable
2. **Deterministic**: Bundle structure MUST be deterministic from inputs
3. **Redactable**: Support redaction for partner/auditor views without invalidating signatures
4. **Legally Admissible**: Structure suitable for legal/regulatory proceedings

## 2. Evidence Bundle Structure

### 2.1 Bundle Contents

An evidence bundle consists of:

1. **Bundle Manifest**: JSON metadata describing bundle contents
2. **Transcript Sections**: Referenced portions of Pact v4 transcript
3. **Receipts**: Settlement receipts, delivery confirmations, SLA records
4. **Policy Artifacts**: Relevant policy sections (referenced by `policy_hash`)
5. **Observer Attestations**: Optional cryptographic signatures from third-party observers

### 2.2 Bundle Manifest

The bundle manifest MUST include:

```json
{
  "bundle_version": "pact-evidence-bundle/4.0",
  "bundle_id": "bundle-<sha256>",
  "transcript_hash": "<transcript_id>",
  "created_at_ms": 1234567890000,
  "entries": [
    {
      "type": "transcript_round",
      "ref": "round_hash",
      "content_hash": "<sha256>"
    },
    {
      "type": "receipt",
      "ref": "receipt_hash",
      "content_hash": "<sha256>"
    },
    {
      "type": "policy_section",
      "ref": "policy_hash",
      "section": "max_price",
      "content_hash": "<sha256>"
    }
  ],
  "signatures": [
    {
      "signer_id": "arbiter-001",
      "signer_pubkey": "<base58>",
      "signature": "<base58>",
      "signed_at_ms": 1234567890000
    }
  ]
}
```

### 2.3 Entry Types

**Transcript Round:**

- `type`: `"transcript_round"`
- `ref`: Round hash from transcript (e.g., `"ea3f6652..."`)
- `content_hash`: SHA-256 hash of canonical JSON serialization of round

**Receipt:**

- `type`: `"receipt"`
- `ref`: Receipt identifier (e.g., `"receipt-stripe-123"`)
- `content_hash`: SHA-256 hash of receipt content

**Policy Section:**

- `type`: `"policy_section"`
- `ref`: Policy hash from transcript `policy_hash`
- `section`: Policy section identifier (e.g., `"max_price"`, `"sla"`)
- `content_hash`: SHA-256 hash of policy section content

**Observer Attestation:**

- `type`: `"observer_attestation"`
- `ref`: Observer identifier (e.g., `"observer-001"`)
- `content_hash`: SHA-256 hash of attestation content
- `attestation`: Full attestation content (signed observation)

## 3. Required Hashes and Signatures

### 3.1 Content Hashes

All evidence bundle entries MUST include `content_hash` computed as:

1. Canonical JSON serialization of entry content (sorted keys, no whitespace)
2. SHA-256 hash of UTF-8 encoded JSON string
3. Hex encoding of hash (lowercase)

### 3.2 Bundle Hash

Bundle manifest MUST include `bundle_id` computed as:

1. Canonical JSON serialization of manifest (excluding `bundle_id` and `signatures` fields)
2. SHA-256 hash of serialized manifest
3. Format: `"bundle-<64-char-hex>"`

### 3.3 Signatures

Evidence bundles MAY include signatures from:

- **Arbiters**: Signing bundle manifest to attest to evidence completeness
- **Observers**: Signing specific attestations within bundle
- **Parties**: Optional signatures from buyer/seller acknowledging evidence

All signatures MUST use:

- Ed25519 signature scheme (or scheme specified in `signature.scheme`)
- Canonical JSON serialization (sorted keys, no whitespace)
- Base58 encoding for public keys and signatures (or hex if specified)

**Signature Scope:**

- **Manifest signatures**: Over canonical serialization of manifest (excluding `signatures` field)
- **Entry signatures**: Over canonical serialization of entry content (if signed individually)
- **Attestation signatures**: Over canonical serialization of attestation content

## 4. Redaction Principles

### 4.1 Redaction Mask

Evidence bundles MAY include a `redaction_mask` indicating which entries are redacted:

```json
{
  "redaction_mask": {
    "entries": [
      {
        "entry_index": 2,
        "redaction_reason": "PII",
        "redacted_hash": "<hash-of-redacted-content>"
      }
    ]
  }
}
```

### 4.2 Partner vs Auditor Views

**Partner View (Redacted):**

- Redacts sensitive information (PII, proprietary pricing, internal logs)
- Preserves hash references (verifiability maintained)
- Includes `redaction_mask` indicating what was redacted

**Auditor View (Unredacted):**

- Full bundle contents
- All signatures intact
- No redaction mask

**Public View (Fully Redacted):**

- Only bundle manifest (metadata)
- All content entries redacted
- Only hash references preserved

### 4.3 Redaction Integrity

Redaction MUST:

1. Preserve bundle hash (manifest structure unchanged)
2. Preserve signature validity (signatures computed pre-redaction)
3. Preserve content hashes (redacted entries replaced with `redacted_hash`)

Redaction MUST NOT:

1. Modify bundle manifest structure (only content)
2. Invalidate signatures (signatures computed on unredacted content)
3. Remove hash references (hashes remain for verification)

## 5. Integration with Arbitration

### 5.1 Evidence Bundle in Decision Artifacts

Decision artifacts reference evidence bundles via `evidence_refs`:

```json
{
  "evidence_refs": [
    {
      "type": "evidence_bundle",
      "bundle_id": "bundle-abc123...",
      "entry_refs": [0, 2, 5]
    }
  ]
}
```

### 5.2 Bundle Validation

Arbiters MUST validate evidence bundles by:

1. Verifying `bundle_id` matches computed hash of manifest
2. Verifying all `content_hash` values match actual entry content
3. Verifying signatures (if present) using signer public keys
4. Verifying `transcript_hash` matches referenced transcript

## 6. Versioning and Stability

This specification is versioned as `pact-evidence-bundle/4.0`.

**Breaking Changes:**

- Bundle manifest schema changes require version bump
- Entry type changes require version bump
- Signature scheme changes require version bump

**Non-Breaking Changes:**

- Additional optional fields in manifest
- New entry types (additive)
- Additional signature schemes (additive)

---

**Status:** Draft - Subject to review and ratification by Pact governance.
