import type { GCView, Judgment, AuditorPackData } from '../types';

interface VerdictHeaderProps {
  gcView: GCView;
  judgment: Judgment;
  packData: AuditorPackData;
}

export default function VerdictHeader({ gcView, judgment, packData }: VerdictHeaderProps) {
  const status = gcView.executive_summary?.status ?? '—';
  const faultDomain = judgment?.dblDetermination ?? gcView.responsibility?.judgment?.fault_domain ?? '—';
  const confidence = Math.round((judgment?.confidence ?? gcView.responsibility?.judgment?.confidence ?? 0) * 100);
  const packStatus = packData.integrityResult?.status ?? 'INDETERMINATE';

  const statusClass =
    status === 'COMPLETED'
      ? 'status-good'
      : status.startsWith('FAILED') || status.includes('TAMPERED')
      ? 'status-bad'
      : 'status-warn';

  // "Integrity check failed" only when NOT VALID. Never when integrity is VALID.
  let verificationSubtext: string;
  if (packStatus === 'VALID') {
    verificationSubtext = 'Checksums, hash-chain, and signatures verified.';
  } else {
    verificationSubtext = 'Integrity check failed. Do not trust this pack.';
  }

  const integrityClass = packStatus === 'VALID' ? 'status-good' : packStatus === 'TAMPERED' ? 'status-bad' : 'status-warn';

  const es = gcView?.executive_summary;
  const whatHappenedOneLiner = es
    ? `${es.status} — Money moved: ${es.money_moved ? 'YES' : 'NO'} — Settlement attempted: ${es.settlement_attempted ? 'YES' : 'NO'}`
    : '—';

  return (
    <div className="verdict-header">
      <div className="verdict-strip">
        <span className="verdict-label">Integrity</span>
        <span className={integrityClass}>
          {packStatus}
        </span>
        <span className="verdict-sep">|</span>
        <span className="verdict-label">Judgment</span>
        <span className={`verdict-fault ${statusClass}`}>{faultDomain}</span>
        <span className="verdict-sep">|</span>
        <span className="verdict-label">Confidence</span>
        <span>{confidence}%</span>
      </div>
      <p className="verdict-what-happened">{whatHappenedOneLiner}</p>
      <p className="verdict-verification-subtext">{verificationSubtext}</p>
    </div>
  );
}
