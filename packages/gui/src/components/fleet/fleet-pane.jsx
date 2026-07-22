// FSL-1.1-Apache-2.0 — see LICENSE
import { useEffect, useRef, useState } from 'react';
import { X, PanelRight, MessageSquare } from 'lucide-react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { AgentFeed } from '../agents/agent-feed';
import { InnerChatRelay } from '../agents/innerchat-relay';
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

export function FleetPane({ agentId, paneIndex, readOnly = false }) {
  const effectiveId = agentId || null;
  const lastIdRef = useRef(effectiveId);
  if (effectiveId) lastIdRef.current = effectiveId;
  const resolvedId = effectiveId || lastIdRef.current;

  const liveAgent = useGrooveStore((s) => resolvedId ? s.agents.find((a) => a.id === resolvedId) : null);
  const fleetSelectAgent = useGrooveStore((s) => s.fleetSelectAgent);
  const fleetMarkRead = useGrooveStore((s) => s.fleetMarkRead);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const detailPanel = useGrooveStore((s) => s.detailPanel);
  const isPanelOpen = detailPanel?.type === 'agent' && detailPanel?.agentId === resolvedId;
  const [relayOpen, setRelayOpen] = useState(false);

  const lastAgentRef = useRef(liveAgent);
  const [gone, setGone] = useState(false);
  const goneTimer = useRef(null);

  if (liveAgent) {
    lastAgentRef.current = liveAgent;
    if (gone) setGone(false);
    if (goneTimer.current) { clearTimeout(goneTimer.current); goneTimer.current = null; }
  }

  useEffect(() => {
    if (!liveAgent && resolvedId && !gone) {
      goneTimer.current = setTimeout(() => setGone(true), 3000);
      return () => { if (goneTimer.current) clearTimeout(goneTimer.current); };
    }
  }, [liveAgent, resolvedId, gone]);

  useEffect(() => {
    if (effectiveId) fleetMarkRead(effectiveId);
  }, [effectiveId, fleetMarkRead]);

  const agent = liveAgent || lastAgentRef.current;

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center text-text-4">
        <p className="text-xs font-sans">Select an agent</p>
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
          onClick={() => setRelayOpen((v) => !v)}
          className={cn(
            'p-1 rounded-md transition-colors cursor-pointer',
            relayOpen ? 'text-warning' : 'text-text-3 hover:text-warning hover:bg-surface-3',
          )}
          title="Relay a message to another agent"
        >
          <MessageSquare size={14} />
        </button>
        <button
          onClick={() => openDetail({ type: 'agent', agentId: resolvedId })}
          className={cn(
            'p-1 rounded-md transition-colors cursor-pointer',
            isPanelOpen ? 'text-accent' : 'text-text-3 hover:text-text-0 hover:bg-surface-3',
          )}
          title="Open agent panel"
        >
          <PanelRight size={14} />
        </button>
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
        <AgentFeed agent={agent} readOnly={readOnly} />
      </div>

      {relayOpen && <InnerChatRelay fromAgent={agent} onClose={() => setRelayOpen(false)} />}
    </div>
  );
}
