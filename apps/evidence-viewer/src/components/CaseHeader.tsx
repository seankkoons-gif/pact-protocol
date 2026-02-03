import type { Manifest, GCView } from '../types';

interface CaseHeaderProps {
  manifest: Manifest;
  gcView: GCView;
  transcriptId: string;
}

function truncate(s: string, len = 16): string {
  return s.length <= len ? s : s.slice(0, len) + '...';
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

export default function CaseHeader({ manifest, gcView, transcriptId }: CaseHeaderProps) {
  const constitutionHash = manifest.constitution_hash ?? gcView.constitution?.hash ?? '—';
  const status = gcView.executive_summary?.status ?? '—';

  return (
    <div className="case-header panel">
      <h3>Case Details</h3>
      <dl className="case-meta">
        <dt>Status</dt>
        <dd>{status}</dd>
        <dt>Transcript ID</dt>
        <dd>
          <code title={transcriptId}>{truncate(transcriptId, 32)}</code>
        </dd>
        <dt>Constitution</dt>
        <dd>
          {manifest.constitution_version ?? '1.0'} ({truncate(constitutionHash, 16)})
        </dd>
        <dt>Generated</dt>
        <dd>{formatTimestamp(manifest.created_at_ms)}</dd>
        <dt>Tool</dt>
        <dd>{manifest.tool_version ?? '—'}</dd>
      </dl>
    </div>
  );
}
