// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useMemo, memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { TokenWaterfall } from './token-waterfall';
import { Zap, ArrowRight, Cpu } from 'lucide-react';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '\u2014';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

// ── Live Inference Metrics Strip ─────────────────────────

const LiveMetricsStrip = memo(function LiveMetricsStrip() {
  const timing = useGrooveStore((s) => s.networkTokenTiming);

  const tps = timing?.tps;
  const ttft = timing?.ttft_ms;
  const tokensGen = timing?.tokens_generated ?? 0;

  const { p2pCount, relayCount } = useMemo(() => {
    if (!timing?.stages) return { p2pCount: 0, relayCount: 0 };
    let p2p = 0, relay = 0;
    for (const s of timing.stages) {
      if (s.via === 'p2p') p2p++; else relay++;
    }
    return { p2pCount: p2p, relayCount: relay };
  }, [timing]);

  const metrics = [
    { label: 'TPS', value: tps != null ? `${tps.toFixed(1)}` : '\u2014', unit: 't/s', color: HEX.accent },
    { label: 'TTFT', value: ttft != null ? `${(ttft / 1000).toFixed(2)}` : '\u2014', unit: 's', color: HEX.info },
    { label: 'TOKENS', value: tokensGen > 0 ? String(tokensGen) : '\u2014', unit: '', color: HEX.text0 },
    { label: 'P2P', value: `${p2pCount}/${p2pCount + relayCount}`, unit: 'hops', color: p2pCount >= relayCount ? HEX.success : HEX.warning },
  ];

  return (
    <div className="flex items-stretch border-b border-border-subtle bg-surface-0">
      {metrics.map((m, i) => (
        <div key={m.label} className={cn('px-4 py-2.5 min-w-[100px]', i < metrics.length - 1 && 'border-r border-border-subtle')}>
          <div className="text-2xs font-mono text-text-4 uppercase tracking-wider">{m.label}</div>
          <div className="flex items-baseline gap-1 mt-0.5">
            <span className="text-lg font-mono font-semibold tabular-nums leading-none" style={{ color: m.color }}>{m.value}</span>
            {m.unit && <span className="text-2xs font-mono text-text-3">{m.unit}</span>}
          </div>
        </div>
      ))}
    </div>
  );
});

// ── TPS Trend Chart (canvas) ──────────────────────────────

