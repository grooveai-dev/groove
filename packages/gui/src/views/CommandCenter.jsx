// GROOVE GUI — Command Center Dashboard
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useGrooveStore } from '../stores/groove';

const GREEN = '#4ae168';
const ACCENT = '#33afbc';
const AMBER = '#e5c07b';
const RED = '#e06c75';
const PURPLE = '#c678dd';
const BLUE = '#61afef';
const COLORS = [ACCENT, AMBER, GREEN, PURPLE, RED, BLUE, '#d19a66', '#56b6c2'];
const COST_PER_1K = { heavy: 0.045, medium: 0.009, light: 0.0024 };

export default function CommandCenter() {
  const [data, setData] = useState(null);
  const [telemetry, setTelemetry] = useState({}); // { agentId: [{t, v}] }
  const agents = useGrooveStore((s) => s.agents);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 4000);
    return () => clearInterval(interval);
  }, []);

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/dashboard');
      const d = await res.json();
      setData(d);

      // Build telemetry timeline from API polls — reliable source of truth
      setTelemetry((prev) => {
        const next = { ...prev };
        const now = Date.now();
        for (const agent of d.agents.breakdown) {
          if (!next[agent.id]) next[agent.id] = [];
          const arr = next[agent.id];
          const last = arr[arr.length - 1];
          // Record if value changed or 10s elapsed (heartbeat)
          if (!last || agent.tokens !== last.v || now - last.t > 10000) {
            arr.push({ t: now, v: agent.tokens || 0, name: agent.name });
            if (arr.length > 200) next[agent.id] = arr.slice(-200);
          }
        }
        return next;
      });
    } catch { /* ignore */ }
  }

  if (!data) {
    return (
      <div style={s.loadingRoot}>
        <div style={s.loadingText}>COMMAND CENTER</div>
        <div style={s.loadingBar}><div style={s.loadingFill} /></div>
      </div>
    );
  }

  const { tokens, routing, rotation, adaptive, journalist, uptime } = data;
  const agentBreakdown = data.agents.breakdown;
  const estDollarSaved = (tokens.savings.total / 1000) * COST_PER_1K.medium;
  const runningAgents = agentBreakdown.filter((a) => a.status === 'running');
  const avgCtx = runningAgents.length > 0
    ? Math.round(runningAgents.reduce((s, a) => s + (a.contextUsage || 0), 0) / runningAgents.length * 100)
    : 0;

  return (
    <div style={s.root}>

      {/* ── HERO ROW — Gauges + Money Shot ── */}
      <div style={s.heroRow}>
        <div style={s.heroGaugeGroup}>
          <GaugeChart value={tokens.savings.percentage || 0} max={100} label="EFFICIENCY" unit="%" color={GREEN} />
          <GaugeChart value={avgCtx} max={100} label="AVG CONTEXT" unit="%" color={avgCtx > 80 ? RED : avgCtx > 60 ? AMBER : ACCENT} />
        </div>
        <div style={s.heroCenter}>
          <div style={s.heroDollar}>{estDollarSaved > 0 ? `$${estDollarSaved.toFixed(2)}` : '$0.00'}</div>
          <div style={s.heroCenterLabel}>ESTIMATED SAVINGS</div>
          <div style={s.heroSubStats}>
            <span>{fmtNum(tokens.totalTokens)} used</span>
            <span>{fmtNum(tokens.savings.total)} saved</span>
          </div>
        </div>
        <div style={s.heroGaugeGroup}>
          <GaugeChart value={data.agents.running} max={Math.max(data.agents.total, 1)} label="AGENTS" unit={`/${data.agents.total}`} color={ACCENT} />
          <GaugeChart value={rotation.totalRotations} max={Math.max(rotation.totalRotations, 10)} label="ROTATIONS" unit="" color={PURPLE} />
        </div>
      </div>

      {/* ── MAIN CHART — Full-width live telemetry ── */}
      <div style={s.chartPanel}>
        <div style={s.chartHead}>
          <span>LIVE TELEMETRY</span>
          <span style={s.chartHeadRight}>
            {data.agents.breakdown.filter((a) => a.tokens > 0).map((a, i) => (
              <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: COLORS[i % COLORS.length], display: 'inline-block' }} />
                <span style={{ fontSize: 9 }}>{a.name} {fmtNum(a.tokens)}</span>
              </span>
            ))}
          </span>
        </div>
        <TelemetryChart tokenTimeline={telemetry} agents={agents} />
      </div>

      {/* ── BOTTOM ROW — Three panels ── */}
      <div style={s.bottomRow}>

        {/* AGENT FLEET */}
        <div style={s.panel}>
          <div style={s.panelHead}>AGENT FLEET</div>
          <div style={s.scrollInner}>
            {agentBreakdown.length === 0 ? (
              <div style={s.empty}>No agents spawned</div>
            ) : agentBreakdown.map((a, i) => (
              <AgentCard key={a.id} agent={a} total={tokens.totalTokens} color={COLORS[i % COLORS.length]} />
            ))}
          </div>
        </div>

        {/* SAVINGS + ROUTING + ADAPTIVE */}
        <div style={s.panel}>
          <div style={s.panelHead}>SAVINGS & ROUTING</div>
          <div style={s.scrollInner}>
            <SavingsBlock savings={tokens.savings} />
            <div style={s.divider} />
            <RoutingBlock routing={routing} />
            <div style={s.divider} />
            <AdaptiveBlock adaptive={adaptive} />
          </div>
        </div>

        {/* JOURNALIST + ROTATION */}
        <div style={s.panel}>
          <div style={s.panelHead}>
            JOURNALIST
            <span style={{ ...s.liveBadge, background: journalist.running ? GREEN : 'var(--text-dim)' }}>
              {journalist.running ? 'LIVE' : 'IDLE'}
            </span>
          </div>
          <div style={s.scrollInner}>
            <div style={s.journStats}>
              <span>{journalist.cycleCount || 0} cycles</span>
              <span>{journalist.intervalMs ? `${journalist.intervalMs / 1000}s interval` : '120s interval'}</span>
            </div>
            {journalist.lastSummary ? (
              <div style={s.journSummary}>{journalist.lastSummary}</div>
            ) : (
              <div style={s.journSummary}>Waiting for first synthesis cycle...</div>
            )}
            <div style={{ ...s.divider, margin: '8px 0' }} />
            <div style={s.miniHead}>ROTATION HISTORY</div>
            {rotation.history.length === 0 ? (
              <div style={s.empty}>No rotations yet</div>
            ) : rotation.history.slice().reverse().slice(0, 10).map((r, i) => (
              <div key={i} style={s.rotEntry}>
                <span style={s.rotDot} />
                <span style={s.rotName}>{r.agentName}</span>
                <span style={s.rotSaved}>{fmtNum(r.oldTokens)} saved</span>
                <span style={s.rotTime}>{timeAgo(r.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── GAUGE CHART — Semicircle arc gauge ──
function GaugeChart({ value, max, label, unit, color }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = 32;
  const cx = 40;
  const cy = 38;
  const circumHalf = Math.PI * r;
  const dashLen = pct * circumHalf;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
      <svg width="80" height="48" viewBox="0 0 80 48">
        {/* Track */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke="#2c313a" strokeWidth="4" strokeLinecap="round" />
        {/* Value arc */}
        <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none" stroke={color} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={`${dashLen} ${circumHalf}`}
          style={{ transition: 'stroke-dasharray 0.5s ease' }} />
        {/* Value text */}
        <text x={cx} y={cy - 6} textAnchor="middle" fill="#e6e6e6"
          fontSize="14" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {typeof value === 'number' ? Math.round(value) : value}
        </text>
        <text x={cx} y={cy + 4} textAnchor="middle" fill="#5c6370"
          fontSize="7" fontFamily="JetBrains Mono, monospace">
          {unit}
        </text>
      </svg>
      <span style={{ fontSize: 7, fontWeight: 700, color: '#5c6370', textTransform: 'uppercase', letterSpacing: 1, marginTop: -2 }}>{label}</span>
    </div>
  );
}

// ── AGENT CARD ──
function AgentCard({ agent, total, color }) {
  const pct = total > 0 ? (agent.tokens / total) * 100 : 0;
  const alive = agent.status === 'running';
  const statusColor = alive ? GREEN : agent.status === 'completed' ? ACCENT : agent.status === 'crashed' ? RED : 'var(--text-dim)';

  return (
    <div style={s.agentCard}>
      <div style={s.agentCardRow}>
        <span style={{ ...s.dot, background: statusColor, ...(alive ? { animation: 'pulse 2s infinite' } : {}) }} />
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-bright)' }}>{agent.name}</span>
        <span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{agent.role}</span>
        {agent.routingMode === 'auto' && <span style={s.tagAuto}>AUTO</span>}
        <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-primary)', marginLeft: 'auto' }}>{fmtNum(agent.tokens)}</span>
      </div>
      <div style={s.agentBarRow}>
        <div style={s.agentBarTrack}>
          <div style={{ width: `${Math.max(pct, 0.5)}%`, height: '100%', background: color, borderRadius: 1 }} />
        </div>
        <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{agent.model || 'default'}</span>
        <CtxGauge value={agent.contextUsage} />
      </div>
    </div>
  );
}

function CtxGauge({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct > 80 ? RED : pct > 60 ? AMBER : GREEN;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <div style={{ width: 24, height: 3, background: '#2c313a', borderRadius: 1, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 1 }} />
      </div>
      <span style={{ fontSize: 8, color: 'var(--text-dim)', minWidth: 18, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ── SAVINGS BLOCK ──
function SavingsBlock({ savings }) {
  const items = [
    { label: 'Rotation', value: savings.fromRotation, color: ACCENT },
    { label: 'Conflicts', value: savings.fromConflictPrevention, color: AMBER },
    { label: 'Cold-start', value: savings.fromColdStartSkip, color: GREEN },
  ];
  const total = savings.total || 1;

  return (
    <div>
      <div style={s.miniHead}>TOKEN SAVINGS</div>
      <div style={s.stackedBar}>
        {items.map((it, i) => it.value > 0 && (
          <div key={i} style={{ width: `${(it.value / total) * 100}%`, height: '100%', background: it.color }} />
        ))}
      </div>
      {items.map((it, i) => (
        <div key={i} style={s.savRow}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, background: it.color, borderRadius: 1, flexShrink: 0 }} />
            <span>{it.label}</span>
          </div>
          <span style={{ fontWeight: 600 }}>{fmtNum(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── ROUTING BLOCK ──
function RoutingBlock({ routing }) {
  const tiers = [
    { label: 'HEAVY', cost: '$0.045', color: RED, count: routing.byTier.heavy },
    { label: 'MEDIUM', cost: '$0.009', color: AMBER, count: routing.byTier.medium },
    { label: 'LIGHT', cost: '$0.002', color: GREEN, count: routing.byTier.light },
  ];
  const max = Math.max(...tiers.map((t) => t.count), 1);

  return (
    <div>
      <div style={s.miniHead}>MODEL ROUTING</div>
      {tiers.map((t) => (
        <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
          <span style={{ fontSize: 8, fontWeight: 700, color: t.color, minWidth: 42 }}>{t.label}</span>
          <div style={{ flex: 1, height: 4, background: '#2c313a', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{ width: `${Math.max((t.count / max) * 100, t.count > 0 ? 3 : 0)}%`, height: '100%', background: t.color, borderRadius: 1 }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-bright)', minWidth: 16, textAlign: 'right' }}>{t.count}</span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: 'var(--text-dim)', marginTop: 4 }}>
        <span>{routing.autoRoutedCount} auto</span>
        <span>{routing.totalDecisions} total</span>
      </div>
    </div>
  );
}

// ── ADAPTIVE BLOCK ──
function AdaptiveBlock({ adaptive }) {
  if (!adaptive || adaptive.length === 0) return null;
  return (
    <div>
      <div style={s.miniHead}>ADAPTIVE THRESHOLDS</div>
      {adaptive.map((p) => (
        <div key={p.key} style={{ padding: '4px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 2 }}>
            <span style={{ color: 'var(--text-bright)', fontWeight: 600 }}>{p.key}</span>
            <span style={{ color: p.converged ? GREEN : AMBER, fontSize: 8 }}>
              {p.converged ? 'CONVERGED' : `${p.adjustments} adj`}
            </span>
          </div>
          <div style={{ height: 5, background: '#2c313a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${Math.round(p.threshold * 100)}%`, height: '100%', background: p.converged ? GREEN : ACCENT, borderRadius: 2 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── TELEMETRY CHART — Full-width area chart with per-agent lines ──
function TelemetryChart({ tokenTimeline, agents }) {
  const containerRef = useRef();
  const canvasRef = useRef();

  const draw = useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const padL = 40, padR = 10, padT = 10, padB = 20;
    const chartW = w - padL - padR;
    const chartH = h - padT - padB;

    // Grid
    ctx.strokeStyle = '#2c313a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * chartH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    }

    // Gather all agent timelines
    const agentIds = Object.keys(tokenTimeline).filter((id) =>
      agents.some((a) => a.id === id)
    );

    if (agentIds.length === 0) {
      ctx.fillStyle = '#3e4451';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for agent telemetry...', w / 2, h / 2);
      return;
    }

    // Find global time range and max value
    let minT = Infinity, maxT = 0, maxV = 0;
    for (const id of agentIds) {
      const pts = tokenTimeline[id] || [];
      for (const p of pts) {
        if (p.t < minT) minT = p.t;
        if (p.t > maxT) maxT = p.t;
        if (p.v > maxV) maxV = p.v;
      }
    }

    if (maxT === minT) maxT = minT + 60000;
    if (maxV === 0) maxV = 100;
    const timeRange = maxT - minT;

    // Y-axis labels
    ctx.fillStyle = '#3e4451';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = maxV * (1 - i / 4);
      const y = padT + (i / 4) * chartH;
      ctx.fillText(fmtNum(Math.round(val)), padL - 4, y + 3);
    }

    // X-axis time labels
    ctx.textAlign = 'center';
    const timeLabels = 5;
    for (let i = 0; i <= timeLabels; i++) {
      const t = minT + (i / timeLabels) * timeRange;
      const x = padL + (i / timeLabels) * chartW;
      const d = new Date(t);
      ctx.fillText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, x, h - 4);
    }

    // Draw each agent — thin flat lines, subtle fill, no neon/glow
    agentIds.forEach((id, idx) => {
      const pts = tokenTimeline[id] || [];
      if (pts.length < 2) return;

      const color = COLORS[idx % COLORS.length];

      // Map points to canvas coords
      const coords = pts.map((p) => ({
        x: padL + ((p.t - minT) / timeRange) * chartW,
        y: padT + (1 - p.v / maxV) * chartH,
      }));

      // Subtle fill area
      ctx.beginPath();
      ctx.moveTo(coords[0].x, padT + chartH);
      for (const c of coords) ctx.lineTo(c.x, c.y);
      ctx.lineTo(coords[coords.length - 1].x, padT + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
      grad.addColorStop(0, color + '18');
      grad.addColorStop(1, color + '03');
      ctx.fillStyle = grad;
      ctx.fill();

      // Thin flat line — 1px, no shadow/glow
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        i === 0 ? ctx.moveTo(coords[i].x, coords[i].y) : ctx.lineTo(coords[i].x, coords[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Small end marker — flat, no glow
      const last = coords[coords.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
  }, [tokenTimeline, agents]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const obs = new ResizeObserver(draw);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [draw]);

  return (
    <div ref={containerRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', top: 0, left: 0 }} />
    </div>
  );
}

// ── HELPERS ──
function fmtNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n || 0);
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

function timeAgo(ts) {
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (m >= 60) return `${Math.floor(m / 60)}h ago`;
  if (m > 0) return `${m}m ago`;
  return 'now';
}

// ── STYLES ──
const s = {
  root: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    padding: 12,
    gap: 10,
    background: 'var(--bg-base)',
  },
  loadingRoot: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 12,
  },
  loadingText: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  loadingBar: { width: 120, height: 2, background: 'var(--bg-surface)', borderRadius: 1, overflow: 'hidden' },
  loadingFill: { width: '40%', height: '100%', background: ACCENT, animation: 'pulse 1.5s infinite' },

  // Hero row
  heroRow: {
    display: 'flex', alignItems: 'stretch', gap: 10,
    flexShrink: 0, height: 90,
  },
  heroGaugeGroup: {
    flex: 1, display: 'flex', gap: 4,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '6px 4px', alignItems: 'center',
  },
  heroCenter: {
    flex: 1.2, background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '8px 16px',
  },
  heroDollar: {
    fontSize: 28, fontWeight: 800, color: GREEN, lineHeight: 1,
  },
  heroCenterLabel: {
    fontSize: 7, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 4,
  },
  heroSubStats: {
    display: 'flex', gap: 12, marginTop: 4,
    fontSize: 9, color: '#5c6370',
  },

  // Main chart
  chartPanel: {
    flex: 2, minHeight: 0,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 12px', display: 'flex', flexDirection: 'column',
  },
  chartHead: {
    fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
    paddingBottom: 6, flexShrink: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  chartHeadRight: { display: 'flex', alignItems: 'center', color: 'var(--text-dim)' },

  // Bottom row — three panels
  bottomRow: {
    flex: 3, minHeight: 0,
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10,
  },
  panel: {
    minHeight: 0, overflow: 'hidden',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px', display: 'flex', flexDirection: 'column',
  },
  panelHead: {
    fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
    paddingBottom: 6, marginBottom: 6, flexShrink: 0,
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', gap: 8,
  },
  scrollInner: { flex: 1, minHeight: 0, overflowY: 'auto' },
  empty: { color: 'var(--text-dim)', fontSize: 10, textAlign: 'center', padding: 16, opacity: 0.6 },

  // Shared
  divider: { height: 1, background: 'var(--border)', margin: '6px 0', flexShrink: 0 },
  miniHead: {
    fontSize: 8, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
  },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  liveBadge: {
    fontSize: 7, fontWeight: 700, color: '#1a1d23',
    padding: '1px 5px', borderRadius: 2, letterSpacing: 0.5, marginLeft: 'auto',
  },

  // Agent cards
  agentCard: { padding: '5px 0', borderBottom: '1px solid var(--bg-base)' },
  agentCardRow: { display: 'flex', alignItems: 'center', gap: 6 },
  agentBarRow: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 },
  agentBarTrack: { flex: 1, height: 2, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },
  tagAuto: {
    fontSize: 7, fontWeight: 700, color: ACCENT,
    border: `1px solid ${ACCENT}`, padding: '0 3px', lineHeight: '11px', letterSpacing: 0.5,
  },

  // Savings
  stackedBar: { height: 8, background: '#2c313a', borderRadius: 2, overflow: 'hidden', display: 'flex', marginBottom: 4 },
  savRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '2px 0', fontSize: 10, color: 'var(--text-primary)',
  },

  // Journalist
  journStats: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 9, color: 'var(--text-dim)', marginBottom: 6,
  },
  journSummary: {
    fontSize: 10, color: 'var(--text-primary)', lineHeight: 1.6,
    padding: '6px 8px', background: 'var(--bg-base)', border: '1px solid var(--border)',
    overflowY: 'auto', whiteSpace: 'pre-wrap', minHeight: 60, maxHeight: 200, flex: 1,
  },

  // Rotation
  rotEntry: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '3px 0', fontSize: 10,
  },
  rotDot: { width: 5, height: 5, borderRadius: '50%', background: ACCENT, flexShrink: 0 },
  rotName: { color: 'var(--text-bright)', fontWeight: 600, flex: 1 },
  rotSaved: { color: GREEN, fontSize: 9, fontWeight: 600 },
  rotTime: { color: 'var(--text-dim)', fontSize: 9, flexShrink: 0 },
};
