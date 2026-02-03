import { useCallback, useState } from 'react';
import type { AuditorPackData } from '../types';

interface EvidenceFilesPanelProps {
  packData: AuditorPackData;
}

type FileKey = 'transcript' | 'gcView' | 'judgment' | 'insurerSummary' | 'constitution' | 'checksums' | 'manifest';

const FILES: Array<{ key: FileKey; label: string; getContent: (d: AuditorPackData) => string; filename: string }> = [
  { key: 'transcript', label: 'Transcript JSON', getContent: (d) => d.transcript ?? '{}', filename: 'transcript.json' },
  { key: 'gcView', label: 'GC View JSON', getContent: (d) => JSON.stringify(d.gcView, null, 2), filename: 'gc_view.json' },
  { key: 'judgment', label: 'Judgment JSON', getContent: (d) => JSON.stringify(d.judgment, null, 2), filename: 'judgment.json' },
  {
    key: 'insurerSummary',
    label: 'Insurer Summary JSON',
    getContent: (d) => JSON.stringify(d.insurerSummary, null, 2),
    filename: 'insurer_summary.json',
  },
  { key: 'constitution', label: 'Constitution Markdown', getContent: (d) => d.constitution, filename: 'CONSTITUTION_v1.md' },
  { key: 'checksums', label: 'Checksums File', getContent: (d) => d.checksums, filename: 'checksums.sha256' },
  { key: 'manifest', label: 'Manifest JSON', getContent: (d) => JSON.stringify(d.manifest, null, 2), filename: 'manifest.json' },
];

export default function EvidenceFilesPanel({ packData }: EvidenceFilesPanelProps) {
  const [, setDownloaded] = useState<Set<FileKey>>(new Set());

  const handleDownload = useCallback(
    (f: (typeof FILES)[number]) => {
      const content = f.getContent(packData);
      const blob = new Blob([content], { type: f.key === 'constitution' ? 'text/markdown' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = f.filename;
      a.click();
      URL.revokeObjectURL(url);
      setDownloaded((s) => new Set(s).add(f.key));
    },
    [packData]
  );

  return (
    <div className="evidence-files-panel panel">
      <h3>Evidence Files</h3>
      <div className="evidence-files-grid">
        {FILES.map((f) => (
          <div key={f.key} className="evidence-file-row">
            <span className="file-label">{f.label}</span>
            <button type="button" className="download-btn" onClick={() => handleDownload(f)}>
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
