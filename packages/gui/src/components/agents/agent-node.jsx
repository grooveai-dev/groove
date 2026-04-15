// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useMemo, useRef, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Maximize2, X, User } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { statusColor } from '../../lib/status';
import { fmtNum, fmtDollar, fmtUptime } from '../../lib/format';

const EMPTY = [];
const ERROR_RE = /error|crash|fail/i;
const BAR_BG = 'rgba(51, 175, 188, 0.15)';
const BAR_H = 'h-[2px]';

function shortModel(id) {
  if (!id || id === 'auto') return 'auto';
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)(?:-\d+)?$/);
  if (claude) {
    const name = claude[1][0].toUpperCase() + claude[1].slice(1);
    return `${name} ${claude[2]}.${claude[3]}`;
  }
  if (id.startsWith('gemini-')) {
    return id.replace('gemini-', 'Gemini ').replace('-preview', '').replace('-flash-lite', ' Flash Lite').replace('-flash', ' Flash').replace('-pro', ' Pro');
  }
  if (id.startsWith('gpt-')) return id.toUpperCase().replace('GPT-', 'GPT-');
  return id;
}

function burnRate(timeline) {
  if (!timeline || timeline.length < 2) return null;
  const samples = timeline.slice(-10);
  const dt = (samples[samples.length - 1].t - samples[0].t) / 60000;
  if (dt <= 0) return null;
  const dv = samples[samples.length - 1].v - samples[0].v;
  return dv / dt;
}

function qualityColor(score) {
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-danger)';
}

