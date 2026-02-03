import type { GCView } from '../types';

interface WhatHappenedOneLinerProps {
  gcView: GCView;
}

export default function WhatHappenedOneLiner({ gcView }: WhatHappenedOneLinerProps) {
  const es = gcView.executive_summary;
  if (!es) return null;

  const status = es.status ?? '—';
  const moneyMoved = es.money_moved ? 'YES' : 'NO';
  const settlementAttempted = es.settlement_attempted ? 'YES' : 'NO';

  return (
    <p className="what-happened-one-liner">
      {status} — Money moved: {moneyMoved} — Settlement attempted: {settlementAttempted}
    </p>
  );
}
