import type { GCView } from '../types';

interface OutcomePanelProps {
  gcView: GCView;
}

export default function OutcomePanel({ gcView }: OutcomePanelProps) {
  const es = gcView.executive_summary;
  if (!es) return null;

  return (
    <div className="outcome-panel panel">
      <h3>Outcome</h3>
      <div className="outcome-status">{es.status}</div>
      <p className="outcome-what">{es.what_happened}</p>
      <div className="outcome-money">
        <strong>Money Moved:</strong> {es.money_moved ? 'Yes' : 'No'}
      </div>
      <p className="outcome-final">{es.final_outcome}</p>
      <div className="outcome-settlement">
        <strong>Settlement Attempted:</strong> {es.settlement_attempted ? 'Yes' : 'No'}
      </div>
    </div>
  );
}
