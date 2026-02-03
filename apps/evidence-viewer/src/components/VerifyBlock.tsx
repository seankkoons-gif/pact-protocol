import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import type { AuditorPackData } from '../types';

interface VerifyBlockProps {
  packData: AuditorPackData;
}

function buildVerifyCommand(packData: AuditorPackData): string {
  const path =
    packData.source === 'demo_public' && packData.demoPublicPath
      ? `apps/evidence-viewer/public/${packData.demoPublicPath}`
      : packData.zipFile?.name ?? '<path-to-pack.zip>';
  return `pact-verifier auditor-pack-verify --zip ${path}`;
}

export default function VerifyBlock({ packData }: VerifyBlockProps) {
  const cmd = buildVerifyCommand(packData);

  return (
    <div className="verify-block panel">
      <h3>Verify this pack locally (offline)</h3>
      <p className="verify-hint">Run this command to verify the auditor pack:</p>
      <pre className="verify-command">
        <code>{cmd}</code>
      </pre>
      <div className="verify-copy-wrap">
        <CopyVerifyCommandButton packData={packData} variant="panel" />
      </div>
    </div>
  );
}
