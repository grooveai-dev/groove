// GROOVE GUI — Agent Node Component
// FSL-1.1-Apache-2.0 — see LICENSE

import React, { useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useGrooveStore } from '../stores/groove';

const STATUS_COLORS = {
  running:   '#4ae168',
  starting:  '#e5c07b',
  stopped:   '#5c6370',
  crashed:   '#e06c75',
  completed: '#33afbc',
  killed:    '#5c6370',
};

const ROLE_BADGES = {
  planner:   { bg: '#4ae16820', color: '#4ae168' },
  backend:   { bg: '#33afbc20', color: '#33afbc' },
  frontend:  { bg: '#e5c07b20', color: '#e5c07b' },
  fullstack: { bg: '#4ae16820', color: '#4ae168' },
  testing:   { bg: '#61afef20', color: '#61afef' },
  devops:    { bg: '#d19a6620', color: '#d19a66' },
  docs:      { bg: '#5c637020', color: '#8b929e' },
};

export default function AgentNode({ data }) {
  const statusColor = STATUS_COLORS[data.status] || STATUS_COLORS.stopped;
  const badge = ROLE_BADGES[data.role] || ROLE_BADGES.docs;
  const alive = data.status === 'running' || data.status === 'starting';
  const sel = data.selected;
  const ctx = Math.round((data.contextUsage || 0) * 100);

  const tokens = data.tokensUsed > 0
    ? data.tokensUsed > 999 ? `${(data.tokensUsed / 1000).toFixed(1)}k` : `${data.tokensUsed}`
    : '0';

  // Get scope summary for activity text
  const activity = data.scope?.length > 0
    ? data.scope[0].replace(/\/\*\*$/, '').replace(/^src\//, '')
    : data.role;

  return (
    <div style={{
      background: '#282c34',
      border: sel ? '1px solid #33afbc' : '1px solid #3e4451',
      borderRadius: 10,
      width: 210,
      padding: 0,
      cursor: 'pointer',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      fontSize: 10,
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Top} style={{
        background: '#282c34', border: '2px solid #3e4451',
        width: 8, height: 8, borderRadius: '50%', top: -4,
      }} />

      <div style={{ padding: '10px 12px 8px' }}>
        {/* Name + status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%', background: statusColor, flexShrink: 0,
            ...(alive ? { animation: 'pulse 2s infinite' } : {}),
          }} />
          <span style={{ color: '#e6e6e6', fontWeight: 700, fontSize: 12, flex: 1 }}>
            {data.name}
          </span>
        </div>

        {/* Role badge */}
        <div style={{ marginBottom: 10 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
            color: badge.color, background: badge.bg,
            padding: '3px 8px', borderRadius: 4,
            display: 'inline-block',
          }}>
            {data.role}
          </span>
        </div>

        {/* Metrics */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          color: '#5c6370', fontSize: 10, marginBottom: 4,
        }}>
          <span>{tokens} tok</span>
          <span>{ctx}% ctx</span>
        </div>

        {/* Activity text */}
        <div style={{
          color: '#3e4451', fontSize: 9,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {activity}
        </div>
      </div>

      {/* Live heartbeat — real-time token line chart */}
      {alive && <Heartbeat agentId={data.id} color={statusColor} />}

      <Handle type="source" position={Position.Bottom} style={{
        background: '#282c34', border: '2px solid #3e4451',
        width: 8, height: 8, borderRadius: '50%', bottom: -4,
      }} />
    </div>
  );
}

// ── HEARTBEAT — Mini real-time token line chart ──

function Heartbeat({ agentId, color }) {
  const canvasRef = useRef();
  const tokenTimeline = useGrooveStore((s) => s.tokenTimeline);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w = 210;
    const h = 24;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pts = tokenTimeline[agentId] || [];
    if (pts.length < 2) {
      // Flat baseline
      ctx.strokeStyle = '#2c313a';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    // Use last 40 data points
    const data = pts.slice(-40);
    const vals = data.map((p) => p.v);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const range = max - min || 1;

    const padY = 4;
    const usableH = h - padY * 2;
    const step = w / (data.length - 1);

    // Line
    ctx.beginPath();
    data.forEach((p, i) => {
      const x = i * step;
      const y = padY + usableH - ((p.v - min) / range) * usableH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // End dot
    const lastX = (data.length - 1) * step;
    const lastY = padY + usableH - ((data[data.length - 1].v - min) / range) * usableH;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }, [tokenTimeline, agentId, color]);

  return (
    <div style={{ borderTop: '1px solid #2c313a', background: '#1e222a' }}>
      <canvas ref={canvasRef} style={{ display: 'block', width: 210, height: 24 }} />
    </div>
  );
}
