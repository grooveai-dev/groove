// GROOVE GUI — Command Center Dashboard
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useState, useEffect, useRef, useCallback } from 'react';

const COST_PER_1K = { heavy: 0.045, medium: 0.009, light: 0.0024 };
const ACCENT = '#33afbc';
const GREEN = '#4ae168';
const AMBER = '#e5c07b';
const RED = '#e06c75';
const PURPLE = '#c678dd';
const BLUE = '#61afef';
const AGENT_COLORS = [ACCENT, AMBER, GREEN, PURPLE, RED, BLUE, '#d19a66'];

export default function CommandCenter() {
  const [data, setData] = useState(null);
  const [savingsHistory, setSavingsHistory] = useState([]);

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
      // Track savings over time for accumulation chart
      setSavingsHistory((prev) => {
        const next = [...prev, { t: Date.now(), v: d.tokens.savings.total, r: d.tokens.savings.fromRotation, c: d.tokens.savings.fromConflictPrevention, s: d.tokens.savings.fromColdStartSkip }];
        return next.length > 100 ? next.slice(-100) : next;
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

  const { tokens, agents, routing, rotation, adaptive, journalist, uptime } = data;
  const estDollarSaved = (tokens.savings.total / 1000) * COST_PER_1K.medium;
  const totalWithout = tokens.savings.estimatedWithoutGroove;

  return (
    <div style={s.root}>

      {/* HERO ROW */}
      <div style={s.heroRow}>
        <HeroStat label="TOKENS USED" value={formatNum(tokens.totalTokens)} sub={`${agents.total} agent${agents.total !== 1 ? 's' : ''}`} />
        <HeroStat label="TOKENS SAVED" value={formatNum(tokens.savings.total)} color={GREEN} sub={`${tokens.savings.percentage || 0}% efficiency`} />

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

        <HeroStat label="AGENTS" value={`${agents.running} LIVE`} color={agents.running > 0 ? GREEN : undefined} sub={`${agents.total} total`} />
        <HeroStat label="ROTATIONS" value={rotation.totalRotations} sub={rotation.totalRotations > 0 ? `${formatNum(rotation.totalTokensSaved)} tok saved` : 'auto-managed'} />
        <HeroStat label="UPTIME" value={formatUptime(uptime)} sub="daemon session" />
      </div>

      {/* MAIN GRID */}
      <div style={s.mainGrid}>

        {/* ROW 1: Charts */}
        <Panel title="TOKEN BURN RATE" flex={1}>
          <BurnRateChart agents={agents.breakdown} />
        </Panel>

        <Panel title="SAVINGS ACCUMULATION" flex={1}>
          <SavingsChart history={savingsHistory} />
        </Panel>

        <Panel title="MODEL ROUTING" flex={1}>
          <RoutingViz routing={routing} agents={agents.breakdown} />
        </Panel>

        {/* ROW 2: Data */}
        <Panel title="AGENT FLEET" flex={1}>
          <div style={s.scrollInner}>
            {agents.breakdown.length === 0 ? (
              <div style={s.empty}>No agents spawned</div>
            ) : agents.breakdown.map((a, i) => (
              <AgentCard key={a.id} agent={a} total={tokens.totalTokens} color={AGENT_COLORS[i % AGENT_COLORS.length]} />
            ))}
          </div>
        </Panel>

        <Panel title="ROTATION TIMELINE" flex={1}>
          <div style={s.scrollInner}>
            {rotation.history.length === 0 ? (
              <div style={s.empty}>No rotations yet</div>
            ) : rotation.history.slice().reverse().map((r, i) => (
              <div key={i} style={s.rotEntry}>
                <div style={s.rotDot} />
                <div style={s.rotInfo}>
                  <span style={s.rotName}>{r.agentName}</span>
                  <span style={s.rotSaved}>{formatNum(r.oldTokens)} saved</span>
                </div>
                <span style={s.rotMeta}>{Math.round((r.contextUsage || 0) * 100)}%</span>
                <span style={s.rotTime}>{timeAgo(r.timestamp)}</span>
              </div>
            ))}
          </div>
        </Panel>

        <div style={s.splitCol}>
          <Panel title="ADAPTIVE THRESHOLDS" flex={3}>
            <div style={s.scrollInner}>
              {adaptive.length === 0 ? (
                <div style={s.empty}>No learned profiles</div>
              ) : adaptive.map((p) => (
                <AdaptiveRow key={p.key} profile={p} />
              ))}
            </div>
          </Panel>

          <Panel title="JOURNALIST" flex={2}>
            <JournalistPanel journalist={journalist} savings={tokens.savings} />
          </Panel>
        </div>

      </div>
    </div>
  );
}

// ── HERO STAT ──

function HeroStat({ label, value, color, sub }) {
  return (
    <div style={s.heroStat}>
      <div style={{ fontSize: 16, fontWeight: 700, color: color || 'var(--text-bright)', lineHeight: 1 }}>{value}</div>
      <div style={s.heroStatLabel}>{label}</div>
      {sub && <div style={s.heroStatSub}>{sub}</div>}
    </div>
  );
}

// ── PANEL WRAPPER ──

function Panel({ title, children, flex = 1 }) {
  return (
    <div style={{ ...s.panel, flex }}>
      <div style={s.panelHead}>{title}</div>
      {children}
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
      <div style={s.agentCardTop}>
        <span style={{ ...s.dot, background: statusColor, ...(alive ? { animation: 'pulse 2s infinite', boxShadow: `0 0 6px ${statusColor}` } : {}) }} />
        <span style={s.agentName}>{agent.name}</span>
        <span style={s.agentRole}>{agent.role}</span>
        {agent.routingMode === 'auto' && <span style={s.tagAuto}>AUTO</span>}
        <span style={s.agentTok}>{formatNum(agent.tokens)}</span>
      </div>
      <div style={s.agentCardBottom}>
        <div style={s.agentBarTrack}>
          <div style={{ width: `${Math.max(pct, 0.5)}%`, height: '100%', background: color, borderRadius: 1 }} />
        </div>
        <span style={s.agentModel}>{agent.model || 'default'}</span>
        <ContextMini value={agent.contextUsage} />
      </div>
    </div>
  );
}

// ── CONTEXT MINI GAUGE ──

function ContextMini({ value }) {
  const pct = Math.round((value || 0) * 100);
  const color = pct > 80 ? RED : pct > 60 ? AMBER : GREEN;
  return (
    <div style={s.ctxMini}>
      <div style={s.ctxMiniTrack}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 1 }} />
      </div>
      <span style={{ fontSize: 8, color: 'var(--text-dim)', minWidth: 20, textAlign: 'right' }}>{pct}%</span>
    </div>
  );
}

