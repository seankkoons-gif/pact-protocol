import type { AuditorPackData } from '../types';
import './Panel.css';

interface EvidenceFilesPanelProps {
  packData: AuditorPackData;
}

export default function EvidenceFilesPanel({ packData }: EvidenceFilesPanelProps) {
  const files: Array<{ name: string; path: string; label: string }> = [
    { name: 'transcript.json', path: 'input/transcript.json', label: 'Transcript JSON' },
    { name: 'gc_view.json', path: 'derived/gc_view.json', label: 'GC View JSON' },
    { name: 'judgment.json', path: 'derived/judgment.json', label: 'Judgment JSON' },
    { name: 'insurer_summary.json', path: 'derived/insurer_summary.json', label: 'Insurer Summary JSON' },
    { name: 'CONSTITUTION_v1.md', path: 'constitution/CONSTITUTION_v1.md', label: 'Constitution Markdown' },
    { name: 'checksums.sha256', path: 'checksums.sha256', label: 'Checksums File' },
    { name: 'manifest.json', path: 'manifest.json', label: 'Manifest JSON' },
  ];
  if (packData.merkleDigest) {
    files.splice(4, 0, { name: 'merkle_digest.json', path: 'derived/merkle_digest.json', label: 'Merkle Digest JSON' });
  }

  const handleDownload = async (path: string, filename: string) => {
    if (!packData.zipFile) return;

    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(packData.zipFile);
      const file = zip.file(path);
      if (!file) {
        alert(`File ${path} not found in pack`);
        return;
      }
      
      const content = await file.async('blob');
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      alert('Failed to download file');
    }
  };

  return (
    <div className="panel evidence-files-panel">
      <h2 className="panel-title">EVIDENCE FILES</h2>
      <div className="panel-content">
        <div className="files-list">
          {files.map((file) => (
            <div key={file.path} className="file-item">
              <span className="file-name">{file.label}</span>
              <button
                className="download-button"
                onClick={() => handleDownload(file.path, file.name)}
              >
                Download
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
