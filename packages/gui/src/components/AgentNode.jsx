// GROOVE GUI — Agent Node Component
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { Handle, Position } from '@xyflow/react';

const STATUS = {
  running:   { color: '#98c379', label: 'LIVE',  bar: '#98c379' },
  starting:  { color: '#e5c07b', label: 'INIT',  bar: '#e5c07b' },
  stopped:   { color: '#5c6370', label: 'STOP',  bar: '#5c6370' },
  crashed:   { color: '#e06c75', label: 'FAIL',  bar: '#e06c75' },
  completed: { color: '#33afbc', label: 'DONE',  bar: '#33afbc' },
  killed:    { color: '#5c6370', label: 'KILL',  bar: '#5c6370' },
};

export default function AgentNode({ data }) {
  const s = STATUS[data.status] || STATUS.stopped;
  const ctx = Math.round((data.contextUsage || 0) * 100);
  const alive = data.status === 'running' || data.status === 'starting';
  const sel = data.selected;

  const scope = data.scope?.length > 0
    ? data.scope[0].replace(/\/\*\*$/, '') + (data.scope.length > 1 ? ` +${data.scope.length - 1}` : '')
    : '*';

  const tokens = data.tokensUsed > 0
    ? data.tokensUsed > 999 ? `${(data.tokensUsed / 1000).toFixed(1)}k` : `${data.tokensUsed}`
    : '0';

  return (
    <div style={{
      background: '#1e222a',
      border: 'none',
      borderTop: `2px solid ${sel ? '#33afbc' : s.color}`,
      width: 160,
      cursor: 'pointer',
      opacity: alive ? 1 : 0.45,
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      fontSize: 10,
      lineHeight: 1.4,
      overflow: 'hidden',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: s.color, width: 3, height: 3, border: 'none', minWidth: 3, minHeight: 3, top: -1 }} />

      {/* Header: status + name */}
      <div style={{
        padding: '4px 6px 3px',
        background: '#181c23',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{
          color: '#e6e6e6',
          fontWeight: 700,
          fontSize: 10,
          letterSpacing: 0.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {data.name}
        </span>
        <span style={{
          color: s.color,
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: 1,
          marginLeft: 4,
          flexShrink: 0,
        }}>
          {s.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '3px 6px 4px' }}>
        {/* Scope + provider */}
        <div style={{ color: '#5c6370', fontSize: 9, display: 'flex', justifyContent: 'space-between' }}>
          <span>{scope}</span>
          <span>{data.provider?.replace('claude-code', 'cc')}</span>
        </div>

        {/* Context bar */}
        <div style={{ marginTop: 3, height: 2, background: '#2c313a' }}>
          <div style={{
            height: '100%',
            width: `${Math.max(ctx, 2)}%`,
            background: ctx > 80 ? '#e06c75' : ctx > 60 ? '#e5c07b' : s.bar,
            transition: 'width 0.3s',
          }} />
        </div>

        {/* Metrics row */}
        <div style={{
          marginTop: 3, display: 'flex', justifyContent: 'space-between',
          color: '#4b5263', fontSize: 8, letterSpacing: 0.5,
        }}>
          <span>CTX {ctx}%</span>
          <span>TOK {tokens}</span>
        </div>

        {/* Heartbeat for live agents */}
        {alive && (
          <svg width="100%" height="6" viewBox="0 0 150 6" preserveAspectRatio="none" style={{ display: 'block', marginTop: 2 }}>
            <polyline
              points="0,3 20,3 24,3 26,1 28,5 30,2 32,4 34,3 55,3 59,3 61,1 63,5 65,2 67,4 69,3 90,3 94,3 96,1 98,5 100,2 102,4 104,3 125,3 129,3 131,1 133,5 135,2 137,4 139,3 150,3"
              fill="none"
              stroke={s.color}
              strokeWidth="0.7"
              opacity="0.5"
            >
              <animate attributeName="stroke-dashoffset" from="0" to="-55" dur="1.5s" repeatCount="indefinite" />
              <set attributeName="stroke-dasharray" to="150" />
            </polyline>
          </svg>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: s.color, width: 3, height: 3, border: 'none', minWidth: 3, minHeight: 3, bottom: -1 }} />
    </div>
  );
}