function efficiencyColor(pct) {
  if (pct >= 60) return 'var(--color-success)';
  if (pct >= 30) return 'var(--color-warning)';
  return 'var(--color-danger)';
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
  const nodeRef = useRef(null);
  const expanded = useGrooveStore((s) => !!s.expandedNodes[agent.id]);
  const toggleExpanded = useGrooveStore((s) => s.toggleNodeExpanded);

  useEffect(() => {
    const rfNode = nodeRef.current?.closest('.react-flow__node');
    if (rfNode) rfNode.style.zIndex = expanded ? '1000' : '';
  }, [expanded]);

  const activityLog = useGrooveStore((s) => s.activityLog[agent.id]) || EMPTY;
  const tokenTimeline = useGrooveStore((s) => s.tokenTimeline[agent.id]) || EMPTY;
  const rate = burnRate(tokenTimeline);
  const errorCount = useMemo(() => activityLog.filter((e) => ERROR_RE.test(e.text)).length, [activityLog]);
  const ctxColor = contextPct > 75 ? 'var(--color-danger)' : contextPct > 50 ? 'var(--color-warning)' : 'var(--color-success)';

  const qScore = agent.qualityScore != null ? Math.round(agent.qualityScore) : null;
  const qColor = qScore != null ? qualityColor(qScore) : null;

  const effPct = agent.efficiency != null ? agent.efficiency : null;
  const effColor = effPct != null ? efficiencyColor(effPct) : null;

  const uptimeSec = agent.durationMs ? agent.durationMs / 1000
    : agent.spawnedAt ? (Date.now() - new Date(agent.spawnedAt).getTime()) / 1000
    : agent.createdAt ? (Date.now() - new Date(agent.createdAt).getTime()) / 1000
    : 0;

  return (
    <div ref={nodeRef}>
      <div
        className={`w-[220px] overflow-hidden rounded-[4px] transition-all duration-200 ease-out bg-[#1c1f26] hover:bg-[#141720] border border-solid ${selected ? 'border-[#2e323a]' : 'border-[#262a32]'} hover:border-[#2e3640]`}
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
            <button
              className="text-[#505862] hover:text-[#8b929e] cursor-pointer transition-colors flex-shrink-0"
              onClick={(e) => { e.stopPropagation(); toggleExpanded(agent.id); }}
            >
              {expanded ? <X size={10} /> : <Maximize2 size={10} />}
            </button>
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
          <div className={`mt-1.5 ${BAR_H} rounded-sm overflow-hidden`} style={{ background: BAR_BG }}>
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

        {/* ── Expanded stats (click-to-open) ─────────── */}
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="mx-3 border-t border-white/[0.04]" />

            {/* Context Health */}
            <div className="px-3 pt-1.5 pb-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[9px] font-mono text-[#505862] uppercase tracking-wider">Context</span>
                {(agent.rotations || 0) > 0 && (
                  <span className="text-[8px] font-mono text-[#606878] bg-white/[0.04] rounded px-1 py-px">{agent.rotations}x rot</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className={`flex-1 ${BAR_H} rounded-sm overflow-hidden`} style={{ background: BAR_BG }}>
                  <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${Math.max(contextPct, 1)}%`, background: ctxColor }} />
                </div>
                <span className="text-[9px] font-mono font-medium" style={{ color: ctxColor }}>{contextPct}%</span>
              </div>
            </div>

            {/* Quality */}
            <div className="px-3 pt-1 pb-1">
              <span className="text-[9px] font-mono text-[#505862] uppercase tracking-wider">Quality</span>
              <div className="flex items-center gap-2 mt-1">
                <div className={`flex-1 ${BAR_H} rounded-sm overflow-hidden`} style={{ background: BAR_BG }}>
                  <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${qScore != null ? Math.max(qScore, 1) : 0}%`, background: qColor || '#505862' }} />
                </div>
                <span className="text-[9px] font-mono font-medium" style={{ color: qColor || '#505862' }}>{qScore != null ? qScore : '—'}</span>
              </div>
            </div>

            {/* Efficiency (cache hit rate) */}
            <div className="px-3 pt-1 pb-1">
              <span className="text-[9px] font-mono text-[#505862] uppercase tracking-wider">Efficiency</span>
              <div className="flex items-center gap-2 mt-1">
                <div className={`flex-1 ${BAR_H} rounded-sm overflow-hidden`} style={{ background: BAR_BG }}>
                  <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${effPct != null ? Math.max(effPct, 1) : 0}%`, background: effColor || '#505862' }} />
                </div>
                <span className="text-[9px] font-mono font-medium" style={{ color: effColor || '#505862' }}>{effPct != null ? `${effPct}%` : '—'}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="px-3 pt-1 pb-1">
              <div className="grid grid-cols-3 gap-1">
                <div>
                  <div className="text-[9px] font-mono font-medium text-[#bcc2cd]">{fmtDollar(agent.costUsd || 0)}</div>
                  <div className="text-[7px] font-mono text-[#505862]">cost</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono font-medium text-[#bcc2cd]">{rate ? fmtNum(Math.round(rate)) : '—'}</div>
                  <div className="text-[7px] font-mono text-[#505862]">tok/m</div>
                </div>
                <div>
                  <div className="text-[9px] font-mono font-medium text-[#bcc2cd]">{agent.turns || 0}</div>
                  <div className="text-[7px] font-mono text-[#505862]">turns</div>
                </div>
              </div>
            </div>

            {/* Session */}
            <div className="px-3 pt-1 pb-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] font-mono text-[#8b929e]">{fmtUptime(Math.max(0, Math.floor(uptimeSec)))}</span>
                  <span className="text-[7px] font-mono text-[#505862]">up</span>
                </div>
                <div className="flex items-center gap-1">
                  {errorCount > 0 ? (
                    <span className="text-[9px] font-mono text-[var(--color-danger)]">{errorCount}</span>
                  ) : (
                    <span className="text-[9px] font-mono text-[#505862]">0</span>
                  )}
                  <span className="text-[7px] font-mono text-[#505862]">err</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

AgentNode.displayName = 'AgentNode';

// ── Avatar Node (circular) ──────────────────────────────
const AvatarNode = memo(({ data, selected }) => {
  const { agent } = data;
  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const sColor = statusColor(agent.status);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className={`relative w-[80px] h-[80px] rounded-full overflow-hidden transition-all duration-200 ease-out border-2 border-solid ${selected ? 'border-[#ff87b4]' : 'border-[#ff87b440]'} hover:border-[#ff87b4]`}
        style={{
          background: 'linear-gradient(135deg, #1c1f26 0%, #2a1a2e 100%)',
        }}
      >
        <Handle id="top" type="target" position={Position.Top} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="bottom" type="target" position={Position.Bottom} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="left" type="target" position={Position.Left} className="!w-1 !h-1 !bg-transparent !border-0" />
        <Handle id="right" type="target" position={Position.Right} className="!w-1 !h-1 !bg-transparent !border-0" />

        {isAlive && (
          <div className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: 'conic-gradient(from 0deg, transparent 0%, rgba(255,135,180,0.15) 25%, transparent 50%)',
                animation: 'avatar-spin 4s linear infinite',
              }}
            />
          </div>
        )}

        <div className="absolute inset-0 flex items-center justify-center">
          <User size={28} className="text-[#ff87b4]" />
        </div>

        {/* Status dot */}
        <div className="absolute bottom-1 right-1">
          <span className="block w-[8px] h-[8px] rounded-full border border-[#1c1f26]" style={{ background: sColor }} />
        </div>
      </div>

      <span className="text-[10px] font-semibold text-[#e6e6e6] font-sans text-center max-w-[100px] truncate">
        {agent.name}
      </span>
      <span
        className="text-[7px] font-mono font-bold uppercase tracking-wider px-1.5 py-px rounded-full"
        style={{ color: sColor, background: sColor + '12' }}
      >
        {STATUS_SHORT[agent.status] || agent.status}
      </span>
    </div>
  );
});

AvatarNode.displayName = 'AvatarNode';

export { AgentNode, AvatarNode };
