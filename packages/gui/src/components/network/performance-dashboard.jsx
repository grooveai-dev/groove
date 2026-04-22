// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { TokenWaterfall } from './token-waterfall';
import { Zap } from 'lucide-react';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '\u2014';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

// ── TPS Trend Chart (canvas) ──────────────────────────────

const TpsChart = memo(function TpsChart() {
  const benchmarks = useGrooveStore((s) => s.networkBenchmarks);
  const perfSnaps = useGrooveStore((s) => s.networkPerfSnapshots);
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const chartData = useMemo(() => {
    if (benchmarks.length >= 2) return benchmarks.map((b) => ({ t: b.t || Date.now(), tps: b.tps || 0 }));
    if (perfSnaps.length >= 2) return perfSnaps;
    return [];
  }, [benchmarks, perfSnaps]);

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

    // Grid
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = hexAlpha(HEX.text4, 0.2);
    ctx.lineWidth = 1;
    for (let i = 1; i <= 3; i++) {
      const y = pad.top + (h / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(pad.left + w, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Y-axis labels
    ctx.font = "9px 'JetBrains Mono Variable', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = hexAlpha(HEX.text3, 0.5);
    ctx.fillText(`${maxVal.toFixed(1)} t/s`, pad.left + 4, pad.top + 10);

    // Fill
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

    // Line
    ctx.beginPath();
    ctx.strokeStyle = HEX.accent;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    for (let i = 0; i < chartData.length; i++) {
      i === 0 ? ctx.moveTo(xAt(i), yAt(vals[i])) : ctx.lineTo(xAt(i), yAt(vals[i]));
    }
    ctx.stroke();

    // Legend
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
      <div ref={containerRef} className="relative flex-1 min-h-0" style={{ minHeight: 120 }}>
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
  const benchmarks = useGrooveStore((s) => s.networkBenchmarks);

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

// ── Per-Node Latency Table ────────────────────────────────

const NodeLatencyTable = memo(function NodeLatencyTable() {
  const timing = useGrooveStore((s) => s.networkTokenTiming);

  const stages = useMemo(() => {
    if (!timing?.stages || !Array.isArray(timing.stages)) return [];
    return timing.stages;
  }, [timing]);

  if (!stages.length) return null;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-0 px-3 py-1.5 text-2xs font-mono text-text-4 uppercase tracking-wider border-b border-border-subtle">
        <div className="w-[80px]">Node</div>
        <div className="w-[48px]">Via</div>
        <div className="w-[64px] text-right">RTT</div>
        <div className="flex-1 text-right">Forward</div>
      </div>
      {stages.map((s, i) => (
        <div
          key={i}
          className="flex items-center gap-0 px-3 py-1 text-xs font-mono border-b border-border-subtle/50 hover:bg-surface-2 transition-colors"
        >
          <div className="w-[80px] text-text-2 truncate">{shortAddr(s.node)}</div>
          <div className="w-[48px]">
            <Badge variant={s.via === 'p2p' ? 'success' : 'warning'} className="text-2xs px-1 py-0 leading-tight">
              {s.via || '?'}
            </Badge>
          </div>
          <div className="w-[64px] text-right text-text-1 tabular-nums">{(s.rtt_ms || 0).toFixed(1)}ms</div>
          <div className="flex-1 text-right text-text-2 tabular-nums">{(s.forward_ms || 0).toFixed(1)}ms</div>
        </div>
      ))}
    </div>
  );
});

// ── Main Dashboard ────────────────────────────────────────

export const PerformanceDashboard = memo(function PerformanceDashboard({ active }) {
  const fetchNetworkBenchmarks = useGrooveStore((s) => s.fetchNetworkBenchmarks);

  useEffect(() => {
    if (active) fetchNetworkBenchmarks();
  }, [active, fetchNetworkBenchmarks]);

  return (
    <ScrollArea className="h-full">
      <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Left column */}
        <div className="flex flex-col gap-3">
          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden" style={{ minHeight: 200 }}>
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
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Session Summary</span>
            </div>
            <SessionSummary />
          </div>

          <div className="rounded-md border border-border-subtle bg-surface-0 overflow-hidden">
            <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Per-Node Latency</span>
            </div>
            <NodeLatencyTable />
          </div>
        </div>
      </div>
    </ScrollArea>
  );
});
