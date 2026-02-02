import { useState } from 'react';
import type { AuditorPackData } from '../types';
import { generateClaimsIntakePackage } from '../lib/generateClaimsPackage';
import './GenerateClaimsPackageButton.css';

interface GenerateClaimsPackageButtonProps {
  packData: AuditorPackData | null;
}

export default function GenerateClaimsPackageButton({ packData }: GenerateClaimsPackageButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const isDisabled = !packData || !packData.insurerSummary || !packData.zipFile;

  const handleGenerate = async () => {
    if (!packData || !packData.insurerSummary || !packData.zipFile) return;

    setIsGenerating(true);
    try {
      const zipBlob = await generateClaimsIntakePackage(packData);
      
      // Generate filename
      const safeTranscriptId = !packData.transcriptId || packData.transcriptId === 'UNKNOWN'
        ? 'pack'
        : packData.transcriptId.replace(/[^a-zA-Z0-9-_]/g, '_').substring(0, 50);
      const filename = `PACT_CLAIMS_INTAKE_${safeTranscriptId}.zip`;

      // Trigger download
      const url = URL.createObjectURL(zipBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      // Show toast
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
    } catch (error) {
      console.error('Failed to generate claims package:', error);
      alert('Failed to generate claims package. Please check the console for details.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <button
        className={`generate-claims-package-button ${isDisabled ? 'disabled' : ''} ${isGenerating ? 'generating' : ''}`}
        onClick={handleGenerate}
        disabled={isDisabled || isGenerating}
        title={isDisabled ? 'Load an auditor pack to generate claims package' : 'Generate Claims Intake Package'}
      >
        {isGenerating ? 'Generating...' : '🧾 Generate Claims Intake Package'}
      </button>
      {showToast && (
        <div className="claims-package-toast">
          Claims package generated. Ready for submission.
        </div>
      )}
    </>
  );
}