// ── SAVINGS CHART — Thin vertical bars showing savings accumulation ──

function SavingsChart({ history }) {
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

    // Grid lines
    ctx.strokeStyle = '#2c313a';
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    if (history.length < 2) {
      ctx.fillStyle = '#3e4451';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('accumulating data...', w / 2, h / 2);
      return;
    }

    const maxV = Math.max(...history.map((h) => h.v), 1);
    const padB = 16;
    const padT = 8;
    const usableH = h - padB - padT;

    // Thin vertical bars — one per data point
    const barW = 2;
    const gap = Math.max(Math.floor((w - 20) / history.length) - barW, 2);
    const totalW = history.length * (barW + gap) - gap;
    const startX = (w - totalW) / 2;

    history.forEach((point, i) => {
      const x = startX + i * (barW + gap);

      // Stacked: rotation (accent) + conflicts (amber) + cold-start (green)
      const rH = (point.r / maxV) * usableH;
      const cH = (point.c / maxV) * usableH;
      const sH = (point.s / maxV) * usableH;

      let y = h - padB;

      // Rotation savings
      if (rH > 0) {
        ctx.fillStyle = ACCENT;
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 4;
        ctx.fillRect(x, y - rH, barW, rH);
        y -= rH;
      }

      // Conflict savings
      if (cH > 0) {
        ctx.fillStyle = AMBER;
        ctx.shadowColor = AMBER;
        ctx.shadowBlur = 4;
        ctx.fillRect(x, y - cH, barW, cH);
        y -= cH;
      }

      // Cold-start savings
      if (sH > 0) {
        ctx.fillStyle = GREEN;
        ctx.shadowColor = GREEN;
        ctx.shadowBlur = 4;
        ctx.fillRect(x, y - sH, barW, sH);
      }

      ctx.shadowBlur = 0;
    });

    // Legend
    ctx.font = '8px monospace';
    const legendY = h - 3;
    ctx.fillStyle = ACCENT; ctx.fillRect(4, legendY - 5, 6, 2);
    ctx.fillStyle = '#5c6370'; ctx.fillText('rot', 13, legendY);
    ctx.fillStyle = AMBER; ctx.fillRect(34, legendY - 5, 6, 2);
    ctx.fillStyle = '#5c6370'; ctx.fillText('conf', 43, legendY);
    ctx.fillStyle = GREEN; ctx.fillRect(70, legendY - 5, 6, 2);
    ctx.fillStyle = '#5c6370'; ctx.fillText('cold', 79, legendY);

    // Max label
    ctx.fillStyle = '#3e4451';
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatNum(maxV), 2, padT);
  }, [history]);

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

