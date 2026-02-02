import { getIntegrityStatusForPack, WARNINGS_VALID_SUBTEXT } from '../lib/integrity';
import type { AuditorPackData } from '../types';
import './Panel.css';

interface WarningsAndExceptionsPanelProps {
  packData: AuditorPackData;
}

/**
 * Lists pack.integrityResult.warnings only (e.g. claimed vs computed transcript hash mismatch).
 * Shown only when there is at least one warning. Warnings never flip VALID → TAMPERED.
 */
export default function WarningsAndExceptionsPanel({ packData }: WarningsAndExceptionsPanelProps) {
  const warnings = packData.integrityResult?.warnings ?? [];
  if (warnings.length === 0) return null;

  const integrityStatus = getIntegrityStatusForPack(packData);
  const subtext =
    integrityStatus === 'VALID' ? WARNINGS_VALID_SUBTEXT : 'Warnings are informational only. They do not affect the Integrity verdict.';

  return (
    <div className="panel warnings-and-exceptions-panel">
      <h2 className="panel-title">WARNINGS & EXCEPTIONS</h2>
      <div className="panel-content">
        <p className="warnings-disclaimer">{subtext}</p>
        <div className="warnings-group">
          <ul>
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
