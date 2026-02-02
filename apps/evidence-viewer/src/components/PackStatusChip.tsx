import type { AuditorPackData } from '../types';
import './PackStatusChip.css';

interface PackStatusChipProps {
  fileName: string;
  /** Single source of truth: pack.integrityResult.status drives chip (VALID / TAMPERED / INDETERMINATE). */
  packData: AuditorPackData;
}

export default function PackStatusChip({ fileName, packData }: PackStatusChipProps) {
  const status = packData.integrityResult?.status ?? 'INDETERMINATE';
  const isTampered = status === 'TAMPERED';
  const isValid = status === 'VALID';
  const isIndeterminate = status === 'INDETERMINATE';

  const chipClass = isTampered ? 'tampered' : isValid ? 'valid' : 'indeterminate';
  const statusLabel = isTampered ? 'Tampered' : isValid ? 'Valid' : 'Indeterminate';
  const displayName = fileName.replace(/\.zip$/i, '').replace(/^auditor_pack_/i, '');

  return (
    <div className="pack-status-container">
      <div className="pack-status-row">
        <div className={`pack-status-chip ${chipClass}`}>
          <span className="status-label">Pack:</span>
          <span className="status-file">{displayName}</span>
          <span className="status-integrity">{statusLabel}</span>
        </div>
        {isTampered && (
          <div className="tamper-alert">
            <strong>⚠️ TAMPER DETECTED</strong>
          </div>
        )}
      </div>
      {isIndeterminate && (
        <p className="pack-status-hint">Run CLI to verify</p>
      )}
    </div>
  );
}
