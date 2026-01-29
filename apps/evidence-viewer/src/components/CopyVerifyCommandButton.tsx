import { useState } from 'react';
import './CopyVerifyCommandButton.css';

interface CopyVerifyCommandButtonProps {
  packFileName?: string;
  variant?: 'banner' | 'panel';
}

export default function CopyVerifyCommandButton({ packFileName, variant = 'banner' }: CopyVerifyCommandButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDisabled = !packFileName;
  const command = packFileName 
    ? `pact-verifier auditor-pack-verify --zip ${packFileName}`
    : 'pact-verifier auditor-pack-verify --zip <file>';

  const handleCopy = async () => {
    if (isDisabled || !packFileName) return;
    
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setError(null);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('Clipboard unavailable');
      setCopied(false);
      setTimeout(() => setError(null), 3000);
    }
  };

  const buttonClass = `copy-verify-button ${variant} ${copied ? 'copied' : ''} ${error ? 'error' : ''} ${isDisabled ? 'disabled' : ''}`;

  return (
    <div className="copy-verify-container">
      <button
        className={buttonClass}
        onClick={handleCopy}
        disabled={isDisabled}
        title={command}
      >
        {copied ? 'Copied ✓' : error ? 'Error' : 'Copy Verify Command'}
      </button>
      {error && (
        <span className="copy-error-message">{error}</span>
      )}
    </div>
  );
}
