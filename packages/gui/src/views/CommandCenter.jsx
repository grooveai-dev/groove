// GROOVE GUI — Command Center Dashboard
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef, useCallback } from 'react';

const COST_PER_1K = { heavy: 0.045, medium: 0.009, light: 0.0024 };

export default function CommandCenter() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 4000);
    return () => clearInterval(interval);
  }, []);

  async function fetchDashboard() {
    try {
      const res = await fetch('/api/dashboard');
      setData(await res.json());
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

  const { tokens, agents, routing, rotation, adaptive, journalist, uptime } = data;
  const estDollarSaved = (tokens.savings.total / 1000) * COST_PER_1K.medium;
  const totalWithout = tokens.savings.estimatedWithoutGroove;

  return (
    <div style={s.root}>

      {/* ── HERO ROW ── */}
      <div style={s.heroRow}>
        <HeroStat label="TOKENS USED" value={formatNum(tokens.totalTokens)} />
        <HeroStat label="TOKENS SAVED" value={formatNum(tokens.savings.total)} color="var(--green)" />

        {/* Center hero — the money shot */}
        <div style={s.heroCenterBox}>
          <div style={s.heroDollar}>
            {estDollarSaved > 0 ? `$${estDollarSaved.toFixed(2)}` : '$0.00'}
          </div>
          <div style={s.heroCenterLabel}>ESTIMATED SAVINGS</div>
          <div style={s.heroCenterSub}>
            {tokens.savings.percentage > 0
              ? `${tokens.savings.percentage}% more efficient`
              : 'start agents to track'}
          </div>
        </div>

        <HeroStat label="AGENTS" value={`${agents.running}/${agents.total}`} />
        <HeroStat label="ROTATIONS" value={rotation.totalRotations} />
        <HeroStat label="UPTIME" value={formatUptime(uptime)} />
      </div>

      {/* ── MAIN 3-COLUMN GRID ── */}
      <div style={s.mainGrid}>

        {/* ── COLUMN 1 ── */}
        <div style={s.col}>
          <div style={s.panelFlex2}>
            <div style={s.panelHead}>TOKEN BURN RATE</div>
            <BurnRateChart agents={agents.breakdown} />
          </div>

          <div style={s.panelFlex3}>
            <div style={s.panelHead}>AGENTS</div>
            <div style={s.scrollInner}>
              {agents.breakdown.length === 0 ? (
                <div style={s.empty}>No agents spawned</div>
              ) : agents.breakdown.map((a) => (
                <AgentRow key={a.id} agent={a} total={tokens.totalTokens} />
              ))}
            </div>
          </div>
        </div>

        {/* ── COLUMN 2 ── */}
        <div style={s.col}>
          <div style={s.panelFlex2}>
            <div style={s.panelHead}>SAVINGS BREAKDOWN</div>
            <SavingsViz savings={tokens.savings} totalWithout={totalWithout} estDollar={estDollarSaved} />
          </div>

          <div style={s.panelFlex3}>
            <div style={s.panelHead}>ROTATION TIMELINE</div>
            <div style={s.scrollInner}>
              {rotation.history.length === 0 ? (
                <div style={s.empty}>No rotations yet</div>
              ) : rotation.history.slice().reverse().map((r, i) => (
                <div key={i} style={s.rotEntry}>
                  <div style={s.rotDot} />
                  <div style={s.rotInfo}>
                    <span style={s.rotName}>{r.agentName}</span>
                    <span style={s.rotDetail}>{formatNum(r.oldTokens)} tok @ {Math.round((r.contextUsage || 0) * 100)}%</span>
                  </div>
                  <span style={s.rotTime}>{timeAgo(r.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── COLUMN 3 ── */}
        <div style={s.col}>
          <div style={s.panelFlex2}>
            <div style={s.panelHead}>MODEL ROUTING</div>
            <RoutingViz routing={routing} />
          </div>

          <div style={s.panelFlex1}>
            <div style={s.panelHead}>ADAPTIVE THRESHOLDS</div>
            <div style={s.scrollInner}>
              {adaptive.length === 0 ? (
                <div style={s.empty}>No learned profiles</div>
              ) : adaptive.map((p) => (
                <div key={p.key} style={s.adaptRow}>
                  <span style={s.adaptKey}>{p.key}</span>
                  <div style={s.adaptTrack}>
                    <div style={{ width: `${Math.round(p.threshold * 100)}%`, height: '100%', background: p.converged ? 'var(--green)' : 'var(--accent)', borderRadius: 1 }} />
                  </div>
                  <span style={s.adaptVal}>{Math.round(p.threshold * 100)}%</span>
                </div>
              ))}
            </div>
          </div>

          <div style={s.panelFlex1}>
            <div style={s.panelHead}>JOURNALIST</div>
            <div style={s.journGrid}>
              <MiniStat label="CYCLES" value={journalist.cycleCount || 0} />
              <MiniStat label="STATUS" value={journalist.running ? 'LIVE' : 'IDLE'} color={journalist.running ? 'var(--green)' : 'var(--text-dim)'} />
              <MiniStat label="INTERVAL" value={`${journalist.intervalMs ? journalist.intervalMs / 1000 : 120}s`} />
              <MiniStat label="COLD-STARTS" value={tokens.savings.fromColdStartSkip > 0 ? Math.round(tokens.savings.fromColdStartSkip / 2000) : 0} color="var(--green)" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── HERO STAT ──

function HeroStat({ label, value, color }) {
  return (
    <div style={s.heroStat}>
      <div style={{ fontSize: 15, fontWeight: 700, color: color || 'var(--text-bright)', lineHeight: 1 }}>{value}</div>
      <div style={s.heroStatLabel}>{label}</div>
    </div>
  );
}

// ── AGENT ROW ──

function AgentRow({ agent, total }) {
  const pct = total > 0 ? (agent.tokens / total) * 100 : 0;
  const alive = agent.status === 'running';
  const color = alive ? 'var(--green)' : agent.status === 'completed' ? 'var(--accent)' : agent.status === 'crashed' ? 'var(--red)' : 'var(--text-dim)';

  return (
    <div style={s.agentRow}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
        <span style={{ ...s.dot, background: color, ...(alive ? { animation: 'pulse 2s infinite' } : {}) }} />
        <span style={s.agentName}>{agent.name}</span>
        <span style={s.agentModel}>{agent.model || 'default'}</span>
        {agent.routingMode === 'auto' && <span style={s.tagAuto}>AUTO</span>}
      </div>
      <span style={s.agentTok}>{formatNum(agent.tokens)}</span>
      <div style={s.agentBar}>
        <div style={{ width: `${Math.max(pct, 1)}%`, height: '100%', background: color, borderRadius: 1 }} />
      </div>
    </div>
  );
}

// ── SAVINGS VIZ ──

function SavingsViz({ savings, totalWithout, estDollar }) {
  const items = [
    { label: 'Rotation', value: savings.fromRotation, color: 'var(--accent)' },
    { label: 'Conflicts', value: savings.fromConflictPrevention, color: 'var(--amber)' },
    { label: 'Cold-start', value: savings.fromColdStartSkip, color: 'var(--green)' },
  ];
  const total = savings.total || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6, minHeight: 0 }}>
      {/* Stacked bar */}
      <div style={s.stackedBar}>
        {items.map((it, i) => it.value > 0 && (
          <div key={i} title={`${it.label}: ${formatNum(it.value)}`} style={{
            width: `${(it.value / total) * 100}%`, height: '100%', background: it.color,
          }} />
        ))}
      </div>

      {/* Breakdown rows */}
      <div style={{ flex: 1 }}>
        {items.map((it, i) => (
          <div key={i} style={s.savRow}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, background: it.color, borderRadius: 1, flexShrink: 0 }} />
              <span>{it.label}</span>
            </div>
            <span style={{ fontWeight: 600 }}>{formatNum(it.value)}</span>
          </div>
        ))}
      </div>

      {/* Comparison footer */}
      <div style={s.savFooter}>
        <div style={s.savCompare}>
          <span style={{ color: 'var(--text-dim)' }}>Without GROOVE</span>
          <span style={{ color: 'var(--red)', fontWeight: 600 }}>{formatNum(totalWithout)}</span>
        </div>
        <div style={s.savCompare}>
          <span style={{ color: 'var(--text-dim)' }}>With GROOVE</span>
          <span style={{ color: 'var(--green)', fontWeight: 600 }}>{formatNum(totalWithout - savings.total)}</span>
        </div>
      </div>
    </div>
  );
}

// ── ROUTING VIZ ──

function RoutingViz({ routing }) {
  const tiers = [
    { key: 'heavy', label: 'HEAVY', sub: 'Opus / o3 / Pro', color: 'var(--red)', count: routing.byTier.heavy },
    { key: 'medium', label: 'MEDIUM', sub: 'Sonnet / o4-mini / Flash', color: 'var(--amber)', count: routing.byTier.medium },
    { key: 'light', label: 'LIGHT', sub: 'Haiku', color: 'var(--green)', count: routing.byTier.light },
  ];
  const maxCount = Math.max(...tiers.map((t) => t.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10, minHeight: 0 }}>
      {tiers.map((t) => (
        <div key={t.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: t.color, letterSpacing: 1 }}>{t.label}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-bright)' }}>{t.count}</span>
          </div>
          <div style={s.routBar}>
            <div style={{
              width: `${Math.max((t.count / maxCount) * 100, 1)}%`, height: '100%',
              background: `linear-gradient(90deg, ${t.color}, ${t.color}88)`, borderRadius: 1,
            }} />
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-dim)', marginTop: 2 }}>{t.sub}</div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <span>{routing.autoRoutedCount} auto-routed</span>
        <span>{routing.totalDecisions} total</span>
      </div>
    </div>
  );
}

// ── MINI STAT ──

function MiniStat({ label, value, color }) {
  return (
    <div style={s.miniStat}>
      <div style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text-bright)', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 7, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── BURN RATE CHART ──

function BurnRateChart({ agents }) {
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

    // Subtle grid
    ctx.strokeStyle = '#2c313a';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    const active = agents.filter((a) => a.tokens > 0 || a.status === 'running');
    if (active.length === 0) {
      ctx.fillStyle = '#3e4451';
      ctx.font = '10px monospace';
      ctx.fillText('awaiting telemetry...', w / 2 - 60, h / 2);
      return;
    }

    const maxTok = Math.max(...active.map((a) => a.tokens), 1);
    const gap = 6;
    const barW = Math.min(Math.max(Math.floor((w - 24) / active.length) - gap, 12), 48);
    const totalW = active.length * (barW + gap) - gap;
    const startX = (w - totalW) / 2;
    const colors = ['#33afbc', '#e5c07b', '#98c379', '#c678dd', '#e06c75', '#61afef', '#d19a66'];

    active.forEach((agent, i) => {
      const x = startX + i * (barW + gap);
      const barH = Math.max((agent.tokens / maxTok) * (h - 28), 2);
      const color = colors[i % colors.length];
      const y = h - 14 - barH;

      // Glow
      if (agent.status === 'running') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, barH);
      ctx.shadowBlur = 0;

      // Gradient overlay
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, 'rgba(255,255,255,0.1)');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barW, barH);

      // Label
      ctx.fillStyle = '#5c6370';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      const lbl = agent.name.length > 7 ? agent.name.slice(0, 6) + '..' : agent.name;
      ctx.fillText(lbl, x + barW / 2, h - 3);

      // Value
      ctx.fillStyle = '#abb2bf';
      ctx.font = '9px monospace';
      const tok = agent.tokens >= 1000 ? `${(agent.tokens / 1000).toFixed(1)}k` : String(agent.tokens);
      ctx.fillText(tok, x + barW / 2, y - 4);
      ctx.textAlign = 'left';
    });

    // Y-axis
    ctx.fillStyle = '#3e4451';
    ctx.font = '8px monospace';
    ctx.fillText(maxTok >= 1000 ? `${(maxTok / 1000).toFixed(0)}k` : String(maxTok), 2, 10);
  }, [agents]);

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

