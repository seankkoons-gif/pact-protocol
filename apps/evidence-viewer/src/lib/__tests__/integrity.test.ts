import { describe, it, expect } from 'vitest';
import {
  integrityFromPackVerify,
  getIntegrityStatus,
  getIntegrityStatusForPack,
  getIntegrityWarnings,
  getWarningsAndExceptions,
  displayIntegrityOrFault,
  INDETERMINATE_TOOLTIP,
} from '../integrity';
import type { GCView, InsurerSummary, PackVerifyResultView, AuditorPackData } from '../../types';

/**
 * Integrity is derived ONLY from pack_verify (auditor pack verification).
 * - recompute_ok === true → VALID
 * - recompute_ok === false → TAMPERED
 * - Verifier could not compute (recompute_ok undefined) → INDETERMINATE
 */

const PACK_VERIFY_VALID: PackVerifyResultView = {
  ok: true,
  recompute_ok: true,
  checksums_ok: true,
  mismatches: [],
};

const PACK_VERIFY_TAMPERED: PackVerifyResultView = {
  ok: false,
  recompute_ok: false,
  checksums_ok: false,
  mismatches: ['derived/gc_view.json mismatch after canonicalization (...)'],
};

const PACK_VERIFY_INDETERMINATE: PackVerifyResultView = {
  ok: false,
  recompute_ok: true,
  checksums_ok: true,
  mismatches: ['Claimed transcript hash mismatch: final_hash does not match'],
};

const PACK_VERIFY_HASH_MISMATCH_BUT_RECOMPUTE_OK: PackVerifyResultView = {
  ok: false,
  recompute_ok: true,
  checksums_ok: false,
  mismatches: ['final_hash mismatch', 'checksum mismatch for manifest.json'],
};

const PACK_VERIFY_UNKNOWN: PackVerifyResultView = {
  ok: true,
  recompute_ok: undefined,
  checksums_ok: true,
  mismatches: [],
};

const gcViewHashMismatch: GCView = {
  version: 'gc_view/1.0',
  executive_summary: { status: 'COMPLETED', what_happened: '', money_moved: true, final_outcome: '', settlement_attempted: true },
  integrity: {
    hash_chain: 'VALID',
    signatures_verified: { verified: 3, total: 3 },
    final_hash_validation: 'MISMATCH',
    notes: ['Claimed final_hash does not match computed'],
  },
  responsibility: { last_valid_signed_hash: '', blame_explanation: '' },
  constitution: { version: 'v1', hash: '', rules_applied: [] },
};

describe('integrityFromPackVerify', () => {
  it('returns VALID when recompute_ok === true', () => {
    expect(integrityFromPackVerify(PACK_VERIFY_VALID)).toBe('VALID');
  });

  it('returns TAMPERED when recompute_ok === false', () => {
    expect(integrityFromPackVerify(PACK_VERIFY_TAMPERED)).toBe('TAMPERED');
  });

  it('returns VALID when recompute_ok === true (warnings do not alter integrity)', () => {
    expect(integrityFromPackVerify(PACK_VERIFY_INDETERMINATE)).toBe('VALID');
    expect(integrityFromPackVerify(PACK_VERIFY_HASH_MISMATCH_BUT_RECOMPUTE_OK)).toBe('VALID');
  });

  it('returns INDETERMINATE when recompute_ok is undefined (verifier could not compute)', () => {
    expect(integrityFromPackVerify(PACK_VERIFY_UNKNOWN)).toBe('INDETERMINATE');
  });

  it('returns null when pack_verify is missing or not an object', () => {
    expect(integrityFromPackVerify(null)).toBe(null);
    expect(integrityFromPackVerify(undefined)).toBe(null);
  });

  it('returns INDETERMINATE for empty or invalid object (no recompute_ok)', () => {
    expect(integrityFromPackVerify({})).toBe('INDETERMINATE');
  });
});

describe('getIntegrityStatus', () => {
  it('returns status from pack_verify when present', () => {
    expect(getIntegrityStatus(PACK_VERIFY_VALID)).toBe('VALID');
    expect(getIntegrityStatus(PACK_VERIFY_TAMPERED)).toBe('TAMPERED');
    expect(getIntegrityStatus(PACK_VERIFY_INDETERMINATE)).toBe('VALID');
    expect(getIntegrityStatus(PACK_VERIFY_UNKNOWN)).toBe('INDETERMINATE');
  });

  it('returns INDETERMINATE when pack_verify absent or invalid (never UNKNOWN)', () => {
    expect(getIntegrityStatus(null)).toBe('INDETERMINATE');
    expect(getIntegrityStatus(undefined)).toBe('INDETERMINATE');
    expect(getIntegrityStatus({})).toBe('INDETERMINATE');
    expect(getIntegrityStatus(gcViewHashMismatch)).toBe('INDETERMINATE');
  });
});

