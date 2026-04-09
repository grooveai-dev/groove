// FSL-1.1-Apache-2.0 — see LICENSE
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';

function MiniSparkline({ data, color = HEX.accent, width = 80, height = 24 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const vals = data.map((d) => d.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id={`kpi-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#kpi-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function KpiCard({ label, value, sparkData, color = HEX.accent, className }) {
  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-3 bg-surface-1 border-b border-border-subtle min-w-0',
      className,
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-2xs text-text-3 font-sans uppercase tracking-wider mb-0.5 truncate">{label}</div>
        <div className="text-lg font-semibold font-mono text-text-0 tabular-nums">{value}</div>
      </div>
      <MiniSparkline data={sparkData} color={color} />
    </div>
  );
}
