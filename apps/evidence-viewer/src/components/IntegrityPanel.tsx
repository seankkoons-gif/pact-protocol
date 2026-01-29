import type { GCView, MerkleDigest } from '../types';
import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import { truncateHash } from '../lib/loadPack';
import './Panel.css';

interface IntegrityPanelProps {
  gcView: GCView;
  packFileName?: string;
  /** Optional Merkle digest (Evidence plane); additive anchor only */
  merkleDigest?: MerkleDigest | null;
}

export default function IntegrityPanel({ gcView, packFileName, merkleDigest }: IntegrityPanelProps) {
  const { hash_chain, signatures_verified, final_hash_validation, notes } = gcView.integrity;

  // Check if this is a tampered pack (status indicates failure)
  const isTampered = gcView.executive_summary.status.startsWith('FAILED_');

  return (
    <div className="panel integrity-panel">
      <div className="panel-title-row">
        <h2 className="panel-title">INTEGRITY</h2>
        {packFileName && (
          <CopyVerifyCommandButton packFileName={packFileName} variant="panel" />
        )}
      </div>
      {isTampered && (
        <div className="tamper-warning">
          <strong>⚠️ TAMPER DETECTED:</strong> This pack failed integrity verification. Evidence may be compromised.
        </div>
      )}
      <div className="panel-content">
        <div className="integrity-item">
          <span className="integrity-label">Hash Chain:</span>
          <span className={`integrity-badge ${hash_chain === 'VALID' ? 'valid' : 'invalid'}`}>
            {hash_chain}
          </span>
        </div>
        <div className="integrity-item">
          <span className="integrity-label">Signatures:</span>
          <span className="integrity-value">
            {signatures_verified.verified}/{signatures_verified.total} verified
          </span>
        </div>
        <div className="integrity-item">
          <span className="integrity-label">Final Hash:</span>
          <span className={`integrity-badge ${final_hash_validation === 'MATCH' ? 'valid' : 'invalid'}`}>
            {final_hash_validation}
          </span>
        </div>
        {isTampered && (
          <div className="integrity-item">
            <span className="integrity-label">Recompute:</span>
            <span className="integrity-badge invalid">
              ✗ FAILED
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
