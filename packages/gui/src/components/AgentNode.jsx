// GROOVE GUI — Agent Node Component (Unity/n8n inspired)
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { Handle, Position } from '@xyflow/react';

const STATUS = {
  running:   { color: '#4ae168', label: 'LIVE' },
  starting:  { color: '#e5c07b', label: 'INIT' },
  stopped:   { color: '#5c6370', label: 'STOP' },
  crashed:   { color: '#e06c75', label: 'FAIL' },
  completed: { color: '#33afbc', label: 'DONE' },
  killed:    { color: '#5c6370', label: 'KILL' },
};

const ROLE_COLORS = {
  planner:   '#c678dd',
  backend:   '#33afbc',
  frontend:  '#e5c07b',
  fullstack: '#4ae168',
  testing:   '#61afef',
  devops:    '#d19a66',
  docs:      '#5c6370',
};

export default function AgentNode({ data }) {
  const st = STATUS[data.status] || STATUS.stopped;
  const alive = data.status === 'running' || data.status === 'starting';
  const sel = data.selected;
  const roleColor = ROLE_COLORS[data.role] || '#33afbc';
  const ctx = Math.round((data.contextUsage || 0) * 100);

  const tokens = data.tokensUsed > 0
    ? data.tokensUsed > 999 ? `${(data.tokensUsed / 1000).toFixed(1)}k` : `${data.tokensUsed}`
    : '0';

  return (
    <div style={{
      background: '#282c34',
      border: sel ? '1px solid #33afbc' : '1px solid #3e4451',
      borderRadius: 8,
      width: 170,
      cursor: 'pointer',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      fontSize: 10,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}>
      {/* Target handle — circular port */}
      <Handle type="target" position={Position.Top} style={{
        background: '#282c34', border: `2px solid ${sel ? '#33afbc' : '#3e4451'}`,
        width: 8, height: 8, borderRadius: '50%', top: -4,
      }} />

      {/* Header */}
      <div style={{
        padding: '8px 10px 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          color: '#e6e6e6', fontWeight: 700, fontSize: 11,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {data.name}
        </span>
        {/* Status dot */}
        <div style={{
          width: 6, height: 6, borderRadius: '50%', background: st.color, flexShrink: 0,
          ...(alive ? { animation: 'pulse 2s infinite' } : {}),
        }} />
      </div>

      {/* Role badge */}
      <div style={{ padding: '0 10px 6px' }}>
        <span style={{
          fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1,
          color: roleColor, background: roleColor + '18', padding: '2px 6px', borderRadius: 3,
        }}>
          {data.role}
        </span>
      </div>

      {/* Metrics — minimal */}
      <div style={{
        padding: '4px 10px 6px',
        borderTop: '1px solid #2c313a',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: '#8b929e', fontSize: 9 }}>
          {tokens} <span style={{ color: '#5c6370' }}>tok</span>
        </span>
        <span style={{ color: '#8b929e', fontSize: 9 }}>
          {ctx}% <span style={{ color: '#5c6370' }}>ctx</span>
        </span>
      </div>

      {/* Activity bar for live agents */}
      {alive && (
        <div style={{
          height: 2, background: '#1a1e25', overflow: 'hidden',
        }}>
          <div style={{
            width: '200%', height: '100%',
            background: `linear-gradient(90deg, transparent 25%, ${st.color}44 35%, ${st.color} 50%, ${st.color}44 65%, transparent 75%)`,
            animation: 'neuralFlow 2s linear infinite',
          }} />
        </div>
      )}

      {/* Source handle — circular port */}
      <Handle type="source" position={Position.Bottom} style={{
        background: '#282c34', border: `2px solid ${sel ? '#33afbc' : '#3e4451'}`,
        width: 8, height: 8, borderRadius: '50%', bottom: -4,
      }} />
    </div>
  );
}
