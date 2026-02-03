import { useCallback, useState } from 'react';
import JSZip from 'jszip';
import type { AuditorPackData } from '../types';

interface GenerateClaimsPackageButtonProps {
  packData: AuditorPackData;
}

export default function GenerateClaimsPackageButton({ packData }: GenerateClaimsPackageButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [packData]);

  return (
    <button type="button" className="generate-claims-btn" onClick={handleClick} disabled={loading}>
      {loading ? 'Generating...' : 'Generate Claims Intake Package'}
      {error && <span className="export-error">{error}</span>}
    </button>
  );
}
