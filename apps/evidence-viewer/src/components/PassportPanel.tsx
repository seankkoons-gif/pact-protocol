import { useState, useCallback } from 'react';
import type { Manifest, InsurerSummary } from '../types';

interface PassportPanelProps {
  manifest: Manifest;
  transcriptJson?: string;
  gcView?: { subject?: { parties?: Array<{ role: string; signer_pubkey: string }> } };
  judgment?: { responsible_signer_pubkey?: string };
  insurerSummary?: InsurerSummary | null;
  transcriptId?: string;
}

const SCORE_HELPER =
  'Score = reputation delta snapshot from this pack (unitless). Higher is better. Not a dollar amount.';

function truncate(s: string, len = 12): string {
  return s.length <= len ? s : s.slice(0, len) + '...';
}

function formatTimestamp(ms: number): string {
  try {
    return new Date(ms).toISOString();
  } catch {
    return String(ms);
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button type="button" className="copy-btn-inline" onClick={handleCopy} title="Copy">
      {copied ? 'Copied' : label}
    </button>
  );
}

const NOT_PRESENT = 'Not present in this pack.';

function PassportBox({
  title,
  tier,
  score,
}: {
  title: string;
  tier: string | null;
  score: number | null;
}) {
  const tierDisplay = tier != null ? `Tier ${tier}` : 'Unavailable';
  const scoreDisplay = score != null ? String(score) : 'Unavailable';

  return (
    <div className="passport-box">
      <h4 className="passport-box-title">{title}</h4>
      <div className="passport-box-tier">{tierDisplay}</div>
      <div className="passport-box-score">{scoreDisplay}</div>
      <p className="passport-box-helper">{SCORE_HELPER}</p>
    </div>
  );
}

export default function PassportPanel({
  manifest,
  transcriptJson,
  gcView,
  judgment,
  insurerSummary,
}: PassportPanelProps) {
  const [fullHistoryUseProvider, setFullHistoryUseProvider] = useState(false);

  const parties = gcView?.subject?.parties ?? [];
  const buyer = parties.find((p) => p.role === 'buyer');
  const provider = parties.find((p) => p.role === 'provider');

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

  const buyerPubkey = buyer?.signer_pubkey ?? transcriptParties.find((p) => /buyer/i.test(p.role ?? ''))?.pubkey;
  const providerPubkey = provider?.signer_pubkey ?? transcriptParties.find((p) => /provider/i.test(p.role ?? ''))?.pubkey;
  const dblSigner = judgment?.responsible_signer_pubkey;

  const buyerTier = insurerSummary?.buyer?.tier ?? null;
  const buyerScore = insurerSummary?.buyer?.passport_score ?? null;
  const providerTier = insurerSummary?.provider?.tier ?? null;
  const providerScore = insurerSummary?.provider?.passport_score ?? null;

  const lastUpdatedMs = manifest.passport_last_updated_ms;
  const fullHistoryPubkey = fullHistoryUseProvider && providerPubkey
    ? providerPubkey
    : buyerPubkey ?? providerPubkey ?? dblSigner;
  const canToggleProvider = Boolean(buyerPubkey && providerPubkey && buyerPubkey !== providerPubkey);

  const fullHistoryCmd = `node packages/verifier/dist/bin/pact-verifier.js passport-v1-query --signer ${fullHistoryPubkey ?? '<pubkey>'}`;

  return (
    <div className="passport-panel panel">
      <h3>Passport</h3>
      <p className="passport-disclaimer">Read-only snapshot. No computation.</p>

      <div className="passport-boxes-row">
        <PassportBox title="Buyer Passport" tier={buyerTier} score={buyerScore} />
        <PassportBox title="Provider Passport" tier={providerTier} score={providerScore} />
      </div>

      <div className="passport-pubkeys">
        <div className="passport-pubkey-row">
          <span className="passport-pubkey-label">Buyer</span>
          {buyerPubkey ? (
            <span className="case-meta-copy-row">
              <code title={buyerPubkey}>{truncate(buyerPubkey, 16)}</code>
              <CopyButton text={buyerPubkey} />
            </span>
          ) : (
            <span className="passport-muted">{NOT_PRESENT}</span>
          )}
        </div>
        <div className="passport-pubkey-row">
          <span className="passport-pubkey-label">Provider</span>
          {providerPubkey ? (
            <span className="case-meta-copy-row">
              <code title={providerPubkey}>{truncate(providerPubkey, 16)}</code>
              <CopyButton text={providerPubkey} />
            </span>
          ) : (
            <span className="passport-muted">{NOT_PRESENT}</span>
          )}
        </div>
        <div className="passport-pubkey-row">
          <span className="passport-pubkey-label">DBL Responsible Signer</span>
          {dblSigner ? (
            <span className="case-meta-copy-row">
              <code title={dblSigner}>{truncate(dblSigner, 16)}</code>
              <CopyButton text={dblSigner} />
            </span>
          ) : (
            <span className="passport-muted">{NOT_PRESENT}</span>
          )}
        </div>
      </div>

      {lastUpdatedMs != null && (
        <p className="passport-last-updated">
          Last updated: {formatTimestamp(lastUpdatedMs)}
        </p>
      )}

      <div className="passport-full-history">
        <span className="passport-hint">Full history</span>
        <pre className="passport-command">
          <code>{fullHistoryCmd}</code>
        </pre>
        <div className="passport-command-actions">
          <CopyButton text={fullHistoryCmd} label="Copy" />
          {canToggleProvider && (
            <button
              type="button"
              className="copy-btn-inline passport-toggle-signer"
              onClick={() => setFullHistoryUseProvider((p) => !p)}
            >
              {fullHistoryUseProvider ? 'Use buyer' : 'Use provider'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
