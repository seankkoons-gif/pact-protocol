import { useState } from 'react';
import type { GCView, MerkleDigest, IntegrityResult, AuditorPackData } from '../types';
import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import { truncateHash } from '../lib/loadPack';
import { getIntegrityStatusForPack } from '../lib/integrity';
import './Panel.css';

interface IntegrityPanelProps {
  gcView: GCView;
  packFileName?: string;
  /** Optional Merkle digest (Evidence plane); additive anchor only */
  merkleDigest?: MerkleDigest | null;
  /** @deprecated Packs do not contain pack_verify; use integrityResult */
  packVerifyResult?: unknown;
  /** Client-side integrity from pack contents (preferred) */
  integrityResult?: IntegrityResult | null;
  /** When provided, integrity is taken from pack (integrityResult preferred); verify command from pack.source */
  packData?: AuditorPackData | null;
}

export default function IntegrityPanel({ gcView, merkleDigest, integrityResult, packData }: IntegrityPanelProps) {
  const [showDebug, setShowDebug] = useState(false);
  const { hash_chain, signatures_verified, final_hash_validation, notes } = gcView.integrity;

  // Single source of truth: pack.integrityResult.status via shared helper (same as banner/PDF)
  const ir = packData?.integrityResult ?? integrityResult;
  const integrityStatus = packData ? getIntegrityStatusForPack(packData) : (ir?.status ?? 'INDETERMINATE');
  const isTampered = integrityStatus === 'TAMPERED';
  const isIndeterminate = integrityStatus === 'INDETERMINATE';

  const checksums = ir?.checksums;
  const hashChain = ir?.hashChain ?? { status: hash_chain as 'VALID' | 'INVALID', details: undefined };
  const sigResult = ir?.signatures ?? {
    status: (signatures_verified.verified === signatures_verified.total ? 'VALID' : 'INVALID') as 'VALID' | 'INVALID' | 'UNVERIFIABLE' | 'UNAVAILABLE',
    verifiedCount: signatures_verified.verified,
    totalCount: signatures_verified.total,
    failures: [] as string[],
  };
  const sigDisplay =
    sigResult.status === 'UNAVAILABLE'
      ? ''
      : `(${sigResult.verifiedCount}/${sigResult.totalCount} verified)`;

  const showChecksumsCoverNote =
    checksums?.status === 'VALID' && ir && ir.status !== 'VALID';

  const indeterminateReasons: string[] = [];
  if (isIndeterminate && ir) {
    indeterminateReasons.push(...(ir.warnings ?? []).slice(0, 3));
    if (checksums && (checksums.status === 'UNAVAILABLE' || checksums.status === 'INVALID')) {
      indeterminateReasons.push(`Checksums: ${checksums.status}`);
    }
    if (sigResult.status === 'UNAVAILABLE' || sigResult.status === 'UNVERIFIABLE' || sigResult.status === 'INVALID') {
      indeterminateReasons.push(`Signatures: ${sigResult.status}`);
    }
  }
  const showIndeterminateReasons = indeterminateReasons.length > 0;

  return (
    <div className="panel integrity-panel">
      <div className="panel-title-row">
        <h2 className="panel-title">INTEGRITY</h2>
        {packData && (
          <CopyVerifyCommandButton packData={packData} variant="panel" />
        )}
      </div>
      {isTampered && (
        <div className="tamper-warning">
          <strong>⚠️ TAMPER DETECTED:</strong> This pack failed integrity verification. Evidence may be compromised.
        </div>
      )}
      {showIndeterminateReasons && (
        <div className="indeterminate-reasons" aria-label="Why indeterminate?">
          <div className="indeterminate-reasons-title">Why indeterminate?</div>
          <ul className="indeterminate-reasons-list">
            {indeterminateReasons.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {isIndeterminate && (
        <div className="integrity-debug-section">
          <button
            type="button"
            className="integrity-debug-toggle"
            onClick={() => setShowDebug((v) => !v)}
            aria-expanded={showDebug}
          >
            {showDebug ? 'Hide debug' : 'Show debug'}
          </button>
          {showDebug && (
            <div className="integrity-debug-box" role="region" aria-label="Integrity debug">
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">input/transcript.json found:</span>
                <span className="integrity-debug-value">
                  {packData?.integrityDebug?.transcriptFound != null ? (packData.integrityDebug!.transcriptFound ? 'Yes' : 'No') : '—'}
                  {packData?.integrityDebug?.transcriptPath != null ? ` (${packData.integrityDebug.transcriptPath})` : ''}
                </span>
              </div>
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">checksums.sha256 found:</span>
                <span className="integrity-debug-value">
                  {packData?.integrityDebug?.checksumsFound != null ? (packData.integrityDebug!.checksumsFound ? 'Yes' : 'No') : '—'}
                  {packData?.integrityDebug?.checksumsPath != null ? ` (${packData.integrityDebug.checksumsPath})` : ''}
                </span>
              </div>
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">Zip entries:</span>
                <span className="integrity-debug-value">{packData?.integrityDebug?.zipEntryCount ?? '—'}</span>
              </div>
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">Checksums status:</span>
                <span className="integrity-debug-value">{checksums?.status ?? '—'}</span>
              </div>
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">Hash chain status:</span>
                <span className="integrity-debug-value">{hashChain?.status ?? '—'}</span>
              </div>
              <div className="integrity-debug-row">
                <span className="integrity-debug-label">Signatures status:</span>
                <span className="integrity-debug-value">{sigResult?.status ?? '—'}</span>
              </div>
              {(ir?.warnings?.length ?? 0) > 0 && (
                <div className="integrity-debug-row integrity-debug-warnings">
                  <span className="integrity-debug-label">Warnings (first 10):</span>
                  <ul className="integrity-debug-list">
                    {(ir?.warnings ?? []).slice(0, 10).map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      <div className="panel-content">
        {ir && checksums != null && (
          <>
            <div className="integrity-item">
              <span className="integrity-label">Checksums:</span>
              <span className={`integrity-badge ${checksums.status === 'VALID' ? 'valid' : checksums.status === 'INVALID' ? 'invalid' : 'neutral'}`}>
                {checksums.status}
              </span>
              {(checksums.totalCount ?? 0) > 0 && (
                <span className="integrity-value"> ({checksums.checkedCount}/{checksums.totalCount} checked)</span>
              )}
              {showChecksumsCoverNote && (
                <span className="integrity-value"> (checksums cover listed files only)</span>
              )}
            </div>
            {(checksums.failures?.length ?? 0) > 0 && (
              <ul className="integrity-failures">
                {checksums.failures.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <div className="integrity-item">
          <span className="integrity-label">Hash Chain:</span>
          <span className={`integrity-badge ${hashChain.status === 'VALID' ? 'valid' : 'invalid'}`}>
            {hashChain.status}
          </span>
        </div>
        {hashChain.details && (
          <p className="integrity-detail">{hashChain.details}</p>
        )}
        <div className="integrity-item">
          <span className="integrity-label">Signatures:</span>
          <span className={`integrity-badge ${sigResult.status === 'VALID' ? 'valid' : sigResult.status === 'INVALID' ? 'invalid' : 'neutral'}`}>
            {sigResult.status}
          </span>
          {sigDisplay && <span className="integrity-value"> {sigDisplay}</span>}
        </div>
        {(sigResult.failures?.length ?? 0) > 0 && (
          <ul className="integrity-failures">
            {sigResult.failures.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        )}
        {!ir && (
          <div className="integrity-item">
            <span className="integrity-label">Final Hash:</span>
            <span className={`integrity-badge ${final_hash_validation === 'MATCH' ? 'valid' : 'invalid'}`}>
              {final_hash_validation}
            </span>
          </div>
        )}
        {notes && notes.length > 0 && (
          <div className="integrity-notes">
            <div className="notes-label">Notes:</div>
            <ul>
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>
        )}
        {merkleDigest && (
          <div className="merkle-digest-section">
            <div className="merkle-digest-label">Merkle digest (Evidence plane)</div>
            <div className="merkle-digest-note">
              Extra anchor only; not used as verification instead of PoN.
            </div>
            <div className="integrity-item">
              <span className="integrity-label">Date (UTC):</span>
              <span className="integrity-value">{merkleDigest.date_utc}</span>
            </div>
            <div className="integrity-item">
              <span className="integrity-label">Root:</span>
              <span className="integrity-value monospace">{truncateHash(merkleDigest.root, 20)}</span>
            </div>
            <div className="integrity-item">
              <span className="integrity-label">Leaf index:</span>
              <span className="integrity-value">{merkleDigest.leaf_index} / {merkleDigest.tree_size}</span>
            </div>
            {merkleDigest.constitution_hash != null && (
              <div className="integrity-item">
                <span className="integrity-label">Constitution hash:</span>
                <span className="integrity-value monospace">{truncateHash(merkleDigest.constitution_hash, 16)}</span>
              </div>
            )}
            {merkleDigest.signer != null && (
              <div className="integrity-item">
                <span className="integrity-label">Signer:</span>
                <span className="integrity-value monospace">{truncateHash(merkleDigest.signer, 12)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
