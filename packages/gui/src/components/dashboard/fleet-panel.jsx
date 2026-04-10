// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { fmtNum, fmtDollar } from '../../lib/format';
import { cn } from '../../lib/cn';
import { statusColor } from '../../lib/status';
import { ScrollArea } from '../ui/scroll-area';

const COST_SOURCE_LABEL = { actual: 'ACT', estimated: 'EST', local: 'LOC' };

const AgentRow = memo(function AgentRow({ agent, isRotating }) {
  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const sColor = isRotating ? '#c678dd' : statusColor(agent.status);
  const quality = agent.quality;
  const successRate = quality?.toolSuccessRate != null ? Math.round(quality.toolSuccessRate * 100) : null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#24282f] transition-colors">
      {/* Status square */}
      <span className="relative flex-shrink-0 w-[6px] h-[6px]">
        <span className="absolute inset-0 rounded-sm" style={{ background: sColor }} />
        {isAlive && (
          <span
            className="absolute inset-[-2px] rounded-sm"
            style={{ background: sColor, opacity: 0.15, animation: 'node-pulse-bar 2s ease-in-out infinite' }}
          />
        )}
      </span>

      {/* Name + role/model */}
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-[#e6e6e6] font-sans truncate leading-none">{agent.name}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[8px] font-mono text-[#505862] uppercase tracking-wider">{agent.role}</span>
          <span className="text-[8px] text-[#2a2e36]">/</span>
          <span className="text-[8px] font-mono text-[#3a3f4b]">{shortModel(agent.model)}</span>
        </div>
      </div>

      {/* Tokens + cost */}
      <div className="text-right flex-shrink-0">
        <div className="text-[11px] font-mono text-[#bcc2cd] tabular-nums leading-none">{fmtNum(agent.tokens || 0)}</div>
        {(agent.costUsd || 0) > 0 && (
          <div className="text-[8px] font-mono text-[#3a3f4b] mt-0.5">{fmtDollar(agent.costUsd)}</div>
        )}
      </div>

      {/* Quality / tool success */}
      {successRate != null && (
        <span
          className="text-[7px] font-mono font-bold uppercase px-1 py-px rounded-sm flex-shrink-0"
          style={{
            color: successRate >= 90 ? '#4ae168' : successRate >= 70 ? '#e5c07b' : '#e06c75',
            background: successRate >= 90 ? 'rgba(74,225,104,0.1)' : successRate >= 70 ? 'rgba(229,192,123,0.1)' : 'rgba(224,108,117,0.1)',
          }}
        >
          {successRate}%
        </span>
      )}

      {/* Cost source badge */}
      {agent.costSource && agent.costSource !== 'actual' && (
        <span className="text-[7px] font-mono text-[#3a3f4b] uppercase tracking-wider flex-shrink-0">
          {COST_SOURCE_LABEL[agent.costSource] || ''}
        </span>
      )}

      {/* Context bar */}
      <div className="w-12 flex-shrink-0">
        <div className="flex items-center justify-end gap-1 mb-0.5">
          <span className="text-[8px] font-mono text-[#505862] tabular-nums">{contextPct}%</span>
        </div>
        <div className="h-[2px] bg-[#1a1e25] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${Math.max(contextPct, 1)}%`,
              background: contextPct > 80 ? '#e06c75' : contextPct > 60 ? '#e5c07b' : isAlive ? '#61afef' : '#333842',
            }}
          />
        </div>
      </div>
    </div>
  );
});

function shortModel(id) {
  if (!id || id === 'auto' || id === 'default') return 'default';
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  if (id.startsWith('gemini-')) return id.replace('gemini-', 'Gem ').replace('-preview', '');
  return id.length > 12 ? id.slice(0, 12) + '...' : id;
}

const FleetPanel = memo(function FleetPanel({ agentBreakdown, rotating = [] }) {
  if (!agentBreakdown?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[9px] text-[#3a3f4b] font-mono p-4">
        No agents
      </div>
    );
  }

  // Group by team
  const teams = {};
  for (const a of agentBreakdown) {
    const team = a.teamId || 'ungrouped';
    if (!teams[team]) teams[team] = [];
    teams[team].push(a);
  }

  const rotatingSet = new Set(rotating);

  return (
    <ScrollArea className="flex-1">
      <div className="py-1">
        {Object.entries(teams).map(([team, members]) => (
          <div key={team}>
            <div className="px-3 pt-2 pb-1">
              <span className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest">{team}</span>
            </div>
            {members.map((a) => (
              <AgentRow key={a.id} agent={a} isRotating={rotatingSet.has(a.id)} />
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
});

export { FleetPanel };