// ── BURN RATE CHART — Thin vertical bars per agent ──

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

    // Grid
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
      ctx.textAlign = 'center';
      ctx.fillText('awaiting telemetry...', w / 2, h / 2);
      return;
    }

    const maxTok = Math.max(...active.map((a) => a.tokens), 1);
    const padB = 16;
    const padT = 4;
    const usableH = h - padB - padT;

    // Thin bars with generous spacing
    const barW = 3;
    const gap = Math.max(Math.floor((w - 24) / active.length) - barW, 8);
    const totalW = active.length * (barW + gap) - gap;
    const startX = (w - totalW) / 2;

    active.forEach((agent, i) => {
      const x = startX + i * (barW + gap);
      const barH = Math.max((agent.tokens / maxTok) * usableH, 2);
      const color = AGENT_COLORS[i % AGENT_COLORS.length];
      const y = h - padB - barH;

      // Glow for running agents
      if (agent.status === 'running') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, barH);
      ctx.shadowBlur = 0;

      // Label below
      ctx.fillStyle = '#5c6370';
      ctx.font = '8px monospace';
      ctx.textAlign = 'center';
      const lbl = agent.name.length > 10 ? agent.name.slice(0, 9) + '..' : agent.name;
      ctx.fillText(lbl, x + barW / 2, h - 3);

      // Value above
      ctx.fillStyle = '#abb2bf';
      ctx.font = '9px monospace';
      const tok = agent.tokens >= 1000 ? `${(agent.tokens / 1000).toFixed(1)}k` : String(agent.tokens);
      ctx.fillText(tok, x + barW / 2, y - 3);
      ctx.textAlign = 'left';
    });

    // Y max
    ctx.fillStyle = '#3e4451';
    ctx.font = '8px monospace';
    ctx.fillText(formatNum(maxTok), 2, padT + 6);
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

// ── ROUTING VIZ — Cost-proportional + decisions ──

function RoutingViz({ routing, agents }) {
  const tiers = [
    { key: 'heavy', label: 'HEAVY', cost: '$0.045/1k', color: RED, count: routing.byTier.heavy },
    { key: 'medium', label: 'MEDIUM', cost: '$0.009/1k', color: AMBER, count: routing.byTier.medium },
    { key: 'light', label: 'LIGHT', cost: '$0.002/1k', color: GREEN, count: routing.byTier.light },
  ];
  const maxCount = Math.max(...tiers.map((t) => t.count), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 10, minHeight: 0, justifyContent: 'center' }}>
      {tiers.map((t) => (
        <div key={t.key}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: t.color, letterSpacing: 1 }}>{t.label}</span>
              <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{t.cost}</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-bright)' }}>{t.count}</span>
          </div>
          <div style={s.routBar}>
            <div style={{
              width: `${Math.max((t.count / maxCount) * 100, t.count > 0 ? 2 : 0)}%`, height: '100%',
              background: `linear-gradient(90deg, ${t.color}, ${t.color}44)`, borderRadius: 1,
              boxShadow: t.count > 0 ? `0 0 8px ${t.color}44` : 'none',
            }} />
          </div>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-dim)', borderTop: '1px solid var(--border)', paddingTop: 6, marginTop: 'auto' }}>
        <span>{routing.autoRoutedCount} auto-routed</span>
        <span>{routing.totalDecisions} total decisions</span>
      </div>
    </div>
  );
}

// ── ADAPTIVE ROW — Threshold + sparkline + signals ──

