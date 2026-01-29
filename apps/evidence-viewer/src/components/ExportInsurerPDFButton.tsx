import { useState } from 'react';
import type { AuditorPackData } from '../types';
import { exportInsurerSummaryPDF } from '../lib/exportPDF';
import './ExportInsurerPDFButton.css';

interface ExportInsurerPDFButtonProps {
  packData: AuditorPackData | null;
}

export default function ExportInsurerPDFButton({ packData }: ExportInsurerPDFButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const isDisabled = !packData || !packData.insurerSummary;

  const handleExport = async () => {
    if (!packData || !packData.insurerSummary) return;
    setIsExporting(true);
    try {
      await exportInsurerSummaryPDF(packData);
    } catch (error) {
      console.error('Failed to export insurer PDF:', error);
      alert('Failed to generate PDF. If this persists, check your connection and try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      className={`export-insurer-pdf-button ${isDisabled ? 'disabled' : ''} ${isExporting ? 'exporting' : ''}`}
      onClick={handleExport}
      disabled={isDisabled || isExporting}
      title={isDisabled ? 'Load an auditor pack to export insurer PDF' : 'Export Insurer Summary as PDF'}
    >
      {isExporting ? 'Exporting...' : 'Export Insurer Summary (PDF)'}
    </button>
  );
}
