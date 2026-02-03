import type { GCView } from '../types';

interface ExecutionSummaryPanelProps {
  gcView: GCView;
  transcriptJson?: string;
  replayVerifyResult?: { errors?: Array<{ round_number?: number; message?: string }> } | null;
}

const ROUND_TYPE_TO_STEP: Record<string, string> = {
  INTENT: 'Quote requested',
  ASK: 'Quote provided',
  BID: 'Quote provided',
  COUNTER: 'Counter offer',
  ACCEPT: 'Accept',
  REJECT: 'Reject',
  ABORT: 'Abort',
};

function stepName(event: string): string {
  return ROUND_TYPE_TO_STEP[event] ?? event;
}

function settlementStatusFromPack(
  status: string | undefined,
  settlementAttempted: boolean | undefined
): 'COMPLETED' | 'ABORTED' | 'FAILED' | 'NOT_ATTEMPTED' | null {
  if (settlementAttempted === false) return 'NOT_ATTEMPTED';
  if (!status) return null;
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'ABORTED_POLICY') return 'ABORTED';
  if (status.startsWith('FAILED')) return 'FAILED';
  return null;
}

export default function ExecutionSummaryPanel({
  gcView,
  transcriptJson,
  replayVerifyResult,
}: ExecutionSummaryPanelProps) {
  const es = gcView?.executive_summary;

  const moneyMoved = es?.money_moved;
  const moneyMovedLabel =
    moneyMoved === true ? 'YES' : moneyMoved === false ? 'NO' : 'UNKNOWN';
  const settlementAttempted = es?.settlement_attempted;
  const settlementAttemptedLabel =
    settlementAttempted === true ? 'YES' : settlementAttempted === false ? 'NO' : '—';

  const settlementStatus = settlementStatusFromPack(es?.status, settlementAttempted);

  // Steps from gc_view.timeline or transcript rounds
  const gcTimeline = (gcView as { timeline?: Array<{ event: string; round?: number }> }).timeline;
  let steps: Array<{ step: string; event: string; round?: number }> = [];

  if (gcTimeline?.length) {
    steps = gcTimeline.map((t) => ({
      step: stepName(t.event),
      event: t.event,
      round: t.round,
    }));
  } else if (transcriptJson) {
    try {
      const t = JSON.parse(transcriptJson);
      const rounds = t?.rounds ?? [];
      steps = rounds.map((r: { round_type?: string; round_number?: number }) => ({
        step: stepName(r.round_type ?? ''),
        event: r.round_type ?? '',
        round: r.round_number,
      }));
    } catch {
      steps = [];
    }
  }

  const roundErrors = new Map(
    (replayVerifyResult?.errors ?? []).map((e) => [e.round_number, e.message])
  );

  function stepResult(round?: number): 'SUCCESS' | 'FAILED' | 'SKIPPED' {
    if (round != null && roundErrors.has(round)) return 'FAILED';
    return 'SUCCESS';
  }

  const stepsWithResult = steps.map((s) => ({
    ...s,
    result: stepResult(s.round),
    reason: s.round != null ? roundErrors.get(s.round) : undefined,
  }));

  // Add Settlement attempt row when settlement was attempted
  if (settlementAttempted && settlementStatus) {
    stepsWithResult.push({
      step: 'Settlement attempt',
      event: 'SETTLEMENT',
      round: undefined,
      result: settlementStatus === 'COMPLETED' ? 'SUCCESS' : 'FAILED',
      reason:
        settlementStatus === 'ABORTED'
          ? 'Policy aborted'
          : settlementStatus === 'FAILED'
          ? es?.status ?? undefined
          : undefined,
    });
  }

  const moneyMovedClass =
    moneyMovedLabel === 'YES' ? 'status-good' : moneyMovedLabel === 'NO' ? 'status-bad' : 'status-warn';
  const settlementClass =
    settlementAttemptedLabel === 'YES' ? 'status-good' : settlementAttemptedLabel === 'NO' ? 'status-bad' : '';

  return (
    <div className="execution-summary-panel panel">
      <h3>Execution Summary</h3>

      <div className="execution-summary-top">
        <div className="execution-summary-row">
          <span className="execution-summary-label">Money Moved:</span>
          <span className={`execution-summary-value ${moneyMovedClass}`}>{moneyMovedLabel}</span>
        </div>
        <div className="execution-summary-row">
          <span className="execution-summary-label">Settlement Attempted:</span>
          <span className={`execution-summary-value ${settlementClass}`}>
            {settlementAttemptedLabel}
          </span>
        </div>
        {settlementStatus && settlementAttempted && (
          <div className="execution-summary-row">
            <span className="execution-summary-label">Settlement Status:</span>
            <span
              className={`execution-summary-value ${
                settlementStatus === 'COMPLETED'
                  ? 'status-good'
                  : settlementStatus === 'FAILED' || settlementStatus === 'ABORTED'
                  ? 'status-bad'
                  : 'status-warn'
              }`}
            >
              {settlementStatus}
            </span>
          </div>
        )}
      </div>

      {stepsWithResult.length > 0 ? (
        <div className="execution-summary-steps">
          <table className="execution-summary-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Result</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {stepsWithResult.map((row, i) => (
                <tr key={i}>
                  <td>{row.step || '—'}</td>
                  <td>
                    <span
                      className={
                        row.result === 'SUCCESS'
                          ? 'status-good'
                          : row.result === 'FAILED'
                          ? 'status-bad'
                          : 'status-warn'
                      }
                    >
                      {row.result}
                    </span>
                  </td>
                  <td className="execution-summary-reason">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="execution-summary-empty">No execution steps in this pack.</p>
      )}
    </div>
  );
}
