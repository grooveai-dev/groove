// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { Tooltip } from '../ui/tooltip';
import { HelpCircle } from 'lucide-react';

function MiniSparkline({ data, color = HEX.text3, width = 72, height = 22 }) {
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

  const gradId = `kpi-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.8" />
    </svg>
  );
}

const KpiCard = memo(function KpiCard({ label, value, sparkData, color = HEX.text3, hint, className }) {
  return (
    <div className={cn(
      'flex items-center gap-2.5 px-3 py-2.5 min-w-0',
      'bg-surface-1',
      className,
    )}>
      <div className="flex-1 min-w-0">
        <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5 truncate flex items-center gap-1">
          {label}
          {hint && (
            <Tooltip content={<span className="max-w-[220px] block leading-relaxed">{hint}</span>} side="bottom">
              <HelpCircle size={10} className="text-text-4 hover:text-text-2 cursor-help flex-shrink-0 transition-colors" />
            </Tooltip>
          )}
        </div>
        <div className="text-base font-semibold font-mono text-text-0 tabular-nums leading-none">{value}</div>
      </div>
      <MiniSparkline data={sparkData} color={color} />
    </div>
  );
});

export function KpiStrip({ kpis }) {
  return (
    <div className="flex flex-wrap border-b border-border bg-surface-0">
      {kpis.map((kpi) => (
        <KpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          sparkData={kpi.sparkData}
          color={kpi.color}
          hint={kpi.hint}
          className={cn(
            'flex-1 basis-[12.5%] min-w-[140px]',
            'border-b border-r border-border',
          )}
        />
      ))}
    </div>
  );
}

export { KpiCard };
