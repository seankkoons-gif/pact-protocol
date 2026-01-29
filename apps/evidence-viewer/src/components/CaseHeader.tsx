import type { Manifest, GCView } from '../types';
import { formatDate, truncateHash } from '../lib/loadPack';
import CopyTranscriptIdButton from './CopyTranscriptIdButton';
import './CaseHeader.css';

interface CaseHeaderProps {
  manifest: Manifest;
  gcView: GCView;
  transcriptId: string;
}

/** Resolve audit tier from manifest or gcView (default T1). Informational only. */
function getAuditTier(manifest: Manifest, gcView: GCView): 'T1' | 'T2' | 'T3' {
  return manifest.audit_tier ?? gcView.audit?.tier ?? 'T1';
}

function getAuditSla(manifest: Manifest, gcView: GCView): string | undefined {
  return manifest.audit_sla ?? gcView.audit?.sla;
}

function getStatusColor(status: string): string {
  if (status === 'COMPLETED') return '#006600';
  if (status.startsWith('FAILED_')) return '#CC0000';
  if (status.startsWith('ABORTED_')) return '#CC9900';
  return '#666666';
}

export default function CaseHeader({ manifest, gcView, transcriptId }: CaseHeaderProps) {
  const status = gcView.executive_summary.status;
  const statusColor = getStatusColor(status);
  const displayId = transcriptId === 'UNKNOWN' ? 'UNKNOWN' : truncateHash(transcriptId, 24);
  const fullId = transcriptId === 'UNKNOWN' ? 'UNKNOWN' : transcriptId;

  return (
    <div className="case-header">
      <div className="case-header-top">
        <div className="status-badge" style={{ borderColor: statusColor, color: statusColor }}>
          {status}
        </div>
        <div className="case-header-meta">
          <div className="meta-item transcript-id-item">
            <span className="meta-label">Transcript ID:</span>
            <div className="meta-value-row">
              <code className="meta-value" title={fullId}>{displayId}</code>
              <CopyTranscriptIdButton transcriptId={transcriptId} variant="inline" />
            </div>
          </div>
          <div className="meta-item">
            <span className="meta-label">Constitution:</span>
            <code className="meta-value">
              {manifest.constitution_version} ({truncateHash(manifest.constitution_hash)})
            </code>
          </div>
          <div className="meta-item">
            <span className="meta-label">Generated:</span>
            <span className="meta-value">{formatDate(manifest.created_at_ms)}</span>
          </div>
          {(manifest.audit_tier ?? gcView.audit ?? manifest.audit_sla) != null && (
            <>
              <div className="meta-item">
                <span className="meta-label">Audit tier:</span>
                <span className="meta-value">{getAuditTier(manifest, gcView)}</span>
              </div>
              {getAuditSla(manifest, gcView) != null && (
                <div className="meta-item">
                  <span className="meta-label">Audit SLA:</span>
                  <span className="meta-value">{getAuditSla(manifest, gcView)}</span>
                </div>
              )}
              <div className="meta-item audit-note">
                <span className="meta-value note">Tier affects audit schedule, not transaction admissibility.</span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
