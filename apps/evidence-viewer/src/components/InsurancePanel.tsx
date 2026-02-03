import type { InsurerSummary } from "../types";

interface InsurancePanelProps {
  insurerSummary: InsurerSummary;
}

export default function InsurancePanel({ insurerSummary }: InsurancePanelProps) {
  return (
    <div className="insurance-panel panel">
      <h3>Insurance</h3>
      <dl className="case-meta">
        <dt>Coverage</dt>
        <dd>{insurerSummary.coverage}</dd>
        {insurerSummary.risk_factors?.length ? (
          <>
            <dt>Risk Factors</dt>
            <dd>{insurerSummary.risk_factors.join(', ')}</dd>
          </>
        ) : null}
      </dl>
    </div>
  );
}
