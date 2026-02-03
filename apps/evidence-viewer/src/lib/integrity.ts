import type { AuditorPackData, GCView, InsurerSummary, PackVerifyResultView } from '../types';

/** Warnings and exceptions for display only. Do not affect Integrity verdict. */
export interface WarningsAndExceptions {
  /** Pack integrity warnings (integrityResult.warnings); claimed vs computed mismatch appears here, not as tamper. */
  packIntegrityWarnings: string[];
  /** Legacy: claimed vs computed from pack_verify.mismatches / gc_view when no integrityResult. */
  hashMismatches: string[];
  /** Nonstandard constitution flags (risk factors, surcharges, constitution_warning). */
  nonstandardConstitution: string[];
  /** Missing optional artifacts (pack_verify, merkle digest, replay_verify). */
  missingOptionalArtifacts: string[];
}

/**
 * Integrity status. UNKNOWN may exist as internal state only.
 * UI and PDFs must never show UNKNOWN or INDETERMINATE_TAMPER; use displayIntegrityOrFault / getIntegrityStatusForPack.
 */
export type IntegrityStatus = 'VALID' | 'TAMPERED' | 'INDETERMINATE' | 'UNKNOWN';

/** Subtext for VALID (optional). */
export const INTEGRITY_VALID_SUBTEXT = 'Cryptographic verification passed.';

/** Subtext for TAMPERED. */
export const INTEGRITY_TAMPERED_SUBTEXT =
  'Pack recomputation failed. Do not rely on derived outputs.';

/** Subtext for INDETERMINATE (when verifier could not compute in-browser). */
export const INDETERMINATE_TOOLTIP =
  'Unable to verify in-browser. Run the CLI command above.';

/** Same as INDETERMINATE_TOOLTIP when integrityResult is missing. */
export const INDETERMINATE_VERIFY_VIA_CLI =
  'Unable to verify in-browser. Run the CLI command above.';

/** Warnings box subtext when integrity is VALID and warnings exist (UI + PDFs). */
export const WARNINGS_VALID_SUBTEXT =
  'This pack is cryptographically valid, but contains inconsistencies that may matter for claims.';

/** Invariant: UNKNOWN and INDETERMINATE_TAMPER must never appear in UI or PDFs. */

/**
 * Display value for integrity or fault domain.
 * UI and PDFs: INDETERMINATE only—never INDETERMINATE_TAMPER or UNKNOWN.
 */
export function displayIntegrityOrFault(value: string): string {
  if (value === 'INDETERMINATE_TAMPER' || value === 'UNKNOWN') return 'INDETERMINATE';
  return value;
}

/**
 * Display value for transcript ID. UI and PDFs must never show "UNKNOWN".
 */
export function displayTranscriptId(id: string): string {
  if (!id || id === 'UNKNOWN') return '—';
  return id;
}

/**
 * Top-level integrity from pack_verify only. Strict rules:
 * - recompute_ok === true → VALID
 * - recompute_ok === false → TAMPERED
 * - Verifier could not compute (recompute_ok undefined) → INDETERMINATE
 */
export function integrityFromPackVerify(pv: unknown): IntegrityStatus | null {
  if (!pv || typeof pv !== 'object') return null;
  const r = pv as PackVerifyResultView;
  if (r.recompute_ok === true) return 'VALID';
  if (r.recompute_ok === false) return 'TAMPERED';
  return 'INDETERMINATE';
}

/**
 * Integrity status: pack_verify only. No fallback from gc_view, DBL, or replay.
 * Returns INDETERMINATE (never UNKNOWN) when pack_verify is absent or invalid.
 */
export function getIntegrityStatus(packVerifyResult: unknown): IntegrityStatus {
  const fromPack = integrityFromPackVerify(packVerifyResult);
  return fromPack ?? 'INDETERMINATE';
}

/**
 * Top-level integrity for display: use pack.integrityResult.status (derived from packVerifyResult.recompute_ok).
 * When integrityResult is missing, return INDETERMINATE (never UNKNOWN).
 */
export function getIntegrityStatusForPack(packData: AuditorPackData): IntegrityStatus {
  if (packData.integrityResult?.status != null) {
    return packData.integrityResult.status;
  }
  return 'INDETERMINATE';
}

/**
 * One-line verdict summary for UI and PDFs.
 * Integrity from pack.integrityResult.status; if missing, INDETERMINATE (never UNKNOWN).
 * Format: OUTCOME — Money moved: YES/NO — Judgment: X — Integrity: X — Confidence: 0.xx
 */
