import CopyVerifyCommandButton from './CopyVerifyCommandButton';
import './ReadOnlyBanner.css';

interface ReadOnlyBannerProps {
  packFileName?: string;
}

export default function ReadOnlyBanner({ packFileName }: ReadOnlyBannerProps) {
  return (
    <div className="read-only-banner">
      <div className="banner-header">
        <h2 className="banner-title">Read-Only Evidence Viewer</h2>
        {packFileName && (
          <CopyVerifyCommandButton packFileName={packFileName} variant="banner" />
        )}
      </div>
      <p className="banner-text">
        Source of truth is the Auditor Pack ZIP. This viewer does not execute transactions.
      </p>
      <div className="banner-verification">
        <span className="verification-label">Verification:</span>
        <code className="verification-command">
          pact-verifier auditor-pack-verify --zip {packFileName || '<file>'}
        </code>
      </div>
      <p className="banner-note">
        All outputs are derived from signed transcripts and a fixed Constitution hash.
      </p>
    </div>
  );
}
