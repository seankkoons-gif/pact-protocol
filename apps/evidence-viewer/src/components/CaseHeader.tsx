import { useState, useCallback } from 'react';
import type { Manifest, GCView } from '../types';

interface CaseHeaderProps {
  manifest: Manifest;
  gcView: GCView;
  transcriptId: string;
  /** Tool version from verifier result (current); used when manifest has stale value. */
  packVerifyResult?: { tool_version?: string } | null;
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

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button type="button" className="copy-btn-inline" onClick={handleCopy} title="Copy">
      {copied ? 'Copied' : label}
    </button>
  );
}

export default function CaseHeader({ manifest, gcView, transcriptId, packVerifyResult }: CaseHeaderProps) {
  const constitutionHash = manifest.constitution_hash ?? gcView.constitution?.hash ?? '—';
  const status = gcView.executive_summary?.status ?? '—';
  const statusClass =
    status === 'COMPLETED' ? 'status-good' : status.startsWith('FAILED') || status.includes('TAMPERED') ? 'status-bad' : 'status-warn';

  // Prefer verifier result (current run); fallback to manifest. Do not use stale derived JSON.
  const toolVersion =
    (packVerifyResult?.tool_version?.trim() && packVerifyResult.tool_version) ||
    (manifest.tool_version?.trim() && manifest.tool_version) ||
    null;

  return (
    <div className="case-header panel">
      <h3>Case Details</h3>
      <dl className="case-meta">
        <dt>Status</dt>
        <dd><span className={`badge case-status-pill ${statusClass}`}>{status}</span></dd>
        <dt>Transcript ID</dt>
        <dd className="case-meta-copy-row">
          <code title={transcriptId}>{truncate(transcriptId, 32)}</code>
          <CopyButton text={transcriptId} />
        </dd>
        <dt>Constitution</dt>
        <dd>
          {manifest.constitution_version ?? '1.0'} ({truncate(constitutionHash, 16)})
        </dd>
        <dt>Generated</dt>
        <dd>{formatTimestamp(manifest.created_at_ms)}</dd>
        {toolVersion && (
          <>
            <dt>Tool</dt>
            <dd>{toolVersion}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
