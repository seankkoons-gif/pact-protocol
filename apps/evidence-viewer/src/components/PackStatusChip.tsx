import type { AuditorPackData } from '../types';

interface PackStatusChipProps {
  fileName: string;
  packData: AuditorPackData;
}

export default function PackStatusChip({ fileName, packData }: PackStatusChipProps) {
  const status = packData.integrityResult?.status ?? 'INDETERMINATE';
  const ok = (packData.packVerifyResult as { ok?: boolean })?.ok;

  const getStatusClass = () => {
    if (ok === true) return 'status-valid';
    if (ok === false) return 'status-invalid';
    if (status === 'VALID') return 'status-valid';
    if (status === 'TAMPERED') return 'status-invalid';
    return 'status-indeterminate';
  };

  const displayName = fileName.replace(/\.zip$/i, '').replace(/_/g, '_');

  return (
    <div className="pack-status-chip">
      <span className={`chip-badge ${getStatusClass()}`}>
        {ok === true || status === 'VALID' ? 'Verified' : ok === false || status === 'TAMPERED' ? 'Tampered/Failed' : 'Unverified'}
      </span>
      <span className="chip-filename">{displayName}</span>
    </div>
  );
}
