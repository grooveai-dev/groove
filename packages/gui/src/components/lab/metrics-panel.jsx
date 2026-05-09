// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { Tooltip } from '../ui/tooltip';
import { cn } from '../../lib/cn';
import { fmtNum } from '../../lib/format';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { Zap, Clock, Cpu, Hash, Timer, Link } from 'lucide-react';

function TtftGauge({ value }) {
  if (value == null) {
    return (
      <div className="text-center py-4">
        <div className="text-2xl font-mono font-bold text-text-4 tabular-nums">--</div>
        <div className="text-2xs text-text-4 font-sans mt-1">TTFT</div>
      </div>
    );
  }
  const color = value < 200 ? 'text-success' : value < 500 ? 'text-warning' : 'text-danger';
  return (
    <div className="text-center py-4">
      <div className={cn('text-2xl font-mono font-bold tabular-nums', color)}>
        {Math.round(value)}
      </div>
      <div className="text-2xs text-text-3 font-sans mt-1">ms TTFT</div>
    </div>
  );
}

function Sparkline({ data, width = 140, height = 32, color = HEX.accent }) {
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
    <svg width={width} height={height} className="w-full">
      <polyline points={fillPoints} fill={hexAlpha(color, 0.08)} stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" strokeOpacity="0.7" />
    </svg>
  );
}

function MetricRow({ icon: Icon, label, value, unit, tooltip }) {
  const content = (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        <Icon size={11} className="text-text-4 flex-shrink-0" />
        <span className="text-2xs text-text-3 font-sans">{label}</span>
      </div>
      <span className="text-xs font-mono font-medium text-text-1 tabular-nums">
        {value != null ? value : '--'}{unit && value != null ? <span className="text-text-4 ml-0.5 text-2xs">{unit}</span> : ''}
      </span>
    </div>
  );
  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}

export function MetricsPanel() {
  const metrics = useGrooveStore((s) => s.labMetrics);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);

  return (
    <div className="space-y-5">
      {/* TTFT Gauge */}
      <TtftGauge value={metrics.ttft} />

      <div className="h-px bg-border-subtle" />

      {/* Tokens/sec with sparkline */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Zap size={11} className="text-accent" />
            <span className="text-2xs text-text-3 font-sans">Tokens/sec</span>
          </div>
          <span className="text-sm font-mono font-bold text-text-0 tabular-nums">
            {metrics.tokensPerSec != null ? metrics.tokensPerSec.toFixed(1) : '--'}
          </span>
        </div>
        <Sparkline data={metrics.tokensPerSecHistory} />
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Stats */}
      <div className="space-y-0">
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
        <>
          <div className="h-px bg-border-subtle" />
          <Tooltip content="Use current preset when spawning a new agent">
            <button className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-2xs font-sans text-text-3 hover:text-text-1 border border-border-subtle rounded-sm hover:border-border transition-colors cursor-pointer">
              <Link size={11} /> Attach to Agent
            </button>
          </Tooltip>
        </>
      )}
    </div>
  );
}