function AdaptiveRow({ profile }) {
  const pct = Math.round(profile.threshold * 100);
  const scores = profile.recentScores || [];
  const signals = profile.lastSignals;

  return (
    <div style={s.adaptRow}>
      <div style={s.adaptTop}>
        <span style={s.adaptKey}>{profile.key}</span>
        <span style={{ ...s.adaptConverged, color: profile.converged ? GREEN : AMBER }}>
          {profile.converged ? 'CONVERGED' : `${profile.adjustments} adj`}
        </span>
      </div>
      <div style={s.adaptMid}>
        <div style={s.adaptTrack}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: profile.converged ? GREEN : ACCENT,
            borderRadius: 2,
            boxShadow: `0 0 6px ${profile.converged ? GREEN : ACCENT}44`,
          }} />
          <span style={s.adaptMarker}>{pct}%</span>
        </div>
        {scores.length > 2 && <MiniSparkline data={scores} width={60} height={14} color={ACCENT} />}
      </div>
      {signals && (
        <div style={s.adaptSignals}>
          {signals.errorCount > 0 && <span style={{ color: RED }}>err:{signals.errorCount}</span>}
          {signals.repetitions > 0 && <span style={{ color: AMBER }}>rep:{signals.repetitions}</span>}
          {signals.fileChurn > 0 && <span style={{ color: PURPLE }}>churn:{signals.fileChurn}</span>}
          {signals.filesWritten > 0 && <span style={{ color: GREEN }}>files:{signals.filesWritten}</span>}
        </div>
      )}
    </div>
  );
}

// ── JOURNALIST PANEL ──

function JournalistPanel({ journalist, savings }) {
  const coldStarts = savings.fromColdStartSkip > 0 ? Math.round(savings.fromColdStartSkip / 2000) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6, minHeight: 0 }}>
      <div style={s.journStats}>
        <div style={s.journStat}>
          <span style={{ fontSize: 14, fontWeight: 700, color: journalist.running ? GREEN : 'var(--text-dim)' }}>
            {journalist.running ? 'LIVE' : 'IDLE'}
          </span>
          <span style={{ fontSize: 7, color: 'var(--text-dim)' }}>STATUS</span>
        </div>
        <div style={s.journStat}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-bright)' }}>{journalist.cycleCount || 0}</span>
          <span style={{ fontSize: 7, color: 'var(--text-dim)' }}>CYCLES</span>
        </div>
        <div style={s.journStat}>
          <span style={{ fontSize: 14, fontWeight: 700, color: GREEN }}>{coldStarts}</span>
          <span style={{ fontSize: 7, color: 'var(--text-dim)' }}>COLD-STARTS SKIPPED</span>
        </div>
      </div>
      {journalist.lastSummary && (
        <div style={s.journSummary}>
          {journalist.lastSummary}
        </div>
      )}
    </div>
  );
}

// ── MINI SPARKLINE — tiny inline chart ──

