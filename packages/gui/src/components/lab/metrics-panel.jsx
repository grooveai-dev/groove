// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/cn';
import { fmtNum } from '../../lib/format';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { Zap, Clock, Cpu, Hash, Timer, Link } from 'lucide-react';

function TtftGauge({ value }) {
  if (value == null) {
    return (
      <div className="text-center py-3">
        <div className="text-2xl font-mono font-bold text-text-4">—</div>
        <div className="text-2xs text-text-4 font-sans mt-0.5">TTFT</div>
      </div>
    );
  }
  const color = value < 200 ? 'success' : value < 500 ? 'warning' : 'danger';
  return (
    <div className="text-center py-3">
      <div className={cn('text-2xl font-mono font-bold', `text-${color}`)}>
        {Math.round(value)}
      </div>
      <div className="text-2xs text-text-3 font-sans mt-0.5">ms TTFT</div>
    </div>
  );
}

function Sparkline({ data, width = 120, height = 28, color = HEX.accent }) {
  if (!data || data.length < 2) {
    return <div className="flex-shrink-0" style={{ width, height }} />;
  }

  const vals = data.filter((v) => v != null);
  if (vals.length < 2) return <div className="flex-shrink-0" style={{ width, height }} />;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  const fillPoints = `0,${height} ${points} ${width},${height}`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={fillPoints} fill={hexAlpha(color, 0.1)} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeOpacity="0.8" />
    </svg>
  );
}

function MetricRow({ icon: Icon, label, value, unit, tooltip }) {
  const content = (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <Icon size={12} className="text-text-3 flex-shrink-0" />
        <span className="text-xs text-text-2 font-sans">{label}</span>
      </div>
      <span className="text-xs font-mono font-medium text-text-0">
        {value != null ? value : '—'}{unit && value != null ? <span className="text-text-3 ml-0.5">{unit}</span> : ''}
      </span>
    </div>
  );
  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}

export function MetricsPanel() {
  const metrics = useGrooveStore((s) => s.labMetrics);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);

  return (
    <div className="space-y-4">
      <span className="text-xs font-semibold font-sans text-text-2 uppercase tracking-wider">Metrics</span>

      {/* TTFT Gauge */}
      <div className="bg-surface-1 rounded-lg border border-border-subtle px-4 py-2">
        <TtftGauge value={metrics.ttft} />
      </div>

      {/* Tokens/sec with sparkline */}
      <div className="bg-surface-1 rounded-lg border border-border-subtle px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={12} className="text-accent" />
            <span className="text-xs text-text-2 font-sans">Tokens/sec</span>
          </div>
          <span className="text-sm font-mono font-bold text-text-0">
            {metrics.tokensPerSec != null ? metrics.tokensPerSec.toFixed(1) : '—'}
          </span>
        </div>
        <Sparkline data={metrics.tokensPerSecHistory} width={180} height={28} />
      </div>

      {/* Stats grid */}
      <div className="bg-surface-1 rounded-lg border border-border-subtle px-4 py-2 divide-y divide-border-subtle">
        <MetricRow
          icon={Cpu}
          label="Memory"
          value={metrics.memory != null ? `${(metrics.memory / 1024 / 1024).toFixed(0)}` : null}
          unit="MB"
          tooltip="GPU/CPU memory usage"
        />
        <MetricRow
          icon={Hash}
          label="Total Tokens"
          value={metrics.totalTokens > 0 ? fmtNum(metrics.totalTokens) : null}
          tooltip="Total tokens generated this session"
        />
        <MetricRow
          icon={Timer}
          label="Gen Time"
          value={metrics.generationTime != null ? `${(metrics.generationTime / 1000).toFixed(1)}` : null}
          unit="s"
          tooltip="Last generation time"
        />
      </div>

      {/* Attach to agent */}
      {activeRuntime && (
        <Tooltip content="Use current preset when spawning a new agent">
          <Button variant="outline" size="sm" className="w-full">
            <Link size={12} className="mr-1.5" /> Attach to Agent
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
