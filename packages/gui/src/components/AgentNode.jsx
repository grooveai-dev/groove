// GROOVE GUI — Agent Node Component
// FSL-1.1-Apache-2.0 — see LICENSE

import React from 'react';
import { Handle, Position } from '@xyflow/react';

const STATUS = {
  running:   { color: '#4ae168', label: 'LIVE',  glow: 'rgba(74, 225, 104, 0.25)' },
  starting:  { color: '#e5c07b', label: 'INIT',  glow: 'rgba(229, 192, 123, 0.25)' },
  stopped:   { color: '#5c6370', label: 'STOP',  glow: 'none' },
  crashed:   { color: '#e06c75', label: 'FAIL',  glow: 'rgba(224, 108, 117, 0.2)' },
  completed: { color: '#33afbc', label: 'DONE',  glow: 'none' },
  killed:    { color: '#5c6370', label: 'KILL',  glow: 'none' },
};

export default function AgentNode({ data }) {
  const st = STATUS[data.status] || STATUS.stopped;
  const ctx = Math.round((data.contextUsage || 0) * 100);
  const alive = data.status === 'running' || data.status === 'starting';
  const sel = data.selected;

  const scope = data.scope?.length > 0
    ? data.scope[0].replace(/\/\*\*$/, '') + (data.scope.length > 1 ? ` +${data.scope.length - 1}` : '')
    : 'unrestricted';

  const tokens = data.tokensUsed > 0
    ? data.tokensUsed > 999 ? `${(data.tokensUsed / 1000).toFixed(1)}k` : `${data.tokensUsed}`
    : '0';

  const model = data.model
    ? data.model.replace('claude-', '').replace('-20251001', '').replace('-4-6', '').replace('-4-5', '')
    : 'default';

  return (
    <div style={{
      background: '#252a33',
      borderTop: `2px solid ${sel ? '#33afbc' : st.color}`,
      width: 180,
      cursor: 'pointer',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      fontSize: 10,
      lineHeight: 1.4,
      overflow: 'hidden',
      boxShadow: alive ? `0 0 12px ${st.glow}, 0 1px 3px rgba(0,0,0,0.3)` : '0 1px 3px rgba(0,0,0,0.2)',
      transition: 'box-shadow 0.3s, border-color 0.3s',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: st.color, width: 4, height: 4, border: 'none', minWidth: 4, minHeight: 4, top: -2 }} />

      {/* Header: name + status */}
      <div style={{
        padding: '6px 8px 5px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #2c313a',
      }}>
        <span style={{
          color: '#e6e6e6',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: 0.3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          flex: 1,
        }}>
          {data.name}
        </span>
        <span style={{
          color: st.color,
          fontSize: 7,
          fontWeight: 700,
          letterSpacing: 1.2,
          marginLeft: 6,
          flexShrink: 0,
          ...(alive ? { animation: 'pulse 2s infinite' } : {}),
        }}>
          {st.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '5px 8px 6px' }}>
        {/* Role + model */}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ color: '#8b929e', fontSize: 9 }}>{data.role}</span>
          <span style={{ color: '#5c6370', fontSize: 8 }}>{model}</span>
        </div>

        {/* Scope */}
        <div style={{ color: '#6b7280', fontSize: 8, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {scope}
        </div>

        {/* Context bar */}
        <div style={{ height: 3, background: '#1a1e25', borderRadius: 1 }}>
          <div style={{
            height: '100%',
            width: `${Math.max(ctx, 1)}%`,
            background: ctx > 80 ? '#e06c75' : ctx > 60 ? '#e5c07b' : '#33afbc',
            borderRadius: 1,
            transition: 'width 0.5s ease',
          }} />
        </div>

        {/* Metrics row */}
        <div style={{
          marginTop: 4, display: 'flex', justifyContent: 'space-between',
          color: '#8b929e', fontSize: 9,
        }}>
          <span>CTX <span style={{ color: '#abb2bf', fontWeight: 600 }}>{ctx}%</span></span>
          <span>TOK <span style={{ color: '#abb2bf', fontWeight: 600 }}>{tokens}</span></span>
        </div>

        {/* Activity pulse for live agents */}
        {alive && (
          <div style={{ marginTop: 4, height: 8, position: 'relative', overflow: 'hidden' }}>
            <svg width="100%" height="8" viewBox="0 0 180 8" preserveAspectRatio="none" style={{ display: 'block' }}>
              <defs>
                <linearGradient id={`pulse-${data.id}`} x1="0" x2="1" y1="0" y2="0">
                  <stop offset="0%" stopColor={st.color} stopOpacity="0" />
                  <stop offset="40%" stopColor={st.color} stopOpacity="0.6" />
                  <stop offset="50%" stopColor={st.color} stopOpacity="1" />
                  <stop offset="60%" stopColor={st.color} stopOpacity="0.6" />
                  <stop offset="100%" stopColor={st.color} stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* Baseline */}
              <line x1="0" y1="4" x2="180" y2="4" stroke="#2c313a" strokeWidth="0.5" />
              {/* Heartbeat line */}
              <polyline
                points="0,4 30,4 35,4 37,1 39,7 41,2 43,6 45,4 75,4 80,4 82,1 84,7 86,2 88,6 90,4 120,4 125,4 127,1 129,7 131,2 133,6 135,4 165,4 170,4 172,1 174,7 176,2 178,6 180,4"
                fill="none"
                stroke={st.color}
                strokeWidth="1"
                opacity="0.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <animate attributeName="stroke-dashoffset" from="0" to="-90" dur="2s" repeatCount="indefinite" />
                <set attributeName="stroke-dasharray" to="180" />
              </polyline>
              {/* Scanning glow */}
              <rect x="-30" y="0" width="30" height="8" fill={`url(#pulse-${data.id})`} opacity="0.3">
                <animate attributeName="x" from="-30" to="210" dur="2.5s" repeatCount="indefinite" />
              </rect>
            </svg>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: st.color, width: 4, height: 4, border: 'none', minWidth: 4, minHeight: 4, bottom: -2 }} />
    </div>
  );
}
