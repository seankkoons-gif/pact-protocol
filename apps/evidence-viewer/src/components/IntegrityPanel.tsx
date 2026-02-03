import type { GCView, AuditorPackData } from '../types';

interface IntegrityPanelProps {
  gcView: GCView;
  packFileName?: string;
  merkleDigest?: AuditorPackData['merkleDigest'];
  packData: AuditorPackData;
}

export default function IntegrityPanel({ gcView, packFileName: _packFileName, merkleDigest, packData }: IntegrityPanelProps) {
  const int = gcView.integrity;
  const ir = packData.integrityResult;
  const packVerify = packData.packVerifyResult as { ok?: boolean; recompute_ok?: boolean; checksums_ok?: boolean; mismatches?: string[] } | undefined;

  const checksumsOk = packVerify?.checksums_ok ?? ir?.checksums?.status === 'VALID';
  const checksumsStatus = checksumsOk ? 'VALID' : packVerify?.checksums_ok === false ? 'INVALID' : 'UNAVAILABLE';
  const checksumFailures = ir?.checksums?.failures ?? [];

  const hashChainStatus = int?.hash_chain ?? '—';
  const hashChainDetails = ir?.hashChain?.details ?? int?.notes?.find((n) => /hash|chain/i.test(n));

  const sigVerified = int?.signatures_verified?.verified ?? ir?.signatures?.verifiedCount ?? 0;
  const sigTotal = int?.signatures_verified?.total ?? ir?.signatures?.totalCount ?? 0;

  const recomputeOk = packVerify?.recompute_ok;

  const hashChainClass = hashChainStatus === 'VALID' ? 'status-good' : hashChainStatus === 'INVALID' ? 'status-bad' : 'status-warn';
  const sigClass = sigTotal > 0 && sigVerified === sigTotal ? 'status-good' : sigTotal > 0 ? 'status-bad' : 'status-warn';
  const checksumsClass = checksumsStatus === 'VALID' ? 'status-good' : checksumsStatus === 'INVALID' ? 'status-bad' : 'status-warn';

  return (
    <div className="integrity-panel panel">
      <h3>Integrity</h3>
      <dl className="integrity-meta">
        <dt>Checksums</dt>
        <dd>
          <span className={`badge ${checksumsClass}`}>{checksumsStatus}</span>
          {checksumFailures.length > 0 && (
            <ul className="integrity-failures">
              {checksumFailures.map((f, i) => (
                <li key={i} className="status-bad">{f}</li>
              ))}
            </ul>
          )}
        </dd>
        <dt>Hash Chain</dt>
        <dd>
          <span className={`badge ${hashChainClass}`}>{hashChainStatus}</span>
          {hashChainDetails && <span className="integrity-detail"> {hashChainDetails}</span>}
        </dd>
        <dt>Signatures</dt>
        <dd>
          <span className={sigClass}>
            {sigTotal > 0 ? `${sigVerified}/${sigTotal} verified` : '—'}
          </span>
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
