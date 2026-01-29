import type { InsurerSummary, GCView, Judgment } from '../types';
import { formatConfidence } from '../lib/loadPack';
import './Panel.css';

interface PassportPanelProps {
  insurerSummary: InsurerSummary;
  gcView: GCView;
  judgment: Judgment;
  transcriptId: string;
}

export default function PassportPanel({ insurerSummary, gcView, judgment, transcriptId: _transcriptId }: PassportPanelProps) {
  const { buyer, provider, constitution_warning } = insurerSummary;
  const hasNonStandardRules = insurerSummary.risk_factors?.includes('NON_STANDARD_RULES') ||
                               insurerSummary.surcharges?.includes('NON_STANDARD_CONSTITUTION') ||
                               !!constitution_warning;
  const lowConfidence = judgment.confidence < 0.7;
  const recentFailure = gcView.executive_summary.status.startsWith('FAILED_') || 
                         gcView.executive_summary.status.startsWith('ABORTED_');

  const getTierColor = (tier: string): string => {
    if (tier === 'A') return '#006600';
    if (tier === 'B') return '#CC9900';
    if (tier === 'C') return '#CC0000';
    return '#666666';
  };

  const formatScore = (score: number): string => {
    return score >= 0 ? `+${score.toFixed(3)}` : score.toFixed(3);
  };

  return (
    <div className="panel passport-panel">
      <h2 className="panel-title">PASSPORT</h2>
      <div className="panel-content">
        <div className="passport-note">
          <p>Passport scores are derived from verified Pact transcripts. Full history requires the passport registry.</p>
        </div>

        {buyer && (
          <div className="passport-entity">
            <div className="passport-entity-header">
              <span className="passport-entity-label">Buyer</span>
              <span 
                className="passport-tier-badge"
                style={{ borderColor: getTierColor(buyer.tier), color: getTierColor(buyer.tier) }}
              >
                Tier {buyer.tier}
              </span>
            </div>
            <div className="passport-entity-details">
              <span className="passport-score">Score: {formatScore(buyer.passport_score)}</span>
            </div>
          </div>
        )}

        {provider && (
          <div className="passport-entity">
            <div className="passport-entity-header">
              <span className="passport-entity-label">Provider</span>
              <span 
                className="passport-tier-badge"
                style={{ borderColor: getTierColor(provider.tier), color: getTierColor(provider.tier) }}
              >
                Tier {provider.tier}
              </span>
            </div>
            <div className="passport-entity-details">
              <span className="passport-score">Score: {formatScore(provider.passport_score)}</span>
            </div>
          </div>
        )}

        {!buyer && !provider && (
          <div className="passport-empty">
            <p>No passport data available for this transaction.</p>
          </div>
        )}

        {/* Warnings */}
        {(hasNonStandardRules || lowConfidence || recentFailure) && (
          <div className="passport-warnings">
            <div className="passport-warnings-title">⚠️ Warnings:</div>
            {hasNonStandardRules && (
              <div className="passport-warning-item">
                Non-standard constitution rules detected
              </div>
            )}
            {lowConfidence && (
              <div className="passport-warning-item">
                Low confidence ({formatConfidence(judgment.confidence)})
              </div>
            )}
            {recentFailure && (
              <div className="passport-warning-item">
                Recent failure: {gcView.executive_summary.status}
              </div>
            )}
          </div>
        )}

        <div className="passport-registry-note">
          <p className="passport-registry-text">
            <strong>Full Passport History:</strong> Query the passport registry for complete history:
          </p>
          <code className="passport-command">
            pact-verifier passport-v1-query --signer &lt;pubkey&gt;
          </code>
        </div>
      </div>
    </div>
  );
}
