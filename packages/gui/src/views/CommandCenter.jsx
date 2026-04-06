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
const COLORS = [ACCENT, AMBER, GREEN, PURPLE, RED, BLUE, '#d19a66'];
const COST_PER_1K = { heavy: 0.045, medium: 0.009, light: 0.0024 };

export default function CommandCenter() {
  const [data, setData] = useState(null);
  const agents = useGrooveStore((s) => s.agents);
  const dashTelemetry = useGrooveStore((s) => s.dashTelemetry);

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
      useGrooveStore.setState((s) => {
        const telem = { ...s.dashTelemetry };
        const now = Date.now();
        for (const agent of d.agents.breakdown) {
          if (!telem[agent.id]) telem[agent.id] = [];
          const arr = telem[agent.id];
          const last = arr[arr.length - 1];
          if (!last || agent.tokens !== last.v || now - last.t > 10000) {
            arr.push({ t: now, v: agent.tokens || 0, name: agent.name });
            if (arr.length > 200) telem[agent.id] = arr.slice(-200);
          }
        }
        return { dashTelemetry: telem };
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

  return (
    <div style={s.root}>

      {/* ROW 1 — Stat Cards */}
      <div style={s.statRow}>
        <StatCard
          label="Total Tokens"
          value={fmtNum(tokens.totalTokens)}
          sub={`${data.agents.total} agent${data.agents.total !== 1 ? 's' : ''}`}
        />
        <StatCard
          label="Estimated Savings"
          value={estDollarSaved > 0 ? `$${estDollarSaved.toFixed(2)}` : '$0.00'}
          sub={`${fmtNum(tokens.savings.total)} tokens saved`}
          color={GREEN}
        />
        <StatCard
          label="Efficiency"
          value={`${tokens.savings.percentage || 0}%`}
          sub="vs uncoordinated"
          color={tokens.savings.percentage > 0 ? GREEN : undefined}
        />
        <StatCard
          label="Rotations"
          value={rotation.totalRotations}
          sub={fmtUptime(uptime)}
        />
      </div>

      {/* ROW 2 — Area Chart + Donut */}
      <div style={s.midRow}>
        <div style={s.chartPanel}>
          <div style={s.panelHead}>
            <span>Token Usage</span>
            <span style={s.panelHeadRight}>
              {agentBreakdown.filter((a) => a.tokens > 0).map((a, i) => (
                <span key={a.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 12 }}>
                  <span style={{ width: 6, height: 2, background: COLORS[i % COLORS.length], display: 'inline-block', borderRadius: 1 }} />
                  <span style={{ fontSize: 9 }}>{a.name}</span>
                </span>
              ))}
            </span>
          </div>
          <TelemetryChart tokenTimeline={dashTelemetry} agents={agents} />
        </div>
        <div style={s.donutPanel}>
          <div style={s.panelHead}>Model Routing</div>
          <DonutChart routing={routing} />
        </div>
      </div>

      {/* ROW 3 — Savings Bars + Agent Fleet */}
      <div style={s.bottomRow}>
        <div style={s.panel}>
          <div style={s.panelHead}>Savings Breakdown</div>
          <div style={s.scrollInner}>
            <HorizBar label="Rotation" value={tokens.savings.fromRotation} max={tokens.savings.total || 1} color={ACCENT} />
            <HorizBar label="Conflict Prevention" value={tokens.savings.fromConflictPrevention} max={tokens.savings.total || 1} color={AMBER} />
            <HorizBar label="Cold-Start Skip" value={tokens.savings.fromColdStartSkip} max={tokens.savings.total || 1} color={GREEN} />
            <div style={s.divider} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5c6370', padding: '4px 0' }}>
              <span>Without Groove</span>
              <span style={{ color: RED }}>{fmtNum(tokens.savings.estimatedWithoutGroove)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#5c6370', padding: '4px 0' }}>
              <span>With Groove</span>
              <span style={{ color: GREEN }}>{fmtNum(tokens.totalTokens)}</span>
            </div>
            {journalist.lastSummary && (
              <>
                <div style={s.divider} />
                <div style={s.panelHead}>Journalist</div>
                <div style={s.journSummary}>{journalist.lastSummary}</div>
              </>
            )}
          </div>
        </div>
        <div style={s.panel}>
          <div style={s.panelHead}>Agent Fleet</div>
          <div style={s.scrollInner}>
            {agentBreakdown.length === 0 ? (
              <div style={s.empty}>No agents spawned</div>
            ) : agentBreakdown.map((a, i) => (
              <HorizBar
                key={a.id}
                label={a.name}
                value={a.tokens}
                max={Math.max(...agentBreakdown.map((x) => x.tokens), 1)}
                color={COLORS[i % COLORS.length]}
                sub={`${a.role} · ${a.model || 'auto'}`}
              />
            ))}
            {rotation.history.length > 0 && (
              <>
                <div style={s.divider} />
                <div style={s.panelHead}>Rotation History</div>
                {rotation.history.slice().reverse().slice(0, 8).map((r, i) => (
                  <div key={i} style={s.rotEntry}>
                    <span style={s.rotName}>{r.agentName}</span>
                    <span style={{ color: GREEN, fontSize: 9 }}>{fmtNum(r.oldTokens)} saved</span>
                    <span style={s.rotTime}>{timeAgo(r.timestamp)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── STAT CARD ──

function StatCard({ label, value, sub, color }) {
  return (
    <div style={s.statCard}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || '#e6e6e6', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: '#5c6370', marginTop: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
      {sub && <div style={{ fontSize: 9, color: '#3e4451', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ── HORIZONTAL BAR ──

function HorizBar({ label, value, max, color, sub }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div style={{ padding: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#abb2bf' }}>{label}</span>
        <span style={{ fontSize: 11, color: '#e6e6e6', fontWeight: 600 }}>{fmtNum(value)}</span>
      </div>
      <div style={{ height: 4, background: '#1e222a', borderRadius: 2 }}>
        <div style={{ width: `${Math.max(pct, value > 0 ? 1 : 0)}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.3s' }} />
      </div>
      {sub && <div style={{ fontSize: 8, color: '#3e4451', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── DONUT CHART ──

function DonutChart({ routing }) {
  const tiers = [
    { label: 'Heavy', color: RED, count: routing.byTier.heavy, cost: '$0.045/1k' },
    { label: 'Medium', color: AMBER, count: routing.byTier.medium, cost: '$0.009/1k' },
    { label: 'Light', color: GREEN, count: routing.byTier.light, cost: '$0.002/1k' },
  ];
  const total = tiers.reduce((s, t) => s + t.count, 0) || 1;

  const r = 50;
  const cx = 60;
  const cy = 60;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: 0 }}>
      <svg width="120" height="120" viewBox="0 0 120 120">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e222a" strokeWidth="10" />
        {tiers.map((t) => {
          if (t.count === 0) return null;
          const pct = t.count / total;
          const dashLen = pct * circumference;
          const el = (
            <circle
              key={t.label}
              cx={cx} cy={cy} r={r}
              fill="none" stroke={t.color} strokeWidth="10"
              strokeDasharray={`${dashLen} ${circumference - dashLen}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              transform={`rotate(-90 ${cx} ${cy})`}
              style={{ transition: 'stroke-dasharray 0.5s' }}
            />
          );
          offset += dashLen;
          return el;
        })}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="#e6e6e6" fontSize="16" fontWeight="700" fontFamily="JetBrains Mono, monospace">
          {total > 1 ? total : routing.totalDecisions}
        </text>
        <text x={cx} y={cy + 10} textAnchor="middle" fill="#5c6370" fontSize="8" fontFamily="JetBrains Mono, monospace">
          decisions
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', padding: '0 8px' }}>
        {tiers.map((t) => (
          <div key={t.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: t.color, flexShrink: 0 }} />
            <span style={{ color: '#abb2bf', flex: 1 }}>{t.label}</span>
            <span style={{ color: '#5c6370', fontSize: 9 }}>{t.cost}</span>
            <span style={{ color: '#e6e6e6', fontWeight: 600, minWidth: 20, textAlign: 'right' }}>{t.count}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: '#3e4451' }}>
        {routing.autoRoutedCount} auto-routed
      </div>
    </div>
  );
}

// ── TELEMETRY CHART ──

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
    ctx.strokeStyle = '#1e222a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = padT + (i / 4) * chartH;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
    }

    const agentIds = Object.keys(tokenTimeline);
    if (agentIds.length === 0) {
      ctx.fillStyle = '#3e4451';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for agent telemetry...', w / 2, h / 2);
      return;
    }

    let minT = Infinity, maxT = 0, maxV = 0;
    for (const id of agentIds) {
      for (const p of tokenTimeline[id] || []) {
        if (p.t < minT) minT = p.t;
        if (p.t > maxT) maxT = p.t;
        if (p.v > maxV) maxV = p.v;
      }
    }
    if (maxT === minT) maxT = minT + 60000;
    if (maxV === 0) maxV = 100;
    const timeRange = maxT - minT;

    // Y labels
    ctx.fillStyle = '#3e4451';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = maxV * (1 - i / 4);
      ctx.fillText(fmtNum(Math.round(val)), padL - 4, padT + (i / 4) * chartH + 3);
    }

    // X labels
    ctx.textAlign = 'center';
    for (let i = 0; i <= 4; i++) {
      const t = minT + (i / 4) * timeRange;
      const d = new Date(t);
      ctx.fillText(`${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`, padL + (i / 4) * chartW, h - 4);
    }

    // Draw agent areas + lines
    agentIds.forEach((id, idx) => {
      const pts = tokenTimeline[id] || [];
      if (pts.length < 2) return;

      const color = COLORS[idx % COLORS.length];
      const coords = pts.map((p) => ({
        x: padL + ((p.t - minT) / timeRange) * chartW,
        y: padT + (1 - p.v / maxV) * chartH,
      }));

      // Gradient fill
      ctx.beginPath();
      ctx.moveTo(coords[0].x, padT + chartH);
      for (const c of coords) ctx.lineTo(c.x, c.y);
      ctx.lineTo(coords[coords.length - 1].x, padT + chartH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + chartH);
      grad.addColorStop(0, color + '20');
      grad.addColorStop(1, color + '03');
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      for (let i = 0; i < coords.length; i++) {
        i === 0 ? ctx.moveTo(coords[i].x, coords[i].y) : ctx.lineTo(coords[i].x, coords[i].y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.stroke();

      // End dot
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
    padding: 14,
    gap: 12,
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
  loadingBar: { width: 120, height: 2, background: '#282c34', borderRadius: 1, overflow: 'hidden' },
  loadingFill: { width: '40%', height: '100%', background: ACCENT, animation: 'pulse 1.5s infinite' },

  // Stat cards row
  statRow: {
    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
    flexShrink: 0,
  },
  statCard: {
    background: '#282c34', borderRadius: 12, padding: '16px 18px',
    display: 'flex', flexDirection: 'column',
  },

  // Mid row — chart + donut
  midRow: {
    display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12,
    flex: 2, minHeight: 0,
  },
  chartPanel: {
    background: '#282c34', borderRadius: 12, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },
  donutPanel: {
    background: '#282c34', borderRadius: 12, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },

  // Bottom row
  bottomRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
    flex: 3, minHeight: 0,
  },
  panel: {
    background: '#282c34', borderRadius: 12, padding: '12px 14px',
    display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
  },

  // Shared
  panelHead: {
    fontSize: 10, fontWeight: 600, color: '#5c6370',
    textTransform: 'uppercase', letterSpacing: 1,
    marginBottom: 8, flexShrink: 0,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  panelHeadRight: { display: 'flex', alignItems: 'center', color: '#3e4451' },
  scrollInner: { flex: 1, minHeight: 0, overflowY: 'auto' },
  empty: { color: '#3e4451', fontSize: 10, textAlign: 'center', padding: 20 },
  divider: { height: 1, background: '#1e222a', margin: '8px 0', flexShrink: 0 },

  // Journalist
  journSummary: {
    fontSize: 10, color: '#8b929e', lineHeight: 1.5,
    padding: '4px 0', whiteSpace: 'pre-wrap', maxHeight: 80, overflowY: 'auto',
  },

  // Rotation
  rotEntry: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '4px 0', fontSize: 10,
  },
  rotName: { color: '#abb2bf', flex: 1 },
  rotTime: { color: '#3e4451', fontSize: 9 },
};
