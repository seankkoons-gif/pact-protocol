import { useState } from 'react';
import './VerifyLocally.css';

interface VerifyLocallyProps {
  packFileName?: string;
}

export default function VerifyLocally({ packFileName }: VerifyLocallyProps) {
  const [copied, setCopied] = useState(false);
  const command = `pact-verifier auditor-pack-verify --zip ${packFileName || '<pack_path>'}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="verify-locally">
      <h3 className="verify-title">Verify Locally</h3>
      <p className="verify-description">
        To independently verify this auditor pack, run the following command in your terminal:
      </p>
      <div className="verify-command-box">
        <code className="verify-command">{command}</code>
        <button className="copy-button" onClick={handleCopy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <p className="verify-note">
        <strong>Note:</strong> This viewer is read-only and does not perform verification. 
        All verification must be done using the pact-verifier CLI tool.
      </p>
    </div>
  );
}
