import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import type { AuditorPackData } from '../types';

interface VerifyBlockProps {
  packData: AuditorPackData | null;
}

function buildVerifyCommand(packData: AuditorPackData | null): string {
  if (!packData) return 'pact-verifier auditor-pack-verify --zip <path-to-pack.zip>';
  if (packData.source === 'demo_public' && packData.demoPublicPath) {
    return `pact-verifier auditor-pack-verify --zip apps/evidence-viewer/public/${packData.demoPublicPath}`;
  }
  const fileName = packData.zipFile?.name ?? '<file>';
  return `pact-verifier auditor-pack-verify --zip ${fileName}`;
}

export default function VerifyBlock({ packData }: VerifyBlockProps) {
  const cmd = buildVerifyCommand(packData);
  const isDragDrop = packData != null && packData.source === 'drag_drop';

  return (
    <div className="verify-block panel">
      <h3>Verify locally</h3>
      <p className="verify-hint">Run this command to verify the auditor pack:</p>
      <pre className="verify-command">
        <code>{cmd}</code>
      </pre>
      {isDragDrop && (
        <p className="verify-note">Run from directory containing the zip or replace with full path.</p>
      )}
      <div className="verify-copy-wrap">
        <CopyVerifyCommandButton packData={packData} variant="panel" />
      </div>
    </div>
  );
}
