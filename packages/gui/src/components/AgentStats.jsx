// GROOVE GUI — Agent Stats Tab
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useEffect, useRef } from 'react';
import { useGrooveStore } from '../stores/groove';

export default function AgentStats({ agent }) {
  const activityLog = useGrooveStore((s) => s.activityLog);
  const tokenTimeline = useGrooveStore((s) => s.tokenTimeline);
  const activity = activityLog[agent.id] || [];
  const timeline = tokenTimeline[agent.id] || [];

  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const uptime = agent.spawnedAt ? formatDuration(Date.now() - new Date(agent.spawnedAt).getTime()) : '-';
  const tokensPerMin = agent.spawnedAt && agent.tokensUsed > 0
    ? Math.round(agent.tokensUsed / ((Date.now() - new Date(agent.spawnedAt).getTime()) / 60000))
    : 0;

  return (
    <div style={styles.container}>
      {/* Key metrics */}
      <div style={styles.metricsGrid}>
        <Metric label="Tokens" value={agent.tokensUsed?.toLocaleString() || '0'} />
        <Metric label="Burn Rate" value={`${tokensPerMin}/min`} />
        <Metric label="Uptime" value={uptime} />
        <Metric label="Activity" value={`${activity.length} events`} />
      </div>

      {/* Live token heartbeat chart */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>TOKEN HEARTBEAT</div>
        <HeartbeatChart data={timeline} isAlive={agent.status === 'running'} />
      </div>

      {/* Context gauge */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>CONTEXT USAGE</div>
        <div style={styles.gaugeRow}>
          <div style={styles.gaugeTrack}>
            <div style={{
              height: '100%', width: `${contextPct}%`, borderRadius: 1,
              background: contextPct > 80 ? 'var(--red)' : contextPct > 60 ? 'var(--amber)' : 'var(--green)',
              transition: 'width 0.3s',
            }} />
          </div>
          <span style={styles.gaugeLabel}>{contextPct}%</span>
        </div>
      </div>

      {/* Activity sparkline */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>ACTIVITY PULSE</div>
        <ActivityChart activity={activity} />
      </div>

      {/* Info grid */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>DETAILS</div>
        <div style={styles.infoList}>
          <InfoRow label="ID" value={agent.id} />
          <InfoRow label="Role" value={agent.role} />
          <InfoRow label="Provider" value={agent.provider} />
          <InfoRow label="Model" value={agent.model || 'default'} />
          {agent.workingDir && <InfoRow label="Directory" value={agent.workingDir} />}
          <InfoRow label="Scope" value={(agent.scope || []).join(', ') || 'unrestricted'} />
          <InfoRow label="Spawned" value={agent.spawnedAt ? new Date(agent.spawnedAt).toLocaleTimeString() : '-'} />
          <InfoRow label="Last Active" value={agent.lastActivity ? new Date(agent.lastActivity).toLocaleTimeString() : '-'} />
        </div>
      </div>

      {/* Prompt */}
      {agent.prompt && (
        <div style={{ marginTop: 16 }}>
          <div style={styles.sectionLabel}>ORIGINAL PROMPT</div>
          <div style={styles.promptBox}>{agent.prompt}</div>
        </div>
      )}

      {/* Recent log */}
      <div style={{ marginTop: 16 }}>
        <div style={styles.sectionLabel}>RECENT LOG ({activity.length})</div>
        <div style={styles.logScroll}>
          {activity.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 11, padding: 8 }}>No activity yet...</div>
          )}
          {activity.slice(-30).reverse().map((entry, i) => (
            <div key={i} style={styles.logEntry}>
              <span style={styles.logTime}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              <span style={styles.logText}>{entry.text?.slice(0, 200)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Live token heartbeat — draws a real-time line chart of token accumulation
function HeartbeatChart({ data, isAlive }) {
  const canvasRef = useRef();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = '#3e4451';
    ctx.lineWidth = 0.5;
    for (let y = 0; y < h; y += h / 4) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    if (data.length < 2) {
      // Flat line
      ctx.strokeStyle = isAlive ? '#5c6370' : '#3e4451';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (isAlive) {
        ctx.fillStyle = '#5c6370';
        ctx.font = '10px monospace';
        ctx.fillText('waiting for data...', 8, h / 2 - 6);
      }
      return;
    }

    const values = data.map((d) => d.v);
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    // Detect spikes (>20% jump between consecutive points)
    const spikes = [];
    for (let i = 1; i < values.length; i++) {
      const jump = values[i] - values[i - 1];
      if (jump > range * 0.2 && jump > 0) {
        spikes.push(i);
      }
    }

    // Draw fill gradient under line
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, isAlive ? 'rgba(51, 175, 188, 0.15)' : 'rgba(92, 99, 112, 0.1)');
    gradient.addColorStop(1, 'transparent');

    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h - 4 - ((values[i] - minV) / range) * (h - 8);
      if (i === 0) ctx.lineTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Draw main line
    ctx.strokeStyle = isAlive ? '#33afbc' : '#5c6370';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h - 4 - ((values[i] - minV) / range) * (h - 8);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Draw spike markers
    for (const idx of spikes) {
      const x = (idx / (data.length - 1)) * w;
      const y = h - 4 - ((values[idx] - minV) / range) * (h - 8);
      ctx.fillStyle = '#e5c07b';
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Current value dot (pulsing effect via CSS)
    if (isAlive && data.length > 0) {
      const lastX = w;
      const lastY = h - 4 - ((values[values.length - 1] - minV) / range) * (h - 8);
      ctx.fillStyle = '#33afbc';
      ctx.beginPath();
      ctx.arc(lastX - 2, lastY, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Y-axis labels
    ctx.fillStyle = '#5c6370';
    ctx.font = '9px monospace';
    ctx.fillText(maxV.toLocaleString(), 4, 10);
    ctx.fillText(minV.toLocaleString(), 4, h - 2);

  }, [data, isAlive]);

  return (
    <div style={styles.chartContainer}>
      <canvas
        ref={canvasRef}
        width={400}
        height={60}
        style={{ width: '100%', height: 60, display: 'block' }}
      />
    </div>
  );
}

// Activity frequency chart
function ActivityChart({ activity }) {
  const points = 40;
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const bucketSize = windowMs / points;
  const buckets = new Array(points).fill(0);

  for (const entry of activity) {
    const age = now - entry.timestamp;
    if (age > windowMs) continue;
    const idx = Math.min(Math.floor((windowMs - age) / bucketSize), points - 1);
    buckets[idx]++;
  }

  const max = Math.max(...buckets, 1);
  const sparkPoints = buckets.map((count, i) => {
    const x = (i / (points - 1)) * 300;
    const y = 28 - (count / max) * 24;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div style={styles.chartContainer}>
      <svg width="100%" height="32" viewBox="0 0 300 32" preserveAspectRatio="none" style={{ display: 'block' }}>
        <polyline points={sparkPoints} fill="none" stroke="var(--green)" strokeWidth="1" opacity="0.6" />
        <line x1="0" y1="31" x2="300" y2="31" stroke="var(--text-muted)" strokeWidth="0.5" />
      </svg>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={styles.metric}>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-bright)' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 1 }}>{label}</div>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{label}</span>
      <span style={{
        color: 'var(--text-primary)', fontSize: 11,
        maxWidth: '65%', textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {value}
      </span>
    </div>
  );
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

const styles = {
  container: {
    flex: 1, overflowY: 'auto', padding: '10px 0',
  },
  metricsGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
  },
  metric: {
    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 10, textAlign: 'center',
  },
  sectionLabel: {
    fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase',
    letterSpacing: 1.5, marginBottom: 6, fontWeight: 600,
  },
  gaugeRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  },
  gaugeTrack: {
    flex: 1, height: 4, background: 'var(--text-muted)', borderRadius: 2, overflow: 'hidden',
  },
  gaugeLabel: {
    fontSize: 12, color: 'var(--text-primary)', fontWeight: 600, minWidth: 36, textAlign: 'right',
  },
  chartContainer: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: '6px 8px', overflow: 'hidden',
  },
  infoList: {
    borderTop: '1px solid var(--border)', paddingTop: 6,
  },
  promptBox: {
    background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 2,
    padding: 8, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  logScroll: {
    maxHeight: 160, overflowY: 'auto',
    background: 'var(--bg-base)', borderRadius: 2,
    border: '1px solid var(--border)',
  },
  logEntry: {
    padding: '3px 8px', borderBottom: '1px solid var(--bg-surface)',
    fontSize: 10, display: 'flex', gap: 6,
  },
  logTime: { color: 'var(--text-dim)', whiteSpace: 'nowrap' },
  logText: { color: 'var(--text-primary)', wordBreak: 'break-word' },
};
