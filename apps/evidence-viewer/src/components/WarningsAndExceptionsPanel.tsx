import type { AuditorPackData } from '../types';

interface WarningsAndExceptionsPanelProps {
  packData: AuditorPackData;
}

export default function WarningsAndExceptionsPanel({ packData }: WarningsAndExceptionsPanelProps) {
  const packVerify = packData.packVerifyResult as { mismatches?: string[] } | undefined;
  const mismatchWarnings = packVerify?.mismatches ?? packData.integrityResult?.warnings ?? [];
  const gcTakeaways = packData.gcView?.gc_takeaways;
  const why = gcTakeaways?.why ?? [];
  const openQuestions = gcTakeaways?.open_questions ?? [];
  const recommended = gcTakeaways?.recommended_remediation ?? [];

  const hasContent = mismatchWarnings.length > 0 || why.length > 0 || openQuestions.length > 0 || recommended.length > 0;

  if (!hasContent) return null;

  return (
    <div className="warnings-panel panel">
      <h3>Warnings &amp; Exceptions</h3>
      {mismatchWarnings.length > 0 && (
        <ul className="warnings-list">
          {mismatchWarnings.map((w, i) => (
            <li key={i} className="warn">
              {w}
            </li>
          ))}
        </ul>
      )}
      {why.length > 0 && (
        <div>
          <strong>Why</strong>
          <ul>
            {why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      {openQuestions.length > 0 && (
        <div>
          <strong>Open Questions</strong>
          <ul>
            {openQuestions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {recommended.length > 0 && (
        <div>
          <strong>Recommended Remediation</strong>
          <ul>
            {recommended.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
