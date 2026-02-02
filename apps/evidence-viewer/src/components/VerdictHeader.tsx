import type { GCView, Judgment, IntegrityResult, AuditorPackData } from '../types';
import {
  displayIntegrityOrFault,
  INTEGRITY_VALID_SUBTEXT,
  INTEGRITY_TAMPERED_SUBTEXT,
  INDETERMINATE_TOOLTIP,
  INDETERMINATE_VERIFY_VIA_CLI,
} from '../lib/integrity';
import './VerdictHeader.css';

interface VerdictHeaderProps {
  gcView?: GCView | null;
  judgment?: Judgment | null;
  integrityResult?: IntegrityResult | null;
  /** When provided, Integrity is pack.integrityResult.status only; missing => INDETERMINATE */
  packData?: AuditorPackData | null;
}

export default function VerdictHeader({ judgment, packData }: VerdictHeaderProps) {
  // Single source of truth: pack.integrityResult.status only; if missing, INDETERMINATE
  const integrityStatus = packData?.integrityResult?.status ?? 'INDETERMINATE';
  const integrityDisplay = displayIntegrityOrFault(integrityStatus);
  const integrityLabel = `Integrity: ${integrityDisplay}`;
  const integritySubtext =
    integrityDisplay === 'VALID'
      ? INTEGRITY_VALID_SUBTEXT
      : integrityDisplay === 'TAMPERED'
        ? INTEGRITY_TAMPERED_SUBTEXT
        : integrityDisplay === 'INDETERMINATE'
          ? INDETERMINATE_VERIFY_VIA_CLI
          : null;

  const judgmentDisplay =
    judgment?.dblDetermination != null
      ? displayIntegrityOrFault(judgment.dblDetermination)
      : null;
  const judgmentLabel =
    judgmentDisplay != null ? `Judgment: ${judgmentDisplay}` : 'Judgment: unavailable';
  const judgmentTooltip = judgmentDisplay === 'INDETERMINATE' ? INDETERMINATE_TOOLTIP : undefined;

  const confidenceValue =
    judgment?.confidence != null ? judgment.confidence : null;
  const confidenceLabel =
    confidenceValue != null ? `Confidence: ${confidenceValue.toFixed(2)}` : null;

  return (
    <div className="verdict-header">
      <div className="verdict-header-row">
        <span className={`verdict-integrity verdict-${integrityDisplay}`}>
          {integrityLabel}
        </span>
        <span className="verdict-sep">|</span>
        <span className="verdict-judgment" title={judgmentTooltip}>
          {judgmentLabel}
        </span>
        <span className="verdict-sep">|</span>
        <span className="verdict-confidence">
          {confidenceLabel ?? 'Confidence: —'}
        </span>
      </div>
      {integritySubtext && (
        <p className="verdict-integrity-subtext">{integritySubtext}</p>
      )}
    </div>
  );
}
