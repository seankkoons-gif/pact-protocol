/**
 * Map @pact/verifier auditor_pack_verify result to viewer IntegrityResult.
 * TAMPERED ⟵ recompute_ok === false; VALID ⟵ recompute_ok === true; INDETERMINATE ⟵ verifier can't compute / ok === false / else.
 * Do not use UNKNOWN or INDETERMINATE_TAMPER.
 */

import type { IntegrityResult } from '../types';
import type { VerifyReport } from '@pact/verifier/core';

// Ensure ?raw import is typed (Vite)
declare const STANDARD_CONSTITUTION_CONTENT: string;

export function verifierReportToIntegrityResult(report: VerifyReport): IntegrityResult {
  let status: IntegrityResult['status'];
  if (report.recompute_ok === false) status = 'TAMPERED';
  else if (report.recompute_ok === true) status = 'VALID';
  else if (report.ok === false) status = 'INDETERMINATE';
  else status = 'INDETERMINATE';

  const checksumFailures = report.mismatches.filter((m) =>
    m.includes('Checksum') || m.includes('checksum')
  );
  const checksums = {
    status: report.checksums_ok ? ('VALID' as const) : ('INVALID' as const),
    checkedCount: 0,
    totalCount: 0,
    failures: checksumFailures,
  };

  return {
    status,
    checksums,
    hashChain: {
      status: report.recompute_ok ? 'VALID' : 'INVALID',
    },
    signatures: {
      status: 'UNVERIFIABLE',
      verifiedCount: 0,
      totalCount: 0,
      failures: [],
    },
    warnings: report.mismatches,
  };
}
