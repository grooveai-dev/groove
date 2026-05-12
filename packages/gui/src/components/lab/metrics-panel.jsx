// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { Tooltip } from '../ui/tooltip';
import { cn } from '../../lib/cn';
import { fmtNum } from '../../lib/format';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { Zap, Clock, Cpu, Hash, Timer, Link, MessageSquare, TrendingUp, ArrowUpRight, ArrowDownRight, Layers } from 'lucide-react';

function TtftGauge({ value }) {
  if (value == null) {
    return (
      <div className="text-center py-3">
        <div className="text-2xl font-mono font-bold text-text-4 tabular-nums">--</div>
        <div className="text-2xs text-text-4 font-sans mt-0.5">TTFT</div>
      </div>
    );
  }
  const color = value < 200 ? 'text-success' : value < 500 ? 'text-warning' : 'text-danger';
  return (
    <div className="text-center py-3">
      <div className={cn('text-2xl font-mono font-bold tabular-nums', color)}>
        {Math.round(value)}
      </div>
      <div className="text-2xs text-text-3 font-sans mt-0.5">ms TTFT</div>
    </div>
  );
}

function Sparkline({ data, width = 140, height = 28, color = HEX.accent }) {
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

function MetricRow({ icon: Icon, label, value, unit, tooltip, accent }) {
  const content = (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex items-center gap-2">
        <Icon size={11} className={cn('flex-shrink-0', accent ? 'text-accent' : 'text-text-4')} />
        <span className="text-2xs text-text-3 font-sans">{label}</span>
      </div>
      <span className="text-xs font-mono font-medium text-text-1 tabular-nums">
        {value != null ? value : '--'}{unit && value != null ? <span className="text-text-4 ml-0.5 text-2xs">{unit}</span> : ''}
      </span>
    </div>
  );
  return tooltip ? <Tooltip content={tooltip}>{content}</Tooltip> : content;
}

function SectionLabel({ children }) {
  return (
    <span className="text-2xs font-semibold font-sans text-text-4 uppercase tracking-wider">{children}</span>
  );
}

function CapacityBar({ used, total, label }) {
  if (!total) return null;
  const pct = Math.min((used / total) * 100, 100);
  const color = pct < 50 ? 'bg-success' : pct < 80 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-2xs text-text-3 font-sans">{label}</span>
        <span className="text-2xs font-mono text-text-2 tabular-nums">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 bg-surface-3 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-300', color)} style={{ width: `${pct}%` }} />
      </div>
      <div className="text-2xs font-mono text-text-4 tabular-nums">
        {fmtNum(used)} / {fmtNum(total)}
      </div>
    </div>
  );
}

function SparklineSection({ icon: Icon, label, value, unit, data, color = HEX.accent }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Icon size={11} className="text-accent" />
          <span className="text-2xs text-text-3 font-sans">{label}</span>
        </div>
        <span className="text-sm font-mono font-bold text-text-0 tabular-nums">
          {value != null ? value : '--'}{unit && value != null ? <span className="text-text-4 ml-0.5 text-xs">{unit}</span> : ''}
        </span>
      </div>
      <Sparkline data={data} color={color} />
    </div>
  );
}

