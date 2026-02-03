import type { GCView, AuditorPackData } from '../types';

interface IntegrityPanelProps {
  gcView: GCView;
  packFileName?: string;
  merkleDigest?: AuditorPackData['merkleDigest'];
  packData: AuditorPackData;
}

export default function IntegrityPanel({ gcView, packFileName: _packFileName, merkleDigest, packData }: IntegrityPanelProps) {
  const int = gcView.integrity;
  if (!int) return null;

  const hashChainClass = int.hash_chain === 'VALID' ? 'status-good' : 'status-bad';
  const sigClass =
    int.signatures_verified?.verified === int.signatures_verified?.total ? 'status-good' : 'status-bad';
  const finalHashClass =
    int.final_hash_validation === 'MATCH' ? 'status-good' : int.final_hash_validation === 'MISMATCH' ? 'status-bad' : 'status-warn';

  const packVerify = packData.packVerifyResult as { ok?: boolean; recompute_ok?: boolean; mismatches?: string[] } | undefined;
  const recomputeOk = packVerify?.recompute_ok;
  const mismatches = packVerify?.mismatches ?? [];

  return (
    <div className="integrity-panel panel">
      <h3>Integrity</h3>
      <dl className="integrity-meta">
        <dt>Hash Chain</dt>
        <dd>
          <span className={`badge ${hashChainClass}`}>{int.hash_chain}</span>
        </dd>
        <dt>Signatures</dt>
        <dd>
          <span className={sigClass}>
            {int.signatures_verified?.verified ?? 0}/{int.signatures_verified?.total ?? 0} verified
          </span>
        </dd>
        <dt>Final Hash</dt>
        <dd>
          <span className={`badge ${finalHashClass}`}>{int.final_hash_validation}</span>
        </dd>
        {recomputeOk != null && (
          <>
            <dt>Recompute</dt>
            <dd>
              <span className={recomputeOk ? 'status-good' : 'status-bad'}>{recomputeOk ? 'OK' : 'Failed'}</span>
            </dd>
          </>
        )}
      </dl>
      {int.notes && int.notes.length > 0 && (
        <div className="integrity-notes">
          <strong>Notes</strong>
          <ul>
            {int.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {mismatches.length > 0 && (
        <div className="integrity-mismatches">
          <strong>Mismatches</strong>
          <ul>
            {mismatches.map((m, i) => (
              <li key={i} className="status-bad">
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}
      {merkleDigest && (
        <div className="merkle-digest">
          <strong>Merkle</strong>
          <p>
            Root: <code>{merkleDigest.root?.slice(0, 16)}...</code>
          </p>
        </div>
      )}
    </div>
  );
}
