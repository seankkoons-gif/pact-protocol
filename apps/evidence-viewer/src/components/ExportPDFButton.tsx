import { useCallback, useState } from 'react';
import type { AuditorPackData } from '../types';

interface ExportPDFButtonProps {
  packData: AuditorPackData;
}

const MARGIN = 20;
const MARGIN_BOTTOM = 25;
const HEADER_ROOM = 20; // Min lines to keep with section header
const LINE_HEIGHT = 6;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsPDF.text() returns this, not number
function addSection(
  doc: any,
  y: { current: number },
  title: string,
  content: Array<{ label?: string; value: string }>,
) {
  const pageHeight = doc.internal.pageSize.height;
  const minYForHeader = pageHeight - MARGIN_BOTTOM - HEADER_ROOM - 15;
  if (y.current > minYForHeader) {
    doc.addPage();
    y.current = MARGIN;
  }

  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(title, MARGIN, y.current);
  y.current += LINE_HEIGHT + 2;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  for (const row of content) {
    if (y.current > pageHeight - MARGIN_BOTTOM) {
      doc.addPage();
      y.current = MARGIN;
    }
    const text = row.label ? `${row.label}: ${row.value}` : row.value;
    const lines = doc.splitTextToSize(text, 170);
    for (const line of lines) {
      if (y.current > pageHeight - MARGIN_BOTTOM) {
        doc.addPage();
        y.current = MARGIN;
      }
      doc.text(line, MARGIN, y.current);
      y.current += LINE_HEIGHT;
    }
    y.current += 2;
  }
  y.current += 4;
}

export default function ExportPDFButton({ packData }: ExportPDFButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF();
      const y = { current: MARGIN };

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('Pact Evidence Viewer - GC View Export', MARGIN, y.current);
      y.current += 10;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const headerRows = [
        { label: 'Transcript', value: packData.transcriptId ?? '—' },
        { label: 'Status', value: packData.gcView.executive_summary?.status ?? '—' },
        { label: 'Constitution', value: `${(packData.gcView.constitution?.hash ?? '—').slice(0, 16)}...` },
      ];
      for (const row of headerRows) {
        doc.text(`${row.label}: ${row.value}`, MARGIN, y.current);
        y.current += LINE_HEIGHT;
      }
      y.current += 8;

      const es = packData.gcView.executive_summary;
      addSection(doc, y, 'OUTCOME', [
        { label: 'Status', value: es?.status ?? '—' },
        { label: 'What happened', value: es?.what_happened ?? '—' },
        { label: 'Money moved', value: es?.money_moved ? 'Yes' : 'No' },
        { label: 'Final outcome', value: es?.final_outcome ?? '—' },
        { label: 'Settlement attempted', value: es?.settlement_attempted ? 'Yes' : 'No' },
      ]);

      const int = packData.gcView.integrity;
      addSection(doc, y, 'INTEGRITY', [
        { label: 'Hash chain', value: int?.hash_chain ?? '—' },
        { label: 'Signatures', value: `${int?.signatures_verified?.verified ?? 0}/${int?.signatures_verified?.total ?? 0}` },
        { label: 'Final hash', value: int?.final_hash_validation ?? '—' },
      ]);

      const resp = packData.gcView.responsibility;
      const j = packData.judgment;
      addSection(doc, y, 'RESPONSIBILITY', [
        { label: 'Fault domain', value: j?.dblDetermination ?? resp?.judgment?.fault_domain ?? '—' },
        { label: 'Required next actor', value: j?.requiredNextActor ?? '—' },
        { label: 'Required action', value: j?.requiredAction ?? '—' },
        { label: 'Confidence', value: `${Math.round((j?.confidence ?? 0) * 100)}%` },
        { label: 'Blame explanation', value: resp?.blame_explanation ?? '—' },
      ]);

      const ins = packData.insurerSummary;
      addSection(doc, y, 'INSURANCE', [
        { label: 'Coverage', value: ins?.coverage ?? '—' },
        { label: 'Risk factors', value: ins?.risk_factors?.join(', ') ?? '—' },
      ]);

      const parties = packData.gcView.subject?.parties ?? [];
      const passportSnapshot = packData.manifest.passport_snapshot;
      const hasPassport = parties.length > 0 || (passportSnapshot && typeof passportSnapshot === 'object');
      addSection(doc, y, 'PASSPORT', hasPassport
        ? parties.map((p) => ({ label: p.role, value: p.signer_pubkey }))
        : [{ value: 'No passport snapshot present in this pack.' }],
      );

      const evidenceFiles = [
        'Transcript JSON',
        'GC View JSON',
        'Judgment JSON',
        'Insurer Summary JSON',
        'Constitution Markdown',
        'Checksums File',
        'Manifest JSON',
      ];
      addSection(doc, y, 'EVIDENCE FILES', evidenceFiles.map((name) => ({ value: name })));

      doc.save(`gc-view-${(packData.transcriptId ?? 'export').slice(0, 12)}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setLoading(false);
    }
  }, [packData]);

  return (
    <button type="button" className="export-pdf-btn" onClick={handleClick} disabled={loading}>
      {loading ? 'Exporting...' : 'Export GC View (PDF)'}
      {error && <span className="export-error">{error}</span>}
    </button>
  );
}
