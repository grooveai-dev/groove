// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { StatusDot } from '../ui/status-dot';
import { cronToHuman } from '../../lib/cron';
import { timeAgo, fmtDollar, fmtUptime } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  Play, Pause, Clock, MoreHorizontal, Copy, Pencil, Trash2,
  FileText, Folder, ExternalLink,
} from 'lucide-react';

export function AutomationCard({ automation }) {
  const toggleAutomation = useGrooveStore((s) => s.toggleAutomation);
  const deleteAutomation = useGrooveStore((s) => s.deleteAutomation);
  const duplicateAutomation = useGrooveStore((s) => s.duplicateAutomation);
  const runAutomation = useGrooveStore((s) => s.runAutomation);
  const setEditingAutomation = useGrooveStore((s) => s.setEditingAutomation);
  const openWizard = useGrooveStore((s) => s.openAutomationWizard);
  const openDetail = useGrooveStore((s) => s.openDetail);
  const agents = useGrooveStore((s) => s.agents);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  const a = automation;
  const roles = a.teamConfig || (a.agentConfig ? [a.agentConfig] : (a.role ? [{ role: a.role }] : []));
  const instructions = a.instructionSource?.type === 'inline'
    ? a.instructionSource.content
    : a.instructionSource?.type === 'file'
      ? null
      : a.prompt || null;
  const filePath = a.instructionSource?.type === 'file' ? a.instructionSource.filePath : null;
  const gatewayIds = a.outputConfig?.gatewayIds || [];
  const lastStatus = a.lastRunStatus || (a.lastRunAt ? 'completed' : null);

  const activeAgents = (a.activeAgentIds || [])
    .map((id) => agents.find((ag) => ag.id === id))
    .filter(Boolean);

  const lastRunAgentIds = a.lastRun?.agentId
    ? a.lastRun.agentId.split(',').filter(Boolean)
    : [];
  const lastRunAgents = !a.isRunning
    ? lastRunAgentIds.map((id) => agents.find((ag) => ag.id === id)).filter(Boolean)
    : [];

  function openAgentPanel(agentId) {
    openDetail({ type: 'agent', agentId });
  }

  return (
    <div className={cn(
      'rounded-md border bg-surface-1 overflow-hidden transition-colors',
      a.enabled ? 'border-border-subtle' : 'border-border-subtle/50 opacity-75',
    )}>
      {/* Top row */}
      <div className="px-4 py-3 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text-0 font-sans truncate">{a.name}</span>
            <Badge variant={a.enabled ? 'success' : 'default'} className="text-2xs flex-shrink-0">
              {a.enabled ? 'Active' : 'Paused'}
            </Badge>
          </div>
          {a.description && (
            <p className="text-2xs text-text-3 font-sans truncate mt-0.5">{a.description}</p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => toggleAutomation(a.id, a.enabled)}
            className={cn(
              'p-1.5 rounded transition-colors cursor-pointer',
              a.enabled ? 'text-success hover:text-success/80' : 'text-text-4 hover:text-text-2',
            )}
            title={a.enabled ? 'Pause automation' : 'Enable automation'}
          >
            {a.enabled ? <Pause size={13} /> : <Play size={13} />}
          </button>

          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-1.5 rounded text-text-4 hover:text-text-2 transition-colors cursor-pointer"
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[150px] bg-surface-2 border border-border rounded-md shadow-lg py-1">
                <button
                  onClick={() => { setEditingAutomation(a.id); openWizard(); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-5 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Pencil size={10} /> Edit
                </button>
                <button
                  onClick={() => { duplicateAutomation(a.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-5 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Copy size={10} /> Duplicate
                </button>
                <button
                  onClick={() => { runAutomation(a.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-text-1 hover:bg-surface-5 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Play size={10} /> Run Now
                </button>
                <div className="h-px my-1 bg-border-subtle" />
                <button
                  onClick={() => { deleteAutomation(a.id); setMenuOpen(false); }}
                  className="w-full text-left px-3 py-1.5 text-xs font-sans text-danger hover:bg-danger/5 transition-colors cursor-pointer flex items-center gap-2"
                >
                  <Trash2 size={10} /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Team strip */}
      {roles.length > 0 && (
        <div className="px-4 pb-2 flex items-center gap-1.5 flex-wrap">
          {roles.map((r, i) => (
            <Badge key={i} variant="default" className="text-2xs">
              {r.role}{r.phase ? ` P${r.phase}` : ''}
            </Badge>
          ))}
          {a.integrationIds?.length > 0 && (
            <span className="text-2xs text-text-4 font-sans ml-1">+{a.integrationIds.length} integrations</span>
          )}
        </div>
      )}

      {/* Instructions preview */}
      {(instructions || filePath) && (
        <div className="px-4 pb-2">
          {filePath ? (
            <div className="flex items-center gap-1.5">
              <Folder size={10} className="text-text-4 flex-shrink-0" />
              <span className="text-2xs font-mono text-text-3 truncate">{filePath}</span>
            </div>
          ) : (
            <p className="text-2xs text-text-3 font-sans truncate">
              <FileText size={10} className="inline mr-1 text-text-4" />
              {instructions.slice(0, 100)}{instructions.length > 100 ? '...' : ''}
            </p>
          )}
        </div>
      )}

      {/* Schedule + last run row */}
      <div className="px-4 py-2 border-t border-border-subtle bg-surface-0 flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Clock size={10} className="text-text-4" />
          <span className="text-2xs font-mono text-text-2">{cronToHuman(a.cron)}</span>
        </div>
        {a.nextRunAt && (
          <span className="text-2xs font-mono text-text-3">
            Next: {timeAgo(a.nextRunAt)}
          </span>
        )}
        {a.lastRunAt && (
          <div className="flex items-center gap-1.5">
            <span className="text-2xs font-mono text-text-3">Last: {timeAgo(a.lastRunAt)}</span>
            <StatusDot
              status={lastStatus === 'error' ? 'crashed' : lastStatus === 'running' ? 'running' : 'completed'}
              size="sm"
            />
          </div>
        )}
        {!a.lastRunAt && (
          <span className="text-2xs text-text-4 font-sans">Never run</span>
        )}
      </div>

      {/* Output config */}
      {(gatewayIds.length > 0 || a.outputConfig?.filePath || a.outputConfig?.customInstructions) && (
        <div className="px-4 py-1.5 border-t border-border-subtle bg-surface-0 space-y-1">
          {gatewayIds.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-text-4 font-sans">Gateways:</span>
              <span className="text-2xs font-sans text-text-3">{gatewayIds.join(', ')}</span>
            </div>
          )}
          {a.outputConfig?.filePath && (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-text-4 font-sans">File:</span>
              <span className="text-2xs font-mono text-text-3 truncate">{a.outputConfig.filePath}</span>
            </div>
          )}
          {a.outputConfig?.customInstructions && (
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-text-4 font-sans">Custom:</span>
              <span className="text-2xs font-sans text-text-3 truncate">{a.outputConfig.customInstructions.slice(0, 80)}{a.outputConfig.customInstructions.length > 80 ? '...' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Active agents */}
      {activeAgents.length > 0 && (
        <div className="px-4 py-2 border-t border-border-subtle bg-surface-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <StatusDot status="running" size="sm" />
            <span className="text-2xs font-sans text-text-2 font-medium">Running</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeAgents.map((ag) => (
              <button
                key={ag.id}
                onClick={() => openAgentPanel(ag.id)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-4 hover:bg-surface-5 transition-colors cursor-pointer group"
              >
                <StatusDot status={ag.status} size="sm" />
                <span className="text-2xs font-sans text-text-1 group-hover:text-text-0">{ag.name || ag.role}</span>
                <ExternalLink size={9} className="text-text-4 group-hover:text-accent" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Last run agents (when not currently running) */}
      {!a.isRunning && lastRunAgents.length > 0 && (
        <div className="px-4 py-2 border-t border-border-subtle bg-surface-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-2xs font-sans text-text-3">Last run agents</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {lastRunAgents.map((ag) => (
              <button
                key={ag.id}
                onClick={() => openAgentPanel(ag.id)}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-4 hover:bg-surface-5 transition-colors cursor-pointer group"
              >
                <StatusDot status={ag.status} size="sm" />
                <span className="text-2xs font-sans text-text-2 group-hover:text-text-0">{ag.name || ag.role}</span>
                <ExternalLink size={9} className="text-text-4 group-hover:text-accent" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div className="px-4 py-2 border-t border-border-subtle flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => runAutomation(a.id)} className="h-6 px-2 text-2xs gap-1">
          <Play size={10} /> Run Now
        </Button>
        <div className="flex-1" />
        {a.lastRunDuration != null && (
          <span className="text-2xs font-mono text-text-4">{fmtUptime(a.lastRunDuration / 1000)}</span>
        )}
        {a.lastRunCost != null && a.lastRunCost > 0 && (
          <span className="text-2xs font-mono text-text-4">{fmtDollar(a.lastRunCost)}</span>
        )}
      </div>
    </div>
  );
}
