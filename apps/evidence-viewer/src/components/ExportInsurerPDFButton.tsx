import { useCallback, useState } from 'react';
import type { AuditorPackData } from '../types';

interface ExportInsurerPDFButtonProps {
  packData: AuditorPackData;
}

export default function ExportInsurerPDFButton({ packData }: ExportInsurerPDFButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      doc.setFontSize(14);
      doc.text('Pact Evidence Viewer - Insurer Summary', 20, 20);
      doc.setFontSize(10);
      doc.text(`Transcript: ${packData.transcriptId}`, 20, 30);
      doc.text(`Coverage: ${packData.insurerSummary?.coverage ?? '—'}`, 20, 36);
      if (packData.insurerSummary?.risk_factors?.length) {
        doc.text(`Risk Factors: ${packData.insurerSummary.risk_factors.join(', ')}`, 20, 42);
      }
      doc.save(`insurer-summary-${packData.transcriptId?.slice(0, 12) ?? 'export'}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [packData]);

  return (
    <button type="button" className="export-pdf-btn" onClick={handleClick} disabled={loading}>
      {loading ? 'Exporting...' : 'Export Insurer Summary (PDF)'}
      {error && <span className="export-error">{error}</span>}
    </button>
  );
}