function MiniSparkline({ data, width, height, color }) {
  const canvasRef = useRef();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const step = width / (data.length - 1);

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    data.forEach((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }, [data, width, height, color]);

  return <canvas ref={canvasRef} style={{ width, height, flexShrink: 0 }} />;
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
  root: {
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    padding: 12,
    gap: 10,
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
    width: '40%', height: '100%', background: ACCENT,
    animation: 'pulse 1.5s infinite',
  },

  // Hero row
  heroRow: {
    display: 'flex', alignItems: 'stretch', gap: 8,
    flexShrink: 0, height: 72,
  },
  heroStat: {
    flex: 1,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '6px 8px',
    borderTop: '2px solid var(--border)',
  },
  heroStatLabel: {
    fontSize: 7, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 3,
  },
  heroStatSub: {
    fontSize: 8, color: 'var(--text-dim)', marginTop: 1,
  },

  // Center hero — the money shot
  heroCenterBox: {
    flex: 1.8,
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderTop: `2px solid ${GREEN}`,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    padding: '6px 8px',
    boxShadow: `0 0 20px rgba(74, 225, 104, 0.08), inset 0 0 30px rgba(74, 225, 104, 0.03)`,
  },
  heroDollar: {
    fontSize: 22, fontWeight: 800, color: GREEN, lineHeight: 1,
    textShadow: `0 0 12px rgba(74, 225, 104, 0.4)`,
  },
  heroCenterLabel: {
    fontSize: 7, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 4,
  },
  heroCenterSub: {
    fontSize: 9, color: GREEN, marginTop: 2, opacity: 0.8,
  },

  // Main grid — 3 cols x 2 rows
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gridTemplateRows: '2fr 3fr',
    gap: 10,
    flex: 1, minHeight: 0,
  },

  // Panel wrapper
  panel: {
    minHeight: 0, overflow: 'hidden',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    padding: '8px 10px', display: 'flex', flexDirection: 'column',
  },
  panelHead: {
    fontSize: 9, fontWeight: 700, color: 'var(--text-dim)',
    textTransform: 'uppercase', letterSpacing: 1.5,
    paddingBottom: 6, marginBottom: 6, flexShrink: 0,
    borderBottom: '1px solid var(--border)',
  },
  scrollInner: {
    flex: 1, minHeight: 0, overflowY: 'auto',
  },
  empty: {
    color: 'var(--text-dim)', fontSize: 10, textAlign: 'center', padding: 16, opacity: 0.6,
  },

  // Split column (adaptive + journalist stacked)
  splitCol: {
    display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0,
  },

  // Agent cards
  agentCard: {
    padding: '6px 0', borderBottom: '1px solid var(--bg-base)',
  },
  agentCardTop: {
    display: 'flex', alignItems: 'center', gap: 6,
  },
  agentCardBottom: {
    display: 'flex', alignItems: 'center', gap: 6, marginTop: 4,
  },
  dot: { width: 6, height: 6, borderRadius: '50%', flexShrink: 0 },
  agentName: { fontSize: 11, color: 'var(--text-bright)', fontWeight: 600 },
  agentRole: { fontSize: 9, color: 'var(--text-dim)' },
  agentModel: { fontSize: 8, color: 'var(--text-dim)', marginLeft: 'auto' },
  tagAuto: {
    fontSize: 7, fontWeight: 700, color: ACCENT,
    border: `1px solid ${ACCENT}`, padding: '0 3px', lineHeight: '12px', letterSpacing: 0.5,
  },
  agentTok: { fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, marginLeft: 'auto' },
  agentBarTrack: { flex: 1, height: 2, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },

  // Context mini gauge
  ctxMini: { display: 'flex', alignItems: 'center', gap: 3 },
  ctxMiniTrack: { width: 30, height: 3, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },

  // Routing
  routBar: { height: 6, background: '#2c313a', borderRadius: 1, overflow: 'hidden' },

  // Adaptive
  adaptRow: {
    padding: '6px 0', borderBottom: '1px solid var(--bg-base)',
  },
  adaptTop: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4,
  },
  adaptKey: { fontSize: 10, color: 'var(--text-bright)', fontWeight: 600 },
  adaptConverged: { fontSize: 8, fontWeight: 700, letterSpacing: 0.5 },
  adaptMid: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  adaptTrack: {
    flex: 1, height: 6, background: '#2c313a', borderRadius: 2, overflow: 'hidden', position: 'relative',
  },
  adaptMarker: {
    position: 'absolute', right: 4, top: -1,
    fontSize: 8, color: 'var(--text-dim)', fontWeight: 600, lineHeight: '8px',
  },
  adaptSignals: {
    display: 'flex', gap: 8, marginTop: 3,
    fontSize: 8, fontFamily: 'var(--font)',
  },

  // Journalist
  journStats: {
    display: 'flex', gap: 6,
  },
  journStat: {
    flex: 1, background: 'var(--bg-base)', border: '1px solid var(--border)',
    padding: '6px 4px', textAlign: 'center',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  journSummary: {
    flex: 1, fontSize: 9, color: 'var(--text-primary)', lineHeight: 1.5,
    padding: '6px 4px', background: 'var(--bg-base)', border: '1px solid var(--border)',
    overflowY: 'auto', whiteSpace: 'pre-wrap',
  },

  // Rotation timeline
  rotEntry: {
    display: 'flex', alignItems: 'center', gap: 6,
    padding: '5px 0', borderBottom: '1px solid var(--bg-base)', fontSize: 10,
  },
  rotDot: {
    width: 6, height: 6, borderRadius: '50%', background: ACCENT, flexShrink: 0,
    boxShadow: `0 0 4px ${ACCENT}44`,
  },
  rotInfo: { flex: 1, minWidth: 0 },
  rotName: { color: 'var(--text-bright)', fontWeight: 600, marginRight: 6 },
  rotSaved: { color: GREEN, fontSize: 9, fontWeight: 600 },
  rotMeta: { fontSize: 9, color: 'var(--text-dim)', minWidth: 24, textAlign: 'right' },
  rotTime: { color: 'var(--text-dim)', fontSize: 9, flexShrink: 0 },
};
