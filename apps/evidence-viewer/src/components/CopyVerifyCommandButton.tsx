import { useState, useCallback } from 'react';
import type { AuditorPackData } from '../types';

interface CopyVerifyCommandButtonProps {
  packData: AuditorPackData;
  variant?: 'panel' | 'inline';
}

function buildVerifyCommand(packData: AuditorPackData): string {
  const path =
    packData.source === 'demo_public' && packData.demoPublicPath
      ? `apps/evidence-viewer/public/${packData.demoPublicPath}`
      : packData.zipFile?.name ?? '<path-to-pack.zip>';
  return `pact-verifier auditor-pack-verify --zip ${path}`;
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
