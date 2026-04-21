// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { Tooltip } from '../ui/tooltip';
import { HelpCircle } from 'lucide-react';

function fmtMbToGb(mb) {
  if (!mb) return '0';
  return (mb / 1024).toFixed(1);
}

function MiniSparkline({ data, color = HEX.accent, width = 60, height = 16 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const vals = data.map((d) => (typeof d === 'number' ? d : d.v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');
  const gradId = `ch-${color.replace('#', '')}`;
  return (
    <svg width={width} height={height} className="flex-shrink-0 mt-1">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${points} ${width},${height}`} fill={`url(#${gradId})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeOpacity="0.8" />
    </svg>
  );
}

function KpiCard({ label, value, color, hint, sparkData, className }) {
  return (
    <div className={cn('px-3 py-2 min-w-0', className)}>
      <div className="text-2xs font-mono text-text-4 uppercase tracking-wider truncate flex items-center gap-1">
        {label}
        {hint && (
          <Tooltip content={<span className="max-w-[220px] block leading-relaxed">{hint}</span>} side="bottom">
            <HelpCircle size={9} className="text-text-4 hover:text-text-2 cursor-help flex-shrink-0 transition-colors" />
          </Tooltip>
        )}
      </div>
      <div className="text-base font-mono font-semibold tabular-nums leading-none mt-0.5" style={{ color: color || HEX.text0 }}>
        {value}
      </div>
      {sparkData && <MiniSparkline data={sparkData} color={color || HEX.accent} />}
    </div>
  );
}

export const ComputeHeader = memo(function ComputeHeader() {
  const compute = useGrooveStore((s) => s.networkCompute);
  const status = useGrooveStore((s) => s.networkStatus);
  const snapshots = useGrooveStore((s) => s.networkSnapshots);
  const nodes = status.nodes || [];

  const activeNodes = nodes.filter((n) => n.status === 'active');
  const avgGpuUtil = activeNodes.length > 0
    ? activeNodes.reduce((s, n) => s + (n.gpu_utilization_pct || 0), 0) / activeNodes.length
    : 0;

  const totalLayers = status.totalLayers || 36;
  const covered = status.coverage || 0;
  const coverageColor = covered >= totalLayers ? HEX.success : covered >= totalLayers * 0.5 ? HEX.warning : HEX.danger;
  const gpuColor = avgGpuUtil > 80 ? HEX.danger : avgGpuUtil > 50 ? HEX.warning : HEX.success;

  const nodeSnap = snapshots.map((s) => ({ v: s.nodeCount ?? 0 }));
  const sessionSnap = snapshots.map((s) => ({ v: s.globalSessions ?? 0 }));
  const vramSnap = snapshots.map((s) => ({ v: s.totalVramMb ?? 0 }));
  const ramSnap = snapshots.map((s) => ({ v: s.totalRamMb ?? 0 }));

  const kpis = [
    {
      label: 'NODES', value: `${compute.activeNodes}/${compute.totalNodes}`,
      color: HEX.accent, hint: 'Active nodes / total registered', sparkData: nodeSnap,
    },
    {
      label: 'SESSIONS', value: `${status.activeSessions || 0}`,
      color: HEX.info, hint: 'Active inference sessions', sparkData: sessionSnap,
    },
    {
      label: 'COVERAGE', value: `${covered}/${totalLayers}`,
      color: coverageColor, hint: 'Layer coverage — green=full, orange=partial, red=<50%',
    },
    {
      label: 'VRAM', value: `${fmtMbToGb(compute.totalVramMb)} GB`,
      color: HEX.purple, hint: 'Total GPU VRAM across nodes', sparkData: vramSnap,
    },
    {
      label: 'RAM', value: `${fmtMbToGb(compute.totalRamMb)} GB`,
      color: HEX.info, hint: 'Total RAM across nodes', sparkData: ramSnap,
    },
    {
      label: 'GPU UTIL', value: avgGpuUtil > 0 ? `${Math.round(avgGpuUtil)}%` : '--',
      color: gpuColor, hint: 'Average GPU utilization — green <50%, yellow 50-80%, red >80%',
    },
  ];

  return (
    <div className="flex flex-shrink-0 border-b border-border-subtle bg-surface-0">
      {kpis.map((kpi, i) => (
        <KpiCard
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          color={kpi.color}
          hint={kpi.hint}
          sparkData={kpi.sparkData}
          className={cn(
            'basis-[16%] min-w-[120px] flex-shrink-0',
            i < kpis.length - 1 && 'border-r border-border-subtle',
          )}
        />
      ))}
    </div>
  );
});
