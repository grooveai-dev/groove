// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { Tooltip } from '../ui/tooltip';
import { HelpCircle } from 'lucide-react';

const BAR_WIDTH = 28;

function gaugeColor(ratio) {
  if (ratio > 0.9) return HEX.danger;
  if (ratio > 0.7) return HEX.warning;
  return HEX.success;
}

function fmtMbToGb(mb) {
  if (!mb) return '0';
  return (mb / 1024).toFixed(1);
}

function AsciiBar({ label, value, max, unit, nodeCount }) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = '\u2502'.repeat(filled) + '\u2500'.repeat(empty);
  const color = gaugeColor(ratio);

  let displayVal, displayMax;
  if (unit === 'GB') {
    displayVal = fmtMbToGb(value);
    displayMax = fmtMbToGb(max);
  } else if (unit === 'cores' || unit === 'Mbps') {
    displayVal = Math.round(value);
    displayMax = Math.round(max);
  } else {
    displayVal = value.toFixed(1);
    displayMax = max.toFixed(1);
  }

  return (
    <div className="flex items-center gap-2 font-mono text-xs leading-tight">
      <span className="w-[40px] text-right text-text-3 uppercase text-2xs tracking-wider flex-shrink-0">
        {label}
      </span>
      <span className="text-text-4">[</span>
      <span style={{ color: ratio > 0 ? color : undefined }} className={cn('whitespace-pre', !ratio && 'text-text-4')}>
        {bar}
      </span>
      <span className="text-text-4">]</span>
      <span className="text-text-1 tabular-nums whitespace-nowrap text-2xs">
        {displayVal} / {displayMax} {unit}
      </span>
      {nodeCount != null && (
        <span className="text-text-4 text-2xs whitespace-nowrap">({nodeCount} nodes)</span>
      )}
    </div>
  );
}

function MiniSparkline({ data, color = HEX.accent, width = 72, height = 22 }) {
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
  const gradId = `net-${color.replace('#', '')}`;
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

function KpiCard({ label, value, color = HEX.accent, hint, className }) {
  return (
    <div className={cn('flex items-center gap-2.5 px-3 py-2.5 min-w-0 bg-surface-1', className)}>
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
    </div>
  );
}

const MAX_RAM_MB = 256 * 1024;
const MAX_VRAM_MB = 128 * 1024;
const MAX_CPU = 128;
const MAX_LOAD = 4.0;

export const ComputeHeader = memo(function ComputeHeader() {
  const compute = useGrooveStore((s) => s.networkCompute);
  const nodes = useGrooveStore((s) => s.networkStatus.nodes || []);
  const models = useGrooveStore((s) => s.networkStatus.models || []);
  const allZero = !compute.totalRamMb && !compute.totalVramMb && !compute.totalCpuCores;

  const activeNodes = nodes.filter((n) => n.status === 'active');
  const avgGpuUtil = activeNodes.length > 0
    ? activeNodes.reduce((s, n) => s + (n.gpu_utilization_pct || 0), 0) / activeNodes.length
    : 0;
  const gpuColor = avgGpuUtil > 80 ? HEX.danger : avgGpuUtil > 50 ? HEX.warning : HEX.success;
  const loadColor = compute.avgLoad > 2.0 ? HEX.danger : compute.avgLoad > 1.0 ? HEX.warning : HEX.success;
  const activeModel = models.length > 0
    ? (typeof models[0] === 'string' ? models[0] : models[0].name)
    : 'Qwen/Qwen3-4B';

  const kpis = [
    { label: 'RAM', value: `${fmtMbToGb(compute.totalRamMb)} GB`, color: HEX.accent, hint: 'Total RAM across all network nodes.' },
    { label: 'VRAM', value: `${fmtMbToGb(compute.totalVramMb)} GB`, color: HEX.info, hint: 'Total GPU VRAM across all network nodes.' },
    { label: 'CPU Cores', value: `${compute.totalCpuCores}`, color: HEX.purple, hint: 'Total CPU cores across all network nodes.' },
    { label: 'GPU Util', value: avgGpuUtil > 0 ? `${Math.round(avgGpuUtil)}%` : '--', color: gpuColor, hint: 'Average GPU utilization across active nodes. Green <50%, yellow 50-80%, red >80%.' },
    { label: 'Nodes', value: `${compute.activeNodes}/${compute.totalNodes}`, color: HEX.accent, hint: 'Active nodes out of total registered.' },
    { label: 'Load', value: compute.avgLoad > 0 ? compute.avgLoad.toFixed(2) : '0.00', color: loadColor, hint: 'Average load across active nodes. Green <1.0, yellow 1.0-2.0, red >2.0.' },
    { label: 'Model', value: activeModel, color: HEX.info, hint: 'Active inference model on the network.' },
  ];

  return (
    <div className="flex-shrink-0">
      <div className="flex flex-wrap border-b border-border" style={{ background: 'var(--color-surface-0)' }}>
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            color={kpi.color}
            hint={kpi.hint}
            className={cn('flex-1 basis-[14.2%] min-w-[110px]', 'border-b border-r border-border')}
          />
        ))}
      </div>

      <div className="bg-surface-1 border-b border-border px-4 py-2.5">
        {allZero ? (
          <div className="text-2xs font-mono text-text-4">Waiting for network data...</div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <AsciiBar label="RAM" value={compute.totalRamMb} max={MAX_RAM_MB} unit="GB" nodeCount={compute.totalNodes} />
            <AsciiBar label="VRAM" value={compute.totalVramMb} max={MAX_VRAM_MB} unit="GB" nodeCount={compute.totalNodes} />
            <AsciiBar label="CPU" value={compute.totalCpuCores} max={MAX_CPU} unit="cores" />
            <AsciiBar label="GPU%" value={avgGpuUtil} max={100} unit="%" />
            <AsciiBar label="LOAD" value={compute.avgLoad} max={MAX_LOAD} unit="" />
          </div>
        )}
      </div>
    </div>
  );
});
