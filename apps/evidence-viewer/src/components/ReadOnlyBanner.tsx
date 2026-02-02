import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import { getVerifyCommand } from '../lib/integrity';
import type { AuditorPackData } from '../types';
import './ReadOnlyBanner.css';

interface ReadOnlyBannerProps {
  /** When set, banner is minimal (no verdict/verify; those appear once under VerdictHeader). */
  packData?: AuditorPackData | null;
}

export default function ReadOnlyBanner({ packData }: ReadOnlyBannerProps) {
  const verify = getVerifyCommand(packData ?? null);
  const showVerdictAndVerify = !packData && verify;

  return (
    <div className="read-only-banner">
      <div className="banner-header">
        <h2 className="banner-title">Read-Only Evidence Viewer</h2>
        {verify && packData && (
          <CopyVerifyCommandButton packData={packData} variant="banner" />
        )}
      </div>
      {showVerdictAndVerify && (
        <>
          <p className="banner-text">
            Source of truth is the Auditor Pack ZIP. This viewer does not execute transactions.
          </p>
          <div className="banner-verification">
            <span className="verification-label">Verify this pack locally (offline):</span>
            <p className="verification-readonly">This viewer is read-only. Verification must be done with the CLI.</p>
            <code className="verification-command">{verify.command}</code>
            {verify.note && <p className="verification-note">{verify.note}</p>}
          </div>
        </>
      )}
      {!showVerdictAndVerify && (
        <p className="banner-text">
          Source of truth is the Auditor Pack ZIP. This viewer does not execute transactions.
        </p>
      )}
      <p className="banner-note">
        All outputs are derived from signed transcripts and a fixed Constitution hash.
      </p>
    </div>
  );
}
