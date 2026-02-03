import type { GCView, Judgment, AuditorPackData } from '../types';

interface VerdictHeaderProps {
  gcView: GCView;
  judgment: Judgment;
  packData: AuditorPackData;
}

function truncate(s: string, len = 16): string {
  return s.length <= len ? s : s.slice(0, len) + '...';
}

export default function VerdictHeader({ gcView, judgment, packData }: VerdictHeaderProps) {
  const status = gcView.executive_summary?.status ?? 'UNKNOWN';
  const faultDomain = judgment?.dblDetermination ?? gcView.responsibility?.judgment?.fault_domain ?? '—';
  const confidence = Math.round((judgment?.confidence ?? gcView.responsibility?.judgment?.confidence ?? 0) * 100);
  const int = gcView.integrity;
  const integrityValid = int?.hash_chain === 'VALID' && int?.signatures_verified?.verified === int?.signatures_verified?.total;
  const packStatus = packData.integrityResult?.status ?? 'INDETERMINATE';
  const packOk = (packData.packVerifyResult as { ok?: boolean })?.ok;

  const statusClass =
    status === 'COMPLETED'
      ? 'status-good'
      : status.startsWith('FAILED') || status.includes('TAMPERED')
      ? 'status-bad'
      : 'status-warn';

  let verificationSubtext: string;
  if (integrityValid && (packOk === true || packStatus === 'VALID')) {
    verificationSubtext = 'Checksums, hash-chain, and signatures verified.';
  } else if (packStatus === 'TAMPERED' || packOk === false) {
    verificationSubtext = 'Integrity check failed. Do not trust this pack.';
  } else {
    verificationSubtext = 'Integrity status indeterminate. Run pact-verifier to verify.';
  }

  return (
    <div className="verdict-header">
      <div className="verdict-strip">
        <span className="verdict-label">Integrity</span>
        <span className={integrityValid ? 'status-good' : 'status-bad'}>
          {integrityValid ? 'VALID' : int?.hash_chain ?? '—'}
        </span>
        <span className="verdict-sep">|</span>
        <span className="verdict-label">Judgment</span>
        <span className={`verdict-fault ${statusClass}`}>{faultDomain}</span>
        <span className="verdict-sep">|</span>
        <span className="verdict-label">Confidence</span>
        <span>{confidence}%</span>
      </div>
      <p className="verdict-verification-subtext">{verificationSubtext}</p>
      <div className="verdict-meta">
        <span title={packData.transcriptId ?? ''}>
          <strong>Transcript:</strong> <code>{truncate(packData.transcriptId ?? '—', 24)}</code>
        </span>
        <span>
          <strong>Constitution:</strong> <code>{truncate(gcView.constitution?.hash ?? '—', 16)}</code>
        </span>
      </div>
    </div>
  );
}
