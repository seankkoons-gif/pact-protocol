import type { GCView } from '../types';
import './Panel.css';

interface OutcomePanelProps {
  gcView: GCView;
}

export default function OutcomePanel({ gcView }: OutcomePanelProps) {
  const { status, what_happened, money_moved, final_outcome, settlement_attempted } = gcView.executive_summary;

  return (
    <div className="panel outcome-panel">
      <h2 className="panel-title">OUTCOME</h2>
      <div className="panel-content">
        <div className="outcome-status">{status}</div>
        <p className="outcome-description">{what_happened}</p>
        <div className="outcome-details">
          <div className="detail-item">
            <span className="detail-label">Money Moved:</span>
            <span className={`detail-value ${money_moved ? 'yes' : 'no'}`}>
              {money_moved ? 'YES' : 'NO'}
            </span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Final Outcome:</span>
            <span className="detail-value">{final_outcome}</span>
          </div>
          <div className="detail-item">
            <span className="detail-label">Settlement Attempted:</span>
            <span className="detail-value">{settlement_attempted ? 'Yes' : 'No'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
