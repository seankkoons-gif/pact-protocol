import type { InsurerSummary } from "../types";

interface InsurancePanelProps {
  insurerSummary: InsurerSummary;
}

export default function InsurancePanel({ insurerSummary }: InsurancePanelProps) {
  return (
    <div className="insurance-panel">
      <span>Coverage: {insurerSummary.coverage}</span>
    </div>
  );
}
