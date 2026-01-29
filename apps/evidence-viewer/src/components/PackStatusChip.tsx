import type { GCView } from '../types';
import './PackStatusChip.css';

interface PackStatusChipProps {
  fileName: string;
  gcView: GCView;
}

export default function PackStatusChip({ fileName, gcView }: PackStatusChipProps) {
  const status = gcView.executive_summary.status;
  const isTampered = status.startsWith('FAILED_') || status === 'TAMPERED_STATUS' || status.includes('TAMPER');
  const displayName = fileName.replace('.zip', '').replace('auditor_pack_', '');

  return (
    <div className="pack-status-container">
      <div className={`pack-status-chip ${isTampered ? 'tampered' : 'loaded'}`}>
        <span className="status-label">Pack Loaded:</span>
        <span className="status-file">{displayName}</span>
      </div>
      {isTampered && (
        <div className="tamper-alert">
          <strong>⚠️ TAMPER DETECTED</strong>
        </div>
      )}
    </div>
  );
}
