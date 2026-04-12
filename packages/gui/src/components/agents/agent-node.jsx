// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { statusColor } from '../../lib/status';
import { fmtNum } from '../../lib/format';

const EMPTY = [];

// ── Clean up model ID → short display name ───────────────
// "claude-haiku-4-5-20251001" → "Haiku 4.5"
// "claude-opus-4-6" → "Opus 4.6"
// "gemini-3.1-pro-preview" → "Gemini 3.1 Pro"
// "o4-mini" → "o4-mini"
function shortModel(id) {
  if (!id || id === 'auto') return 'auto';
  // Claude models: strip "claude-" prefix and date suffix, capitalize
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d+)?$/);
  if (claude) {
    const name = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${name} ${claude[2]}.${claude[3]}`;
  }
  // Gemini: strip "-preview"
  if (id.startsWith('gemini-')) {
    return id.replace('gemini-', 'Gemini ').replace('-preview', '').replace('-flash-lite', ' Flash Lite').replace('-flash', ' Flash').replace('-pro', ' Pro');
  }
  // GPT: capitalize
  if (id.startsWith('gpt-')) return id.toUpperCase().replace('GPT-', 'GPT-');
  return id;
}

// ── Activity label ───────────────────────────────────────
function activityLabel(text) {
  if (!text) return null;
  const t = text.toLowerCase();
  if (t.includes('read'))    return 'READ';
  if (t.includes('edit') || t.includes('writ')) return 'WRITE';
  if (t.includes('search') || t.includes('grep') || t.includes('glob')) return 'SEARCH';
  if (t.includes('bash') || t.includes('exec') || t.includes('running')) return 'EXEC';
  if (t.includes('test'))    return 'TEST';
  if (t.includes('error') || t.includes('fail')) return 'ERR';
  if (t.includes('complet') || t.includes('done')) return 'DONE';
  return 'WORK';
}

function timeShort(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

// ── Slide-out panel (appears to the right) ───────────────
function NodePanel({ agent }) {
  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const recent = activityLog.slice(-8);

  return (
    <div
      className="absolute left-full top-0 ml-2 z-50 pointer-events-none"
      style={{ width: 220, animation: 'tooltip-slide-in 0.15s ease-out' }}
    >
      <div
        className="overflow-hidden"
        style={{ background: '#181b21', border: '1px solid #262a32', borderRadius: 4 }}
      >
        {/* Prompt */}
        {agent.prompt && (
          <div className="px-2.5 py-2 border-b border-[#262a32]">
            <p className="text-[9px] font-sans text-[#8b929e] line-clamp-3 leading-snug">{agent.prompt}</p>
          </div>
        )}

        {/* Activity log */}
        {recent.length > 0 ? (
          <div>
            <div className="px-2.5 pt-1.5 pb-1">
              <span className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest">Activity</span>
            </div>
            {recent.map((entry, i) => {
              const label = activityLabel(entry.text);
              const display = entry.text?.length > 45 ? entry.text.slice(0, 45) + '...' : entry.text;
              return (
                <div key={i} className="px-2.5 py-[3px] flex items-start gap-1.5">
                  <span className="text-[8px] font-mono text-[#333842] w-5 flex-shrink-0 text-right">{timeShort(entry.timestamp)}</span>
                  {label && (
                    <span className={cn(
                      'text-[7px] font-mono w-7 flex-shrink-0 text-center rounded-sm px-0.5 py-px',
                      label === 'ERR' ? 'text-[#e06c75] bg-[#e06c75]/10' : 'text-[#505862] bg-[#505862]/10',
                    )}>{label}</span>
                  )}
                  <span className="text-[9px] font-sans text-[#6e7681] truncate flex-1">{display}</span>
                </div>
              );
            })}
            <div className="h-1.5" />
          </div>
        ) : (
          <div className="px-2.5 py-3">
            <span className="text-[9px] font-mono text-[#333842]">Awaiting activity...</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Status labels ────────────────────────────────────────
const STATUS_SHORT = {
  running: 'LIVE', starting: 'INIT', stopped: 'IDLE',
  crashed: 'ERR', completed: 'DONE', killed: 'KILL', rotating: 'ROT',
};

// ── Main Node ────────────────────────────────────────────
const AgentNode = memo(({ data, selected }) => {
  const { agent } = data;
  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const sColor = statusColor(agent.status);
  const tokens = agent.tokensUsed || 0;
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        className="w-[220px] overflow-hidden transition-all duration-150"
        style={{
          background: '#1c1f26',
          border: `1px solid ${selected ? '#2e323a' : '#262a32'}`,
          borderRadius: 4,
        }}
      >
        {/* Handles */}
        <Handle id="top" type="target" position={Position.Top} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="bottom" type="target" position={Position.Bottom} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="left" type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="right" type="target" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />

        {/* Scan line — running only */}
        {isAlive && (
          <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ borderRadius: 3 }}>
            <div
              className="absolute left-0 right-0 h-px"
              style={{
                background: 'linear-gradient(90deg, transparent 0%, rgba(97,175,239,0.25) 50%, transparent 100%)',
                animation: 'node-scan 3s ease-in-out infinite',
              }}
            />
          </div>
        )}

        {/* ── Header ──────────────────────────────────── */}
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-center gap-2">
            <span className="relative flex-shrink-0 w-[6px] h-[6px]">
              <span className="absolute inset-0 rounded-sm" style={{ background: sColor }} />
              {isAlive && (
                <span
                  className="absolute inset-[-2px] rounded-sm"
                  style={{ background: sColor, opacity: 0.15, animation: 'node-pulse-bar 2s ease-in-out infinite' }}
                />
              )}
            </span>
            <span className="text-[12px] font-semibold text-[#e6e6e6] font-sans truncate flex-1 leading-none">
              {agent.name}
            </span>
            <span
              className="text-[7px] font-mono font-bold uppercase tracking-wider px-1 py-px rounded-sm"
              style={{ color: sColor, background: sColor + '12' }}
            >
              {STATUS_SHORT[agent.status] || agent.status}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="text-[9px] font-mono text-[#505862] uppercase tracking-[0.05em]">{agent.role}</span>
            <span className="text-[9px] text-[#2a2e36]">/</span>
            <span className="text-[9px] font-mono text-[#505862]">{shortModel(agent.model)}</span>
          </div>
        </div>

        {/* ── Footer ──────────────────────────────────── */}
        <div className="px-3 pt-1 pb-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-mono font-medium text-[#bcc2cd] leading-none">{fmtNum(tokens)}</span>
            <span className="text-[8px] font-mono text-[#505862]">tok</span>
            <span className="flex-1" />
            <span className="text-[9px] font-mono text-[#505862]">{contextPct}%</span>
          </div>

          {/* Context bar */}
          <div className="mt-1.5 h-[2px] rounded-sm overflow-hidden" style={{ background: 'rgba(51, 175, 188, 0.15)' }}>
            <div
              className="h-full rounded-sm transition-all duration-700"
              style={{
                width: `${Math.max(contextPct, 1)}%`,
                background: contextPct > 80 ? 'var(--color-danger)'
                  : contextPct > 60 ? 'var(--color-warning)'
                  : 'var(--color-accent)',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Hover panel — slides out right ────────────── */}
      {hovered && <NodePanel agent={agent} />}
    </div>
  );
});

AgentNode.displayName = 'AgentNode';
export { AgentNode };