function formatNum(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function formatUptime(sec) {
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
  // Root — full screen, no scroll
  root: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    padding: 10,
    gap: 8,
    background: 'var(--bg-base)',
  },

  // Loading
  loadingRoot: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    height: '100%', gap: 12,
  },
  loadingText: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-dim)',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  loadingBar: {
    width: 120, height: 2, background: 'var(--bg-surface)', borderRadius: 1, overflow: 'hidden',
  },
  loadingFill: {
    width: '40%', height: '100%', background: 'var(--accent)',
    animation: 'pulse 1.5s infinite',
  },

  // Hero row
  heroRow: {
    display: 'flex', alignItems: 'stretch', gap: 6,
    flexShrink: 0, height: 62,
  },
  heroStat: {
    flex: 1,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '4px 6px',
    borderTop: '2px solid var(--border)',
  },
  heroStatLabel: {
    fontSize: 7, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 3,
  },

  // Center hero — the money shot
  heroCenterBox: {
    flex: 1,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderTop: '2px solid var(--green)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '4px 6px',
  },
  heroDollar: {
    fontSize: 15, fontWeight: 700, color: 'var(--green)', lineHeight: 1,
  },
  heroCenterLabel: {
    fontSize: 7, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 3,
  },
  heroCenterSub: {
    display: 'none',
  },

  // Main 3-col grid
  mainGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
    flex: 1, minHeight: 0,
  },
  col: {
    display: 'flex', flexDirection: 'column', gap: 8, minHeight: 0,
  },

  // Panel variants (flex ratios)
  panelFlex1: {
    flex: 1, minHeight: 0, overflow: 'hidden',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '6px 8px', display: 'flex', flexDirection: 'column',
  },
  panelFlex2: {
    flex: 2, minHeight: 0, overflow: 'hidden',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '6px 8px', display: 'flex', flexDirection: 'column',
  },
  panelFlex3: {
    flex: 3, minHeight: 0, overflow: 'hidden',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '6px 8px', display: 'flex', flexDirection: 'column',
  },
  panelHead: {
    fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
    paddingBottom: 4, marginBottom: 4, flexShrink: 0,
    borderBottom: '1px solid var(--border)',
  },
  scrollInner: {
    flex: 1, minHeight: 0, overflowY: 'auto',
  },
  empty: {
    color: 'var(--text-dim)', fontSize: 10, textAlign: 'center', padding: 12, opacity: 0.6,
  },

  // Agent rows
  agentRow: {
    display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
    padding: '5px 0', borderBottom: '1px solid var(--bg-base)',
  },
  dot: { width: 5, height: 5, borderRadius: '50%', flexShrink: 0 },
  agentName: { fontSize: 10, color: 'var(--text-bright)', fontWeight: 600 },
  agentModel: { fontSize: 8, color: 'var(--text-dim)' },
  tagAuto: {
    fontSize: 7, fontWeight: 700, color: 'var(--accent)',
    border: '1px solid var(--accent)', padding: '0 2px', lineHeight: '11px', letterSpacing: 0.5,
  },
  agentTok: { fontSize: 10, color: 'var(--text-primary)', fontWeight: 600, marginLeft: 'auto' },
  agentBar: { width: '100%', height: 2, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },

  // Savings
  stackedBar: {
    height: 10, background: '#2c313a', borderRadius: 2, overflow: 'hidden',
    display: 'flex', flexShrink: 0,
  },
  savRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '3px 0', fontSize: 10, color: 'var(--text-primary)',
  },
  savFooter: {
    borderTop: '1px solid var(--border)', paddingTop: 4, flexShrink: 0,
  },
  savCompare: {
    display: 'flex', justifyContent: 'space-between',
    fontSize: 10, padding: '2px 0',
  },

  // Routing
  routBar: {
    height: 5, background: '#2c313a', borderRadius: 1, overflow: 'hidden',
  },

  // Adaptive
  adaptRow: {
    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
  },
  adaptKey: { fontSize: 9, color: 'var(--text-primary)', minWidth: 80, fontWeight: 600 },
  adaptTrack: { flex: 1, height: 3, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },
  adaptVal: { fontSize: 9, color: 'var(--text-dim)', minWidth: 28, textAlign: 'right' },

  // Journalist
  journGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, flex: 1,
  },
  miniStat: {
    background: 'var(--bg-base)', border: '1px solid var(--border)',
    padding: 4, textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  },

  // Rotation timeline
  rotEntry: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '4px 0', borderBottom: '1px solid var(--bg-base)', fontSize: 10,
  },
  rotDot: { width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0 },
  rotInfo: { flex: 1, minWidth: 0 },
  rotName: { color: 'var(--text-bright)', fontWeight: 600, marginRight: 6 },
  rotDetail: { color: 'var(--text-dim)', fontSize: 9 },
  rotTime: { color: 'var(--text-dim)', fontSize: 9, flexShrink: 0 },
};