export function getVerdictSummaryLine(packData: AuditorPackData): string {
  const { gcView, judgment } = packData;
  const outcome = gcView.executive_summary?.status ?? '—';
  const moneyMoved =
    gcView.executive_summary?.money_moved === true
      ? 'YES'
      : gcView.executive_summary?.money_moved === false
        ? 'NO'
        : '—';
  const judgmentRaw =
    judgment?.dblDetermination ?? gcView.responsibility?.judgment?.fault_domain ?? '—';
  const judgmentDisplay = typeof judgmentRaw === 'string' ? displayIntegrityOrFault(judgmentRaw) : '—';
  const integrityDisplay = displayIntegrityOrFault(getIntegrityStatusForPack(packData));
  const confidence =
    judgment?.confidence != null ? judgment.confidence.toFixed(2) : '—';
  return `${outcome} — Money moved: ${moneyMoved} — Judgment: ${judgmentDisplay} — Integrity: ${integrityDisplay} — Confidence: ${confidence}`;
}

/**
 * Verify command and optional note for CLI (repo-root path for demo packs, <file> placeholder for drag-drop).
 * Only returns commands that work from repo root for demo_public; for drag_drop returns template + note.
 */
export function getVerifyCommand(
  pack: AuditorPackData | null
): { command: string; note?: string } | null {
  if (!pack) return null;
  if (pack.source === 'demo_public' && pack.demoPublicPath) {
    return {
      command: `pact-verifier auditor-pack-verify --zip apps/evidence-viewer/public/${pack.demoPublicPath}`,
    };
  }
  if (pack.source === 'drag_drop') {
    return {
      command: 'pact-verifier auditor-pack-verify --zip <file>',
      note: 'Run from the directory where the ZIP is located, or replace <file> with the full path.',
    };
  }
  return null;
}

/**
 * Warnings list: claimed-vs-computed hash mismatches from pack_verify.mismatches,
 * plus gc_view integrity notes that indicate hash/transcript mismatch (informational).
 * Does not drive integrity status; for display only.
 */
export function getIntegrityWarnings(
  packVerifyResult: unknown,
  gcView: GCView | undefined
): string[] {
  const warnings: string[] = [];
  if (packVerifyResult && typeof packVerifyResult === 'object') {
    const r = packVerifyResult as PackVerifyResultView;
    if (Array.isArray(r.mismatches)) {
      warnings.push(...r.mismatches);
    }
  }
  if (gcView?.integrity?.notes?.length) {
    const hashPatterns = [/final[\s_-]?hash/i, /transcript[\s_-]?hash/i, /hash[\s_-]?mismatch/i, /hash[\s_-]?chain/i];
    for (const note of gcView.integrity.notes) {
      if (hashPatterns.some((p) => p.test(note))) {
        warnings.push(note);
      }
    }
  }
  return warnings;
}

/**
 * Collect all warnings and exceptions for the "Warnings & Exceptions" section.
 * Labels are informational only; they do not affect the Integrity verdict.
 * Prefers integrityResult.warnings when present (packs do not contain pack_verify).
 */
export function getWarningsAndExceptions(
  packVerifyResult: unknown,
  gcView: GCView | undefined,
  insurerSummary: InsurerSummary | undefined,
  hasMerkleDigest: boolean,
  hasReplayVerifyResult: boolean,
  integrityResult?: { warnings?: string[] } | null
): WarningsAndExceptions {
  const packIntegrityWarnings = integrityResult?.warnings ?? [];
  const hashMismatches = integrityResult ? [] : getIntegrityWarnings(packVerifyResult, gcView);

  const nonstandardConstitution: string[] = [];
  if (insurerSummary?.risk_factors?.includes('NON_STANDARD_RULES')) {
    nonstandardConstitution.push('Non-standard rules (risk factor).');
  }
  if (insurerSummary?.surcharges?.includes('NON_STANDARD_CONSTITUTION')) {
    nonstandardConstitution.push('Non-standard constitution (surcharge).');
  }
  if (insurerSummary?.constitution_warning) {
    nonstandardConstitution.push(insurerSummary.constitution_warning);
  }

  const missingOptionalArtifacts: string[] = [];
  if (!integrityResult && (!packVerifyResult || typeof packVerifyResult !== 'object')) {
    missingOptionalArtifacts.push('Pack verification result not present (integrity unknown).');
  }
  if (!hasMerkleDigest) {
    missingOptionalArtifacts.push('Merkle digest not present.');
  }
  if (!hasReplayVerifyResult) {
    missingOptionalArtifacts.push('Replay verification result not present.');
  }

  return { packIntegrityWarnings, hashMismatches, nonstandardConstitution, missingOptionalArtifacts };
}
