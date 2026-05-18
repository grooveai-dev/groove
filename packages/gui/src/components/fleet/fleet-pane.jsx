// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { AgentFeed } from '../agents/agent-feed';
import { fmtNum } from '../../lib/format';

const STATUS_VARIANT = {
  running: 'success',
  starting: 'warning',
  stopped: 'default',
  crashed: 'danger',
  completed: 'accent',
  killed: 'default',
  rotating: 'purple',
};

const STATUS_LABEL = {
  running: 'Running',
  starting: 'Starting',
  stopped: 'Stopped',
  crashed: 'Crashed',
  completed: 'Done',
  killed: 'Killed',
  rotating: 'Rotating',
};

export function FleetPane({ agentId, paneIndex }) {
  const agent = useGrooveStore((s) => s.agents.find((a) => a.id === agentId));
  const fleetSelectAgent = useGrooveStore((s) => s.fleetSelectAgent);
  const fleetMarkRead = useGrooveStore((s) => s.fleetMarkRead);

  useEffect(() => {
    if (agentId) fleetMarkRead(agentId);
  }, [agentId, fleetMarkRead]);

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center text-text-4">
        <p className="text-xs font-sans">Agent not found</p>
      </div>
    );
  }

  const ctxPct = Math.round((agent.contextUsage || 0) * 100);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="h-10 bg-surface-1 border-b border-border px-3 flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-medium text-text-0 font-sans truncate">{agent.name}</span>
        <Badge variant="default">{agent.role}</Badge>
        {agent.provider && (
          <span className="text-xs text-text-3 font-mono truncate">
            {agent.provider}{agent.model ? `:${agent.model}` : ''}
          </span>
        )}
        <Badge variant={STATUS_VARIANT[agent.status] || 'default'} dot={agent.status === 'running' ? 'pulse' : undefined}>
          {STATUS_LABEL[agent.status] || agent.status}
        </Badge>
        <div className="flex-1" />
        <span className="text-xs text-text-3 font-mono">{fmtNum(agent.tokensUsed)}</span>
        <span className={cn(
          'text-xs font-mono',
          ctxPct >= 75 ? 'text-danger' : ctxPct >= 50 ? 'text-warning' : 'text-text-3',
        )}>
          {ctxPct}%
        </span>
        <button
          onClick={() => fleetSelectAgent(null, paneIndex)}
          className="p-1 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-3 transition-colors cursor-pointer"
          title="Close pane"
        >
          <X size={14} />
        </button>
      </div>

      {/* Agent feed */}
      <div className="flex-1 min-h-0">
        <AgentFeed agent={agent} />
      </div>
    </div>
  );
}
