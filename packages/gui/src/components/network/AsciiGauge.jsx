// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';

const BAR_WIDTH = 24;

function formatValue(val, unit) {
  if (unit === 'GB') return (val / 1024).toFixed(1);
  if (unit === 'cores') return Math.round(val);
  if (unit === 'Mbps') return Math.round(val);
  if (unit === '%') return val.toFixed(1);
  return String(val);
}

export function AsciiGauge({ label, value, max, unit, nodeCount }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = '|'.repeat(filled) + '-'.repeat(empty);
  const displayVal = formatValue(value, unit);
  const displayMax = formatValue(max, unit);

  return (
    <div className="flex items-center gap-2 font-mono text-xs leading-tight">
      <span className="w-[52px] text-right text-text-3 uppercase text-2xs tracking-wider flex-shrink-0">
        {label}
      </span>
      <span className="text-text-4">[</span>
      <span className={cn('whitespace-pre', ratio > 0 ? 'text-success' : 'text-text-4')}>
        {bar}
      </span>
      <span className="text-text-4">]</span>
      <span className="text-text-1 tabular-nums whitespace-nowrap">
        {displayVal} / {displayMax} {unit}
      </span>
      {nodeCount != null && (
        <span className="text-text-4 text-2xs whitespace-nowrap">({nodeCount} nodes)</span>
      )}
    </div>
  );
}