describe('getIntegrityWarnings', () => {
  it('returns pack_verify.mismatches when present', () => {
    expect(getIntegrityWarnings(PACK_VERIFY_INDETERMINATE, undefined)).toEqual([
      'Claimed transcript hash mismatch: final_hash does not match',
    ]);
    expect(getIntegrityWarnings(PACK_VERIFY_HASH_MISMATCH_BUT_RECOMPUTE_OK, undefined)).toEqual([
      'final_hash mismatch',
      'checksum mismatch for manifest.json',
    ]);
  });

  it('includes gc_view integrity notes that indicate hash/transcript mismatch', () => {
    const warnings = getIntegrityWarnings(PACK_VERIFY_VALID, gcViewHashMismatch);
    expect(warnings).toContain('Claimed final_hash does not match computed');
  });

  it('returns empty array when no mismatches or hash notes', () => {
    const gcMatch: GCView = {
      ...gcViewHashMismatch,
      integrity: { ...gcViewHashMismatch.integrity, final_hash_validation: 'MATCH', notes: [] },
    };
    expect(getIntegrityWarnings(PACK_VERIFY_VALID, gcMatch)).toEqual([]);
    expect(getIntegrityWarnings(null, undefined)).toEqual([]);
  });
});

describe('integrity mapping (fixture JSON)', () => {
  it('VALID from pack_verify_valid.json', async () => {
    const fixture = await import('../__fixtures__/pack_verify_valid.json');
    expect(integrityFromPackVerify(fixture.default)).toBe('VALID');
  });

  it('TAMPERED from pack_verify_tampered.json', async () => {
    const fixture = await import('../__fixtures__/pack_verify_tampered.json');
    expect(integrityFromPackVerify(fixture.default)).toBe('TAMPERED');
  });

  it('VALID from pack_verify_indeterminate_hash_mismatch.json (recompute_ok true; warnings do not alter integrity)', async () => {
    const fixture = await import('../__fixtures__/pack_verify_indeterminate_hash_mismatch.json');
    expect(integrityFromPackVerify(fixture.default)).toBe('VALID');
    expect(getIntegrityWarnings(fixture.default, undefined)).toEqual([
      'Claimed transcript hash mismatch: final_hash does not match',
    ]);
  });
});

describe('getWarningsAndExceptions', () => {
  const insurerWithNonStandard: InsurerSummary = {
    version: 'insurer/1.0',
    coverage: 'COVERED',
    risk_factors: ['NON_STANDARD_RULES'],
    surcharges: ['NON_STANDARD_CONSTITUTION'],
    constitution_warning: 'Custom constitution in use.',
  };

  it('returns hash mismatches from pack_verify and gc_view when no integrityResult', () => {
    const wa = getWarningsAndExceptions(PACK_VERIFY_INDETERMINATE, undefined, undefined, true, true);
    expect(wa.packIntegrityWarnings).toEqual([]);
    expect(wa.hashMismatches).toEqual(['Claimed transcript hash mismatch: final_hash does not match']);
    expect(wa.nonstandardConstitution).toEqual([]);
    expect(wa.missingOptionalArtifacts).toEqual([]);
  });

  it('returns nonstandard constitution from insurer summary', () => {
    const wa = getWarningsAndExceptions(PACK_VERIFY_VALID, undefined, insurerWithNonStandard, true, true);
    expect(wa.packIntegrityWarnings).toEqual([]);
    expect(wa.hashMismatches).toEqual([]);
    expect(wa.nonstandardConstitution).toContain('Non-standard rules (risk factor).');
    expect(wa.nonstandardConstitution).toContain('Non-standard constitution (surcharge).');
    expect(wa.nonstandardConstitution).toContain('Custom constitution in use.');
    expect(wa.missingOptionalArtifacts).toEqual([]);
  });

  it('returns missing optional artifacts when absent', () => {
    const wa = getWarningsAndExceptions(null, undefined, undefined, false, false);
    expect(wa.packIntegrityWarnings).toEqual([]);
    expect(wa.hashMismatches).toEqual([]);
    expect(wa.nonstandardConstitution).toEqual([]);
    expect(wa.missingOptionalArtifacts).toContain('Pack verification result not present (integrity unknown).');
    expect(wa.missingOptionalArtifacts).toContain('Merkle digest not present.');
    expect(wa.missingOptionalArtifacts).toContain('Replay verification result not present.');
  });
});

describe('displayIntegrityOrFault and INDETERMINATE_TOOLTIP', () => {
  it('normalizes INDETERMINATE_TAMPER and UNKNOWN to INDETERMINATE for display', () => {
    expect(displayIntegrityOrFault('INDETERMINATE_TAMPER')).toBe('INDETERMINATE');
    expect(displayIntegrityOrFault('INDETERMINATE')).toBe('INDETERMINATE');
    expect(displayIntegrityOrFault('UNKNOWN')).toBe('INDETERMINATE');
    expect(displayIntegrityOrFault('VALID')).toBe('VALID');
    expect(displayIntegrityOrFault('TAMPERED')).toBe('TAMPERED');
  });

  it('INDETERMINATE_TOOLTIP explains verify via CLI', () => {
    expect(INDETERMINATE_TOOLTIP).toBe('Unable to verify in-browser. Run the CLI command above.');
  });
});

describe('getIntegrityStatusForPack', () => {
  it('uses pack.integrityResult.status when present', () => {
    const packWithValid = { integrityResult: { status: 'VALID' as const } } as AuditorPackData;
    expect(getIntegrityStatusForPack(packWithValid)).toBe('VALID');
    const packWithTampered = { integrityResult: { status: 'TAMPERED' as const } } as AuditorPackData;
    expect(getIntegrityStatusForPack(packWithTampered)).toBe('TAMPERED');
  });

  it('returns INDETERMINATE when integrityResult is missing (never UNKNOWN in UI)', () => {
    const packNoIntegrity = {} as AuditorPackData;
    expect(getIntegrityStatusForPack(packNoIntegrity)).toBe('INDETERMINATE');
  });
});
