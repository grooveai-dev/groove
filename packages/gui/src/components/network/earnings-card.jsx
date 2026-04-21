// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Badge } from '../ui/badge';

const ROWS = [
  { label: 'Today', value: '—' },
  { label: 'This Week', value: '—' },
  { label: 'All Time', value: '—' },
];

export const EarningsCard = memo(function EarningsCard() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">EARNINGS</span>
        <Badge variant="purple">SOON</Badge>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {ROWS.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-2xs font-sans text-text-4">{row.label}</span>
            <span className="text-xs font-mono text-text-3 tabular-nums">{row.value}</span>
          </div>
        ))}
        <div className="text-2xs text-text-4 mt-2 italic">Connect wallet to track earnings</div>
      </div>
    </div>
  );
});
