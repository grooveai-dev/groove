// GROOVE GUI — Agent Node Component
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { Handle, Position } from '@xyflow/react';

const STATUS_COLORS = {
  running: '#22c55e',
  starting: '#eab308',
  stopped: '#6b7280',
  crashed: '#ef4444',
  completed: '#06b6d4',
  killed: '#6b7280',
};

const STATUS_LABELS = {
  running: 'Running',
  starting: 'Starting...',
  stopped: 'Stopped',
  crashed: 'Crashed',
  completed: 'Done',
  killed: 'Killed',
};

export default function AgentNode({ data }) {
  const color = STATUS_COLORS[data.status] || '#6b7280';
  const contextPct = Math.round((data.contextUsage || 0) * 100);
  const isAlive = data.status === 'running' || data.status === 'starting';
  const isSelected = data.selected;

  return (
    <div style={{
      background: isSelected ? '#161625' : '#12121a',
      border: `1.5px solid ${isSelected ? color : color + '40'}`,
      borderRadius: 10,
      padding: '14px 18px',
      minWidth: 230,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      cursor: 'pointer',
      transition: 'border-color 0.15s, background 0.15s',
      opacity: isAlive ? 1 : 0.6,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: color, width: 6, height: 6 }} />

      {/* Name + status dot */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: color,
            boxShadow: isAlive ? `0 0 8px ${color}80` : 'none',
            animation: data.status === 'running' ? 'pulse 2s infinite' : 'none',
          }} />
          <strong style={{ fontSize: 14, color: '#f0f0f0' }}>{data.name}</strong>
        </div>
        <span style={{
          fontSize: 10, color, fontWeight: 600,
          textTransform: 'uppercase', letterSpacing: 0.5,
        }}>
          {STATUS_LABELS[data.status] || data.status}
        </span>
      </div>

      {/* Meta info */}
      <div style={{ fontSize: 11, color: '#777', lineHeight: 1.7 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{data.role}</span>
          <span style={{ fontFamily: 'monospace', color: '#555' }}>{data.provider}</span>
        </div>
        {data.scope?.length > 0 && (
          <div style={{
            fontFamily: 'monospace', fontSize: 10, color: '#555',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {data.scope.join(', ')}
          </div>
        )}
      </div>

      {/* Context bar */}
      <div style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
          <span style={{ fontSize: 10, color: '#555' }}>Context</span>
          <span style={{ fontSize: 10, color: '#555', fontFamily: 'monospace' }}>
            {contextPct}%
          </span>
        </div>
        <div style={{
          height: 4, background: '#1e1e2e', borderRadius: 2, overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${Math.max(contextPct, 1)}%`,
            background: contextPct > 80 ? '#ef4444' : contextPct > 60 ? '#eab308' : '#22c55e',
            borderRadius: 2,
            transition: 'width 0.5s ease, background 0.3s',
          }} />
        </div>
      </div>

      {/* Token count */}
      {data.tokensUsed > 0 && (
        <div style={{
          marginTop: 8, fontSize: 10, color: '#555',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>Tokens</span>
          <span style={{ fontFamily: 'monospace' }}>
            {data.tokensUsed.toLocaleString()}
          </span>
        </div>
      )}

      <Handle type="source" position={Position.Bottom} style={{ background: color, width: 6, height: 6 }} />
    </div>
  );
}