const TpsChart = memo(function TpsChart() {
  const benchmarks = useGrooveStore((s) => s.networkBenchmarks);
  const tpsSnaps = useGrooveStore((s) => s.networkPerfSnapshots);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const chartData = useMemo(() => {
    const historical = benchmarks.map((b) => ({ t: b.t || Date.now(), tps: b.tps || 0 }));
    const live = tpsSnaps || [];
    const merged = [...historical, ...live];
    if (merged.length < 2) return [];
    return merged.slice(-100);
  }, [benchmarks, tpsSnaps]);

  const latestTps = chartData.length > 0 ? chartData[chartData.length - 1].tps : 0;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const { width: cw, height: ch } = entries[0].contentRect;
      if (cw > 0 && ch > 0) setSize({ width: Math.floor(cw), height: Math.floor(ch) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const { width, height } = size;
    if (!canvas || !chartData.length || width <= 0 || height <= 0) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const pad = { top: 24, right: 12, bottom: 8, left: 12 };
    const w = width - pad.left - pad.right;
    const h = height - pad.top - pad.bottom;
    if (w <= 0 || h <= 0) return;

    const vals = chartData.map((d) => d.tps);
    const maxVal = Math.max(...vals, 1);

    const xAt = (i) => pad.left + (i / Math.max(chartData.length - 1, 1)) * w;
    const yAt = (v) => pad.top + h - (v / maxVal) * h;

    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + w, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.font = "9px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = hexAlpha(HEX.text3, 0.5);
    ctx.fillText(`${maxVal.toFixed(1)} t/s`, pad.left + 4, pad.top + 10);

    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top + h);
    for (let i = 0; i < chartData.length; i++) ctx.lineTo(xAt(i), yAt(vals[i]));
    ctx.lineTo(xAt(chartData.length - 1), pad.top + h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + h);
    grad.addColorStop(0, hexAlpha(HEX.accent, 0.2));
    grad.addColorStop(0.7, hexAlpha(HEX.accent, 0.04));
    grad.addColorStop(1, hexAlpha(HEX.accent, 0));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < chartData.length; i++) {
      i === 0 ? ctx.moveTo(xAt(i), yAt(vals[i])) : ctx.lineTo(xAt(i), yAt(vals[i]));
    }
    ctx.stroke();

    ctx.font = "9px 'Inter Variable', sans-serif";
    ctx.textAlign = 'right';
    ctx.fillStyle = HEX.accent;
    ctx.fillText('TPS', width - pad.right - 4, 14);
  }, [chartData, size]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex-shrink-0 flex items-center justify-between">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">TPS Trend</span>
        <span className="text-sm font-mono font-semibold tabular-nums" style={{ color: HEX.accent }}>
          {latestTps > 0 ? `${latestTps.toFixed(1)} t/s` : '\u2014'}
        </span>
      </div>
      <div ref={containerRef} className="relative flex-1 min-h-[120px]">
        {chartData.length < 2 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-mono text-text-3">Collecting performance data\u2026</span>
          </div>
        ) : size.width > 0 && size.height > 0 ? (
          <canvas
            ref={canvasRef}
            style={{ width: size.width, height: size.height }}
            className="absolute inset-0 block"
          />
        ) : null}
      </div>
    </div>
  );
});

// ── Bottleneck Breakdown ──────────────────────────────────

const BOTTLENECK_PHASES = [
  { key: 'serialize_ms', label: 'Serialize', color: HEX.info },
  { key: 'send_ms', label: 'Send', color: HEX.accent },
  { key: 'wait_ms', label: 'Wait', color: HEX.text3 },
  { key: 'forward_ms', label: 'Forward', color: HEX.success },
  { key: 'queue_ms', label: 'Queue', color: HEX.warning },
];

