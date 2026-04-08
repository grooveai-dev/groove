// GROOVE GUI — Agent Node Component
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { Handle, Position } from '@xyflow/react';

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

  // Get scope summary for activity text — prefer workingDir if set
  const activity = data.workingDir
    ? data.workingDir.replace(/^\.\//, '')
    : data.scope?.length > 0
      ? data.scope[0].replace(/\/\*\*$/, '').replace(/^src\//, '')
      : data.role;

  const bg = sel ? '#2e333c' : alive ? '#2a2f38' : '#282c34';

  return (
    <div style={{
      background: bg,
      border: '1px solid #3e4451',
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

      <Handle type="source" position={Position.Bottom} style={{
        background: '#282c34', border: '2px solid #3e4451',
        width: 8, height: 8, borderRadius: '50%', bottom: -4,
      }} />
    </div>
  );
}

