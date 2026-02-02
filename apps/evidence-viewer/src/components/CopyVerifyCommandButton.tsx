import { useState } from 'react';
import { getVerifyCommand } from '../lib/integrity';
import type { AuditorPackData } from '../types';
import './CopyVerifyCommandButton.css';

interface CopyVerifyCommandButtonProps {
  /** Pack data; command is derived from pack.source (demo_public repo path, drag_drop template). */
  packData?: AuditorPackData | null;
  variant?: 'banner' | 'panel';
}

export default function CopyVerifyCommandButton({ packData, variant = 'banner' }: CopyVerifyCommandButtonProps) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = getVerifyCommand(packData ?? null);
  const command = verify?.command ?? '';
  const isDisabled = !command;

  const handleCopy = async () => {
    if (isDisabled || !command) return;

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
        title={command || undefined}
      >
        {copied ? 'Copied ✓' : error ? 'Error' : 'Copy Verify Command'}
      </button>
      {error && (
        <span className="copy-error-message">{error}</span>
      )}
    </div>
  );
}
