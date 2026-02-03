import type { ReplayVerifyResultView, PackVerifyResultView } from '../types';

interface RoundsTimelineProps {
  transcriptJson?: string;
  replayVerifyResult?: ReplayVerifyResultView | null;
  packVerifyResult?: PackVerifyResultView | null;
}

export default function RoundsTimeline({
  transcriptJson,
  replayVerifyResult,
  packVerifyResult,
}: RoundsTimelineProps) {
  let rounds: Array<{ round_number?: number; round_type?: string; agent_id?: string }> = [];
  try {
    const t = transcriptJson ? JSON.parse(transcriptJson) : null;
    rounds = t?.rounds ?? [];
  } catch {
    rounds = [];
  }

  return (
    <div className="rounds-timeline panel">
      <h3>Rounds</h3>
      {rounds.length > 0 ? (
        <ol className="rounds-list">
          {rounds.map((r, i) => (
            <li key={i} className="round-item">
              <span className="round-num">Round {r.round_number ?? i + 1}</span>
              <span className="round-type">{r.round_type ?? '—'}</span>
              {r.agent_id && (
                <code className="round-agent" title={r.agent_id}>
                  {r.agent_id.slice(0, 12)}...
                </code>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">No rounds data</p>
      )}
      {replayVerifyResult?.rounds_verified != null && (
        <p className="rounds-verified">Rounds verified: {replayVerifyResult.rounds_verified}</p>
      )}
      {packVerifyResult && (
        <p className="pack-verify-summary">
          Pack verify: {(packVerifyResult as { ok?: boolean }).ok ? 'OK' : 'Failed'}
        </p>
      )}
    </div>
  );
}
