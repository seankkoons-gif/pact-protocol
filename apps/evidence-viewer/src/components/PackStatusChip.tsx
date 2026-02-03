import type { AuditorPackData } from '../types';

interface PackStatusChipProps {
  fileName: string;
  packData: AuditorPackData;
}

export default function PackStatusChip({ fileName, packData }: PackStatusChipProps) {
  const status = packData.integrityResult?.status ?? 'INDETERMINATE';

  const getStatusClass = () => {
    if (status === 'VALID') return 'status-valid';
    if (status === 'TAMPERED') return 'status-invalid';
    return 'status-indeterminate';
  };

  const getBadgeLabel = () => {
    if (status === 'VALID') return 'Valid';
    if (status === 'TAMPERED') return 'Tampered';
    return 'Indeterminate';
  };

  const displayName = fileName.replace(/\.zip$/i, '').replace(/_/g, '_');

  return (
    <div className="pack-status-chip">
      <span className={`chip-badge ${getStatusClass()}`}>
        {getBadgeLabel()}
      </span>
      {status === 'TAMPERED' && (
        <span className="chip-tamper-note status-invalid">Tamper detected</span>
      )}
      <span className="chip-filename">{displayName}</span>
    </div>
  );
}
