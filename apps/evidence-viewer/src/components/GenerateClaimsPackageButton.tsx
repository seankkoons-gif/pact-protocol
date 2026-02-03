import { useCallback, useState } from 'react';
import JSZip from 'jszip';
import type { AuditorPackData } from '../types';
import type { AttachmentEntry } from './AttachmentsDropZone';

interface GenerateClaimsPackageButtonProps {
  packData: AuditorPackData;
  attachments?: AttachmentEntry[];
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function GenerateClaimsPackageButton({
  packData,
  attachments = [],
}: GenerateClaimsPackageButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isTampered = (packData.integrityResult?.status ?? 'INDETERMINATE') === 'TAMPERED';
  const showTamperWarning = isTampered && attachments.length > 0;

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const zip = new JSZip();

      zip.file('transcript.json', packData.transcript ?? '{}');
      zip.file('gc_view.json', JSON.stringify(packData.gcView, null, 2));
      zip.file('judgment.json', JSON.stringify(packData.judgment, null, 2));
      zip.file('insurer_summary.json', JSON.stringify(packData.insurerSummary, null, 2));
      zip.file('CONSTITUTION_v1.md', packData.constitution);
      zip.file('manifest.json', JSON.stringify(packData.manifest, null, 2));

      if (attachments.length > 0) {
        const manifestEntries: Array<{
          filename: string;
          sha256: string;
          size: number;
          added_at: string;
        }> = [];

        for (const { file, addedAt } of attachments) {
          const buf = await file.arrayBuffer();
          const hash = await sha256Hex(buf);
          zip.file(`attachments/${file.name}`, buf);
          manifestEntries.push({
            filename: file.name,
            sha256: hash,
            size: file.size,
            added_at: new Date(addedAt).toISOString(),
          });
        }

        zip.file(
          'attachments_manifest.json',
          JSON.stringify({ entries: manifestEntries }, null, 2)
        );
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claims-package-${packData.transcriptId?.slice(0, 12) ?? 'export'}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  }, [packData, attachments]);

  return (
    <div className="generate-claims-wrap">
      {showTamperWarning && (
        <p className="claims-tamper-warning">
          Attachments included, but base evidence pack failed integrity; treat as compromised.
        </p>
      )}
      <button type="button" className="generate-claims-btn" onClick={handleClick} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Claims Intake Package'}
      </button>
      {error && <span className="export-error">{error}</span>}
    </div>
  );
}
