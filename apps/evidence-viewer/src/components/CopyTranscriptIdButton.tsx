import { useState } from 'react';
import './CopyTranscriptIdButton.css';

interface CopyTranscriptIdButtonProps {
  transcriptId: string;
  variant?: 'banner' | 'panel' | 'inline';
}

export default function CopyTranscriptIdButton({ transcriptId, variant = 'inline' }: CopyTranscriptIdButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled = !transcriptId || transcriptId === 'UNKNOWN';

  const handleCopy = async () => {
    if (isDisabled) return;
    
    try {
      // Copy only the raw transcript ID string, no labels or formatting
      await navigator.clipboard.writeText(transcriptId);
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Clipboard unavailable');
      setCopied(false);
      setTimeout(() => setError(null), 3000);
    }
  };

  const buttonClass = `copy-transcript-id-button ${variant} ${copied ? 'copied' : ''} ${error ? 'error' : ''} ${isDisabled ? 'disabled' : ''}`;

  return (
    <div className="copy-transcript-id-container">
      <button
        className={buttonClass}
        onClick={handleCopy}
        disabled={isDisabled}
        title={isDisabled ? 'Transcript ID unavailable' : `Copy: ${transcriptId}`}
      >
        {copied ? 'Copied ✓' : error ? 'Error' : 'Copy Transcript ID'}
      </button>
      {error && (
        <span className="copy-error-message">{error}</span>
      )}
    </div>
  );
}
