import type { Judgment, GCView } from '../types';
import { formatConfidence, truncateHash } from '../lib/loadPack';
import './Panel.css';

interface ResponsibilityPanelProps {
  judgment: Judgment;
  gcView: GCView;
}

export default function ResponsibilityPanel({ judgment, gcView }: ResponsibilityPanelProps) {
  const { dblDetermination, requiredNextActor, requiredAction, terminal, confidence } = judgment;
  const { last_valid_signed_hash, blame_explanation } = gcView.responsibility;

  return (
    <div className="panel responsibility-panel">
      <h2 className="panel-title">RESPONSIBILITY</h2>
      <div className="panel-content">
        <div className="responsibility-item">
          <span className="responsibility-label">Fault Domain:</span>
          <span className="responsibility-value">{dblDetermination}</span>
        </div>
        <div className="responsibility-item">
          <span className="responsibility-label">Next Actor:</span>
          <span className="responsibility-value">{requiredNextActor}</span>
        </div>
        <div className="responsibility-item">
          <span className="responsibility-label">Required Action:</span>
          <span className="responsibility-value">{requiredAction}</span>
        </div>
        <div className="responsibility-item">
          <span className="responsibility-label">Terminal:</span>
          <span className="responsibility-value">{terminal ? 'Yes' : 'No'}</span>
        </div>
        <div className="responsibility-item">
          <span className="responsibility-label">Confidence:</span>
          <span className="responsibility-value">{formatConfidence(confidence)}</span>
          <div className="confidence-bar">
            <div 
              className="confidence-fill" 
              style={{ width: `${confidence * 100}%` }}
            />
          </div>
        </div>
        <div className="responsibility-item">
          <span className="responsibility-label">LVSH:</span>
          <code className="responsibility-value">{truncateHash(last_valid_signed_hash)}</code>
        </div>
        {blame_explanation && (
          <div className="blame-explanation">
            <div className="explanation-label">Blame Explanation:</div>
            <p>{blame_explanation}</p>
          </div>
        )}
      </div>
    </div>
  );
}