const BottleneckBreakdown = memo(function BottleneckBreakdown() {
  const timing = useGrooveStore((s) => s.networkTokenTiming);

  const phaseTotals = useMemo(() => {
    const stages = timing?.stages || [];
    if (!stages.length) return null;
    const totals = {};
    let sum = 0;
    for (const phase of BOTTLENECK_PHASES) {
      const val = stages.reduce((acc, s) => acc + (s[phase.key] || 0), 0) / stages.length;
      totals[phase.key] = val;
      sum += val;
    }
    if (sum === 0) return null;
    const overhead = stages.reduce((acc, s) => {
      const rtt = s.rtt_ms || 0;
      const accounted = BOTTLENECK_PHASES.reduce((a, p) => a + (s[p.key] || 0), 0);
      return acc + Math.max(0, rtt - accounted);
    }, 0) / stages.length;
    totals._overhead = overhead;
    totals._sum = sum + overhead;
    return totals;
  }, [timing]);

  if (!phaseTotals) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-xs font-mono text-text-3">No stage data available</span>
      </div>
    );
  }

  const total = phaseTotals._sum;

  return (
    <div className="flex flex-col gap-2 px-3 py-2">
      <div className="h-5 rounded-sm overflow-hidden flex bg-surface-2">
        {BOTTLENECK_PHASES.map((p) => {
          const pct = ((phaseTotals[p.key] || 0) / total) * 100;
          if (pct < 0.5) return null;
          return (
            <div
              key={p.key}
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: p.color }}
              title={`${p.label}: ${pct.toFixed(1)}%`}
            />
          );
        })}
        {phaseTotals._overhead > 0 && (
          <div
            className="h-full transition-all"
            style={{ width: `${(phaseTotals._overhead / total) * 100}%`, background: HEX.orange }}
            title={`Overhead: ${((phaseTotals._overhead / total) * 100).toFixed(1)}%`}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {BOTTLENECK_PHASES.map((p) => {
          const pct = ((phaseTotals[p.key] || 0) / total) * 100;
          return (
            <div key={p.key} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: p.color }} />
              <span className="text-2xs font-mono text-text-3">{p.label}</span>
              <span className="text-2xs font-mono text-text-2 tabular-nums">{pct.toFixed(0)}%</span>
            </div>
          );
        })}
        {phaseTotals._overhead > 0 && (
          <div className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ background: HEX.orange }} />
            <span className="text-2xs font-mono text-text-3">Overhead</span>
            <span className="text-2xs font-mono text-text-2 tabular-nums">
              {((phaseTotals._overhead / total) * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

// ── Session Summary ───────────────────────────────────────

const SessionSummary = memo(function SessionSummary() {
  const benchmarks = useGrooveStore((s) => s.networkBenchmarks);
  const timing = useGrooveStore((s) => s.networkTokenTiming);

  const latest = benchmarks.length > 0 ? benchmarks[benchmarks.length - 1] : null;
  const ttft = latest?.ttft_ms ?? timing?.ttft_ms;
  const tokens = latest?.tokens_generated ?? timing?.tokens_generated ?? 0;
  const totalMs = latest?.total_network_ms ?? latest?.total_compute_ms;
  const p2p = latest?.p2p_sends ?? 0;
  const relay = latest?.relay_sends ?? 0;
  const totalSends = p2p + relay;
  const p2pPct = totalSends > 0 ? (p2p / totalSends) * 100 : 0;

  const stats = [
    { label: 'TTFT', value: ttft != null ? `${(ttft / 1000).toFixed(2)}s` : '\u2014', color: HEX.accent },
    { label: 'Tokens', value: tokens > 0 ? String(tokens) : '\u2014', color: HEX.text0 },
    { label: 'Total Time', value: totalMs != null ? `${(totalMs / 1000).toFixed(1)}s` : '\u2014', color: HEX.text0 },
    { label: 'TPS', value: latest?.tps != null ? `${latest.tps.toFixed(1)}` : '\u2014', color: HEX.accent },
  ];

  return (
    <div className="flex flex-col gap-3 px-3 py-2">
      <div className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="text-2xs font-mono text-text-4 uppercase tracking-wider">{s.label}</div>
            <div className="text-sm font-mono font-semibold tabular-nums" style={{ color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {totalSends > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-1">P2P vs Relay</div>
          <div className="h-3 rounded-sm overflow-hidden flex bg-surface-2">
            <div
              className="h-full transition-all"
              style={{ width: `${p2pPct}%`, background: HEX.success }}
              title={`P2P: ${p2p} (${p2pPct.toFixed(0)}%)`}
            />
            <div
              className="h-full transition-all"
              style={{ width: `${100 - p2pPct}%`, background: HEX.orange }}
              title={`Relay: ${relay} (${(100 - p2pPct).toFixed(0)}%)`}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: HEX.success }} />
              <span className="text-2xs font-mono text-text-3">P2P {p2p}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-sm" style={{ background: HEX.orange }} />
              <span className="text-2xs font-mono text-text-3">Relay {relay}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

// ── Gauge Bar (reusable) ─────────────────────────────────

function GaugeBar({ value, max, peakValue, color, label, unit }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const peakPct = peakValue && max > 0 ? Math.min((peakValue / max) * 100, 100) : null;
  const gaugeColor = pct > 90 ? HEX.danger : pct > 70 ? HEX.warning : color;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between">
        <span className="text-2xs font-mono text-text-4 uppercase">{label}</span>
        <span className="text-2xs font-mono text-text-2 tabular-nums">
          {typeof value === 'number' ? `${Math.round(value)}` : '\u2014'}
          {unit ? ` ${unit}` : ''}
          {max > 0 && typeof value === 'number' ? ` / ${Math.round(max)}` : ''}
        </span>
      </div>
      <div className="h-2 rounded-sm overflow-hidden bg-surface-3 relative">
        <div
          className="h-full rounded-sm transition-all duration-300"
          style={{ width: `${pct}%`, background: gaugeColor }}
        />
        {peakPct != null && (
          <div
            className="absolute top-0 h-full w-px opacity-70"
            style={{ left: `${peakPct}%`, background: HEX.danger }}
            title={`Peak: ${Math.round(peakValue)} ${unit || ''}`}
          />
        )}
      </div>
    </div>
  );
}

// ── Per-Node Live Gauges ─────────────────────────────────

const NodeGaugeCard = memo(function NodeGaugeCard({ nodeId, telemetry }) {
  const device = telemetry.device || 'unknown';
  const gpuModel = telemetry.gpu_model || device;
  const layers = Array.isArray(telemetry.layers) ? `L${telemetry.layers[0]}\u2013${telemetry.layers[1]}` : null;
  const isCuda = device === 'cuda';
  const isMps = device === 'mps';

  const stale = telemetry.updatedAt && (Date.now() - telemetry.updatedAt > 10000);

  return (
    <div className={cn(
      'rounded-md border bg-surface-0 p-3 flex flex-col gap-2 transition-opacity',
      stale ? 'border-border-subtle opacity-60' : 'border-border-subtle',
    )}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Cpu size={12} className="text-text-3 flex-shrink-0" />
          <span className="text-xs font-mono text-text-1 truncate">{shortAddr(nodeId)}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Badge variant={isCuda ? 'info' : isMps ? 'purple' : 'default'} className="text-2xs px-1.5 py-0 leading-tight">
            {device}
          </Badge>
          {layers && (
            <span className="text-2xs font-mono text-text-3 bg-surface-3 px-1.5 py-0 rounded">{layers}</span>
          )}
        </div>
      </div>

      <div className="text-2xs font-mono text-text-3 truncate">{gpuModel}</div>

      {(isCuda || isMps) && (telemetry.vram_total_mb > 0 || telemetry.vram_used_mb > 0) && (
        <GaugeBar
          label="VRAM"
          value={telemetry.vram_used_mb}
          max={telemetry.vram_total_mb || telemetry.vram_peak_mb || telemetry.vram_used_mb}
          peakValue={telemetry.vram_total_mb ? telemetry.vram_peak_mb : undefined}
          color={HEX.purple}
          unit="MB"
        />
      )}

      <GaugeBar
        label="RAM"
        value={telemetry.ram_pct}
        max={100}
        color={HEX.info}
        unit="%"
      />

      <GaugeBar
        label="CPU"
        value={telemetry.cpu_pct}
        max={100}
        color={HEX.accent}
        unit="%"
      />

      {telemetry.forward_ms != null && (
        <div className="flex items-center justify-between">
          <span className="text-2xs font-mono text-text-4 uppercase">Forward</span>
          <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: telemetry.forward_ms > 200 ? HEX.warning : HEX.success }}>
            {telemetry.forward_ms.toFixed(1)}ms
          </span>
        </div>
      )}
    </div>
  );
});

const NodeGauges = memo(function NodeGauges() {
  const telemetryMap = useGrooveStore((s) => s.networkNodeTelemetry);

  const nodes = useMemo(() => {
    return Object.entries(telemetryMap)
      .sort(([, a], [, b]) => (a.layers?.[0] ?? 0) - (b.layers?.[0] ?? 0));
  }, [telemetryMap]);

  if (!nodes.length) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-xs font-mono text-text-3">No node telemetry received yet</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 p-3">
      {nodes.map(([nodeId, tel]) => (
        <NodeGaugeCard key={nodeId} nodeId={nodeId} telemetry={tel} />
      ))}
    </div>
  );
});

// ── Pipeline Visualization ───────────────────────────────

const PipelineVisualization = memo(function PipelineVisualization() {
  const traces = useGrooveStore((s) => s.networkTraces);
  const benchmarks = useGrooveStore((s) => s.networkBenchmarks);

  const pipeline = useMemo(() => {
    if (Array.isArray(traces) && traces.length > 0) {
      const latest = traces[traces.length - 1];
      if (latest?.pipeline && Array.isArray(latest.pipeline)) return latest.pipeline;
    }
    if (benchmarks.length > 0) {
      const latest = benchmarks[benchmarks.length - 1];
      if (latest?.pipeline && Array.isArray(latest.pipeline)) return latest.pipeline;
    }
    return null;
  }, [traces, benchmarks]);

  if (!pipeline || !pipeline.length) {
    return (
      <div className="flex items-center justify-center py-6">
        <span className="text-xs font-mono text-text-3">No pipeline data available</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0 px-3 py-3 overflow-x-auto">
      {pipeline.map((node, i) => {
        const layers = Array.isArray(node.layers) ? `L${node.layers[0]}\u2013${node.layers[1]}` : '';
        const isCuda = node.device === 'cuda';
        const scoreColor = (node.score || 0) >= 80 ? HEX.success : (node.score || 0) >= 60 ? HEX.warning : HEX.danger;

        return (
          <div key={node.node_id || i} className="flex items-center gap-0 flex-shrink-0">
            <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2 min-w-[140px]">
              <div className="flex items-center gap-1.5 mb-1">
                <Cpu size={10} className="text-text-3" />
                <span className="text-2xs font-mono text-text-1">{shortAddr(node.node_id)}</span>
              </div>
              <div className="text-2xs font-mono text-text-3 truncate mb-1">
                {node.gpu_model || node.device || '\u2014'}
              </div>
              <div className="flex items-center gap-2">
                {layers && <span className="text-2xs font-mono text-text-2 bg-surface-3 px-1 rounded">{layers}</span>}
                <Badge variant={isCuda ? 'info' : 'purple'} className="text-2xs px-1 py-0 leading-tight">{node.device}</Badge>
              </div>
              {node.score != null && (
                <div className="mt-1.5 flex items-center gap-1">
                  <span className="text-2xs font-mono text-text-4">Score</span>
                  <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: scoreColor }}>
                    {node.score.toFixed(1)}
                  </span>
                </div>
              )}
            </div>
            {i < pipeline.length - 1 && (
              <div className="px-1 flex-shrink-0">
                <ArrowRight size={14} className="text-text-4" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
});

// ── Main Dashboard ────────────────────────────────────────

export const PerformanceDashboard = memo(function PerformanceDashboard({ active }) {
  const fetchNetworkBenchmarks = useGrooveStore((s) => s.fetchNetworkBenchmarks);
  const fetchNetworkTraces = useGrooveStore((s) => s.fetchNetworkTraces);

  useEffect(() => {
    if (active) {
      fetchNetworkBenchmarks();
      fetchNetworkTraces();
    }
  }, [active, fetchNetworkBenchmarks, fetchNetworkTraces]);

  return (
    <ScrollArea className="h-full">
      <LiveMetricsStrip />

      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden min-h-[200px]">
            <TpsChart />
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Token Waterfall</span>
            </div>
            <TokenWaterfall />
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Bottleneck Breakdown</span>
            </div>
            <BottleneckBreakdown />
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0 flex items-center gap-1.5">
              <Zap size={10} className="text-accent" />
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Node Resource Gauges</span>
            </div>
            <NodeGauges />
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Session Summary</span>
            </div>
            <SessionSummary />
          </div>
        </div>
      </div>

      {/* Bottom row — pipeline */}
      <div className="px-4 pb-4">
        <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
          <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Pipeline</span>
          </div>
          <PipelineVisualization />
        </div>
      </div>
    </ScrollArea>
  );
});
