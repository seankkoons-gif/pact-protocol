import type { InsurerSummary } from '../types';
import './Panel.css';

interface InsurancePanelProps {
  insurerSummary: InsurerSummary;
}

export default function InsurancePanel({ insurerSummary }: InsurancePanelProps) {
  const { coverage, risk_factors, surcharges, buyer, provider, constitution_warning } = insurerSummary;

  const getCoverageColor = (coverage: string): string => {
    if (coverage === 'COVERED') return '#006600';
    if (coverage === 'EXCLUDED') return '#CC0000';
    if (coverage === 'COVERED_WITH_SURCHARGE' || coverage === 'ESCROW_REQUIRED') return '#CC9900';
    return '#666666';
  };

  return (
    <div className="panel insurance-panel">
      <h2 className="panel-title">INSURANCE</h2>
      <div className="panel-content">
        <div className="insurance-item">
          <span className="insurance-label">Coverage:</span>
          <span 
            className="insurance-badge" 
            style={{ borderColor: getCoverageColor(coverage), color: getCoverageColor(coverage) }}
          >
            {coverage}
          </span>
        </div>
        <div className="insurance-item">
          <span className="insurance-label">Risk Factors:</span>
          <div className="insurance-tags">
            {risk_factors.length > 0 ? (
              risk_factors.map((factor, i) => (
                <span key={i} className="insurance-tag">{factor}</span>
              ))
            ) : (
              <span className="insurance-empty">None</span>
            )}
          </div>
        </div>
        <div className="insurance-item">
          <span className="insurance-label">Surcharges:</span>
          <div className="insurance-tags">
            {surcharges.length > 0 ? (
              surcharges.map((surcharge, i) => (
                <span key={i} className="insurance-tag">{surcharge}</span>
              ))
            ) : (
              <span className="insurance-empty">None</span>
            )}
          </div>
        </div>
        {buyer && (
          <div className="insurance-item">
            <span className="insurance-label">Buyer Tier:</span>
            <span className="insurance-value">Tier {buyer.tier} ({buyer.passport_score})</span>
          </div>
        )}
        {provider && (
          <div className="insurance-item">
            <span className="insurance-label">Provider Tier:</span>
            <span className="insurance-value">Tier {provider.tier} ({provider.passport_score})</span>
          </div>
        )}
        {constitution_warning && (
          <div className="constitution-warning">
            <div className="warning-label">Constitution Warning:</div>
            <p>{constitution_warning}</p>
          </div>
        )}
      </div>
    </div>
  );
}
