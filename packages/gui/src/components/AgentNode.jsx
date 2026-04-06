// GROOVE GUI — Agent Node Component
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
      borderTop: `1px solid ${sel ? '#33afbc' : st.color}`,
      width: 180,
      cursor: 'pointer',
      fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', Consolas, monospace",
      fontSize: 10,
      lineHeight: 1.4,
      overflow: 'hidden',
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
        <div style={{ height: 2, background: '#1a1e25', borderRadius: 1 }}>
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

        {/* Activity indicator for live agents — neural flow effect */}
        {alive && (
          <div style={{
            marginTop: 5,
            height: 2,
            background: '#1a1e25',
            borderRadius: 1,
            overflow: 'hidden',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '200%',
              height: '100%',
              background: `linear-gradient(90deg, transparent 0%, transparent 25%, ${st.color}44 35%, ${st.color} 50%, ${st.color}44 65%, transparent 75%, transparent 100%)`,
              animation: 'neuralFlow 2s linear infinite',
              borderRadius: 1,
            }} />
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: st.color, width: 4, height: 4, border: 'none', minWidth: 4, minHeight: 4, bottom: -2 }} />
    </div>
  );
}
