import type { AuditorPackData } from '../types';

interface ReadOnlyBannerProps {
  packData: AuditorPackData | null;
}

export default function ReadOnlyBanner({ packData }: ReadOnlyBannerProps) {
  if (!packData) return null;
  return (
    <div className="read-only-banner">
      <span>Read-only evidence viewer. Verification must be performed via pact-verifier CLI.</span>
    </div>
  );
}
