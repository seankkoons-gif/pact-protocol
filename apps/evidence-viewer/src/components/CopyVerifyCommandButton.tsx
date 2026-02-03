import { useState, useCallback } from 'react';
import type { AuditorPackData } from '../types';

interface CopyVerifyCommandButtonProps {
  packData: AuditorPackData | null;
  variant?: 'panel' | 'inline';
}

function buildVerifyCommand(packData: AuditorPackData | null): string {
  if (!packData) return 'pact-verifier auditor-pack-verify --zip <path-to-pack.zip>';
  if (packData.source === 'demo_public' && packData.demoPublicPath) {
    return `pact-verifier auditor-pack-verify --zip apps/evidence-viewer/public/${packData.demoPublicPath}`;
  }
  const fileName = packData.zipFile?.name ?? '<file>';
  return `pact-verifier auditor-pack-verify --zip ${fileName}`;
}

export default function CopyVerifyCommandButton({ packData, variant = 'inline' }: CopyVerifyCommandButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const cmd = buildVerifyCommand(packData);
    await navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [packData]);

  return (
    <button
      type="button"
      className={`copy-verify-btn ${variant}`}
      onClick={handleCopy}
      title="Copy verify command"
    >
      {copied ? 'Copied!' : 'Copy Verify Command'}
    </button>
  );
}
