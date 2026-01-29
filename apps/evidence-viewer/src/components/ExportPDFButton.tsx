import { useState } from 'react';
import type { AuditorPackData } from '../types';
import { exportGCViewPDF } from '../lib/exportPDF';
import './ExportPDFButton.css';

interface ExportPDFButtonProps {
  packData: AuditorPackData | null;
}

export default function ExportPDFButton({ packData }: ExportPDFButtonProps) {
  const [isExporting, setIsExporting] = useState(false);
  const isDisabled = !packData;

  const handleExport = async () => {
    if (!packData) return;
    setIsExporting(true);
    try {
      await exportGCViewPDF(packData);
    } catch (error) {
      console.error('Failed to export PDF:', error);
      alert('Failed to generate PDF. If this persists, check your connection and try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      className={`export-pdf-button ${isDisabled ? 'disabled' : ''} ${isExporting ? 'exporting' : ''}`}
      onClick={handleExport}
      disabled={isDisabled || isExporting}
      title={isDisabled ? 'Load an auditor pack to export PDF' : 'Export GC View as PDF'}
    >
      {isExporting ? 'Exporting...' : 'Export GC View (PDF)'}
    </button>
  );
}
