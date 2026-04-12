// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { fmtNum, fmtDollar } from '../../lib/format';
import { cn } from '../../lib/cn';
import { statusColor, roleColor } from '../../lib/status';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { ScrollArea } from '../ui/scroll-area';

const COST_SOURCE_LABEL = { actual: 'ACT', estimated: 'EST', local: 'LOC' };

function shortModel(id) {
  if (!id || id === 'auto' || id === 'default') return 'default';
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  if (id.startsWith('gemini-')) return id.replace('gemini-', 'Gem ').replace('-preview', '');
  return id.length > 12 ? id.slice(0, 12) + '...' : id;
}

const AgentRow = memo(function AgentRow({ agent, isRotating }) {
  const isAlive = agent.status === 'running' || agent.status === 'starting';
  const contextPct = Math.round((agent.contextUsage || 0) * 100);
  const sColor = isRotating ? '#c678dd' : statusColor(agent.status);
  const quality = agent.quality;
  const successRate = quality?.toolSuccessRate != null ? Math.round(quality.toolSuccessRate * 100) : null;
  const thresholdPct = agent.rotationThreshold ? Math.round(agent.rotationThreshold * 100) : null;
  const rc = roleColor(agent.role);
  const barColor = contextPct > 80 ? HEX.danger : contextPct > 60 ? HEX.warning : isAlive ? HEX.accent : HEX.surface5;

  return (
    <div className="px-3 pl-6 py-2 hover:bg-[rgba(51,175,188,0.06)] transition-colors space-y-1.5">
      {/* Top row */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Status dot */}
        <span className="relative flex-shrink-0 w-[6px] h-[6px]">
          <span className="absolute inset-0 rounded-sm" style={{ background: sColor }} />
          {isAlive && (
            <span
              className="absolute inset-[-2px] rounded-sm"
              style={{ background: sColor, opacity: 0.15, animation: 'node-pulse-bar 2s ease-in-out infinite' }}
            />
          )}
        </span>

        {/* Name */}
        <div className="text-xs font-semibold text-text-0 font-sans truncate leading-none flex-shrink-0 max-w-[80px]">
          {agent.name}
        </div>

        {/* Role pill */}
        <span
          className="text-2xs font-mono font-semibold px-1.5 py-px rounded-sm flex-shrink-0 capitalize"
          style={{ background: rc.bg, color: rc.text }}
        >
          {(agent.role || '').toLowerCase()}
        </span>

        {/* Model badge */}
        <span className="text-2xs font-mono text-text-4 bg-surface-4 px-1 py-px rounded-sm flex-shrink-0 truncate max-w-[72px]">
          {shortModel(agent.model)}
        </span>

        <div className="flex-1" />

        {/* Quality badge */}
        {successRate != null && (
          <span
            className="text-2xs font-mono font-bold px-1 py-px rounded-sm flex-shrink-0"
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
          <span className="text-2xs font-mono text-text-4 uppercase tracking-wider flex-shrink-0">
            {COST_SOURCE_LABEL[agent.costSource] || ''}
          </span>
        )}

        {/* Tokens + cost */}
        <div className="text-right flex-shrink-0">
          <div className="text-xs font-mono text-text-1 tabular-nums leading-none">{fmtNum(agent.tokens || 0)}</div>
          {(agent.costUsd || 0) > 0 && (
            <div className="text-2xs font-mono text-text-3 mt-0.5">{fmtDollar(agent.costUsd)}</div>
          )}
        </div>
      </div>

      {/* Context bar */}
      <div className="flex items-center gap-2">
        <div
          className="relative flex-1 h-[4px] rounded-full overflow-visible"
          style={{ background: hexAlpha(HEX.accent, 0.12) }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${Math.max(contextPct, 1)}%`, background: barColor }}
          />
          {thresholdPct && (
            <div
              className="absolute top-[-2px] w-px h-[8px]"
              style={{ left: `${thresholdPct}%`, background: HEX.purple }}
              title={`Rotation at ${thresholdPct}%`}
            />
          )}
        </div>
        <span className="text-2xs font-mono text-text-2 tabular-nums flex-shrink-0 w-7 text-right">{contextPct}%</span>
      </div>
    </div>
  );
});

function TeamSection({ team, members, rotatingSet }) {
  const [expanded, setExpanded] = useState(true);
  const runningCount = members.filter((a) => a.status === 'running' || a.status === 'starting').length;
  const isActive = runningCount > 0;
  const totalTokens = members.reduce((sum, a) => sum + (a.tokens || 0), 0);
  const totalCost = members.reduce((sum, a) => sum + (a.costUsd || 0), 0);

  return (
    <div>
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[rgba(51,175,188,0.08)] bg-[rgba(51,175,188,0.05)]"
        style={{ borderLeft: isActive ? `2px solid ${HEX.accent}` : '2px solid transparent' }}
      >
        {expanded
          ? <ChevronDown size={10} className="text-text-4 flex-shrink-0" />
          : <ChevronRight size={10} className="text-text-4 flex-shrink-0" />
        }
        <span className="text-2xs font-mono font-semibold text-text-2 uppercase tracking-widest flex-1 truncate">
          {team === 'ungrouped' ? 'Ungrouped' : team}
        </span>
        <span className="text-2xs font-mono text-text-3 tabular-nums">{fmtNum(totalTokens)}</span>
        {totalCost > 0 && (
          <span className="text-2xs font-mono text-text-4 tabular-nums ml-1">{fmtDollar(totalCost)}</span>
        )}
        <span
          className="text-2xs font-mono tabular-nums flex-shrink-0 ml-1.5"
          style={{ color: isActive ? HEX.accent : undefined }}
        >
          {runningCount}/{members.length}
        </span>
      </button>
      {expanded && members.map((a) => (
        <AgentRow key={a.id} agent={a} isRotating={rotatingSet.has(a.id)} />
      ))}
    </div>
  );
}

const FleetPanel = memo(function FleetPanel({ agentBreakdown, rotating = [] }) {
  if (!agentBreakdown?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-3 font-mono p-4">
        No agents
      </div>
    );
  }

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
          <TeamSection key={team} team={team} members={members} rotatingSet={rotatingSet} />
        ))}
      </div>
    </ScrollArea>
  );
});

export { FleetPanel };
