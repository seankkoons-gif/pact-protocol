import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import { getVerifyCommand } from '../lib/integrity';
import type { AuditorPackData } from '../types';
import './VerifyBlock.css';

interface VerifyBlockProps {
  packData: AuditorPackData | null;
}

/**
 * Single "Verify this pack locally (offline)" block. Rendered once per page, under the verdict header.
 */
export default function VerifyBlock({ packData }: VerifyBlockProps) {
  const verify = getVerifyCommand(packData ?? null);
  if (!verify || !packData) return null;

  return (
    <div className="verify-block">
      <span className="verify-block-label">Verify this pack locally (offline):</span>
      <p className="verify-block-readonly">This viewer is read-only. Verification must be done with the CLI.</p>
      <div className="verify-block-row">
        <code className="verify-block-command">{verify.command}</code>
        <CopyVerifyCommandButton packData={packData} variant="panel" />
      </div>
      {verify.note && <p className="verify-block-note">{verify.note}</p>}
    </div>
  );
}