export function MetricsPanel() {
  const metrics = useGrooveStore((s) => s.labMetrics);
  const activeRuntime = useGrooveStore((s) => s.labActiveRuntime);
  const activeSession = useGrooveStore((s) => s.labActiveSession);
  const sessions = useGrooveStore((s) => s.labSessions);

  const session = sessions.find((s) => s.id === activeSession);
  const messageCount = session?.messages?.length || 0;
  const generationCount = metrics.generationCount || 0;
  const avgTps = metrics.tokensPerSecHistory.length > 0
    ? (metrics.tokensPerSecHistory.reduce((a, b) => a + (b || 0), 0) / metrics.tokensPerSecHistory.length)
    : null;
  const avgTtft = metrics.ttftHistory?.length > 0
    ? (metrics.ttftHistory.reduce((a, b) => a + (b || 0), 0) / metrics.ttftHistory.length)
    : null;
  const peakTps = metrics.tokensPerSecHistory.length > 0
    ? Math.max(...metrics.tokensPerSecHistory.filter((v) => v != null))
    : null;

  const sessionDuration = metrics.sessionStartTime
    ? Math.round((Date.now() - metrics.sessionStartTime) / 1000)
    : null;

  function fmtDuration(secs) {
    if (secs == null) return null;
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }

  return (
    <div className="space-y-4">
      {/* Performance */}
      <TtftGauge value={metrics.ttft} />

      <SparklineSection
        icon={Zap}
        label="Tokens/sec"
        value={metrics.tokensPerSec != null ? metrics.tokensPerSec.toFixed(1) : null}
        data={metrics.tokensPerSecHistory}
      />

      {metrics.ttftHistory?.length > 1 && (
        <SparklineSection
          icon={Clock}
          label="TTFT Trend"
          value={metrics.ttft != null ? `${Math.round(metrics.ttft)}` : null}
          unit="ms"
          data={metrics.ttftHistory}
          color={HEX.warning || HEX.accent}
        />
      )}

      <div className="h-px bg-border-subtle" />

      {/* Token Usage */}
      <div className="space-y-1">
        <SectionLabel>Tokens</SectionLabel>
        <MetricRow
          icon={Hash}
          label="Total"
          value={metrics.totalTokens > 0 ? fmtNum(metrics.totalTokens) : null}
          tooltip="Total tokens generated this session"
        />
        {metrics.promptTokens > 0 && (
          <MetricRow
            icon={ArrowUpRight}
            label="Prompt"
            value={fmtNum(metrics.promptTokens)}
            tooltip="Input/prompt tokens"
          />
        )}
        {metrics.completionTokens > 0 && (
          <MetricRow
            icon={ArrowDownRight}
            label="Completion"
            value={fmtNum(metrics.completionTokens)}
            tooltip="Output/completion tokens"
          />
        )}
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Session Stats */}
      <div className="space-y-1">
        <SectionLabel>Session</SectionLabel>
        <MetricRow
          icon={MessageSquare}
          label="Messages"
          value={messageCount > 0 ? messageCount : null}
          tooltip="Messages in current session"
        />
        <MetricRow
          icon={Layers}
          label="Generations"
          value={generationCount > 0 ? generationCount : null}
          tooltip="Number of model generations"
        />
        {avgTps != null && (
          <MetricRow
            icon={TrendingUp}
            label="Avg TPS"
            value={avgTps.toFixed(1)}
            tooltip="Average tokens/sec across session"
          />
        )}
        {avgTtft != null && (
          <MetricRow
            icon={Clock}
            label="Avg TTFT"
            value={`${Math.round(avgTtft)}`}
            unit="ms"
            tooltip="Average time to first token"
          />
        )}
        {peakTps != null && (
          <MetricRow
            icon={Zap}
            label="Peak TPS"
            value={peakTps.toFixed(1)}
            accent
            tooltip="Highest tokens/sec this session"
          />
        )}
        <MetricRow
          icon={Timer}
          label="Duration"
          value={fmtDuration(sessionDuration)}
          tooltip="Time since first generation"
        />
      </div>

      <div className="h-px bg-border-subtle" />

      {/* Resources */}
      <div className="space-y-1">
        <SectionLabel>Resources</SectionLabel>
        <MetricRow
          icon={Cpu}
          label="Memory"
          value={metrics.memory != null ? `${(metrics.memory / 1024 / 1024).toFixed(0)}` : null}
          unit="MB"
          tooltip="Current GPU/CPU memory usage"
        />
        {metrics.peakMemory != null && metrics.peakMemory > 0 && (
          <MetricRow
            icon={Cpu}
            label="Peak Memory"
            value={`${(metrics.peakMemory / 1024 / 1024).toFixed(0)}`}
            unit="MB"
            tooltip="Peak memory usage this session"
          />
        )}
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
