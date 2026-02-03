import type { Manifest, InsurerSummary } from '../types';

interface PassportPanelProps {
  manifest: Manifest;
  transcriptJson?: string;
  gcView?: { subject?: { parties?: Array<{ role: string; signer_pubkey: string }> } };
  judgment?: { responsible_signer_pubkey?: string };
  insurerSummary?: InsurerSummary | null;
  transcriptId?: string;
}

function truncate(s: string, len = 12): string {
  return s.length <= len ? s : s.slice(0, len) + '...';
}

export default function PassportPanel({
  manifest,
  transcriptJson,
  gcView,
  insurerSummary,
}: PassportPanelProps) {
  const parties = gcView?.subject?.parties ?? [];
  const passportSnapshot = manifest.passport_snapshot as Record<string, { tier?: string; score?: number }> | undefined;
  const records = passportSnapshot && typeof passportSnapshot === 'object' ? Object.entries(passportSnapshot) : [];

  let transcriptParties: Array<{ role?: string; pubkey?: string }> = [];
  try {
    const t = transcriptJson ? JSON.parse(transcriptJson) : null;
    const rounds = t?.rounds ?? [];
    const seen = new Set<string>();
    for (const r of rounds) {
      const pk = r.public_key_b58 ?? r.signature?.signer_public_key_b58;
      if (pk && !seen.has(pk)) {
        seen.add(pk);
        transcriptParties.push({ role: r.round_type, pubkey: pk });
      }
    }
  } catch {
    transcriptParties = [];
  }

  const displayParties = parties.length > 0 ? parties : transcriptParties.map((p) => ({ role: p.role ?? '—', signer_pubkey: p.pubkey ?? '—' }));

  return (
    <div className="passport-panel panel">
      <h3>Passport</h3>
      {displayParties.length > 0 ? (
        <ul className="passport-parties">
          {displayParties.map((p, i) => (
            <li key={i}>
              <span className="party-role">{p.role}</span>
              <code title={p.signer_pubkey}>{truncate(p.signer_pubkey, 16)}</code>
              {records.find(([k]) => k === p.signer_pubkey)?.[1] && (
                <span className="party-tier">
                  Tier {records.find(([k]) => k === p.signer_pubkey)?.[1]?.tier ?? '—'}, Score{' '}
                  {records.find(([k]) => k === p.signer_pubkey)?.[1]?.score ?? '—'}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="passport-empty-state">No passport snapshot present in this pack.</p>
      )}
      {insurerSummary?.buyer && (
        <p>
          Buyer: Tier {insurerSummary.buyer.tier}, Score {insurerSummary.buyer.passport_score}
        </p>
      )}
      {insurerSummary?.provider && (
        <p>
          Provider: Tier {insurerSummary.provider.tier}, Score {insurerSummary.provider.passport_score}
        </p>
      )}
    </div>
  );
}
