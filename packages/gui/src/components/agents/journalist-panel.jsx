// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { Skeleton } from '../ui/skeleton';
import { Collapsible } from '../ui/collapsible';
import {
  Newspaper, RefreshCw, Map, FileText, Clock, Activity,
} from 'lucide-react';
import { timeAgo } from '../../lib/format';

export function JournalistPanel() {
  const journalistStatus = useGrooveStore((s) => s.journalistStatus);
  const fetchJournalist = useGrooveStore((s) => s.fetchJournalist);
  const triggerCycle = useGrooveStore((s) => s.triggerJournalistCycle);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    fetchJournalist().then(() => setLoading(false));
    const interval = setInterval(fetchJournalist, 10000);
    return () => clearInterval(interval);
  }, [fetchJournalist]);

  async function handleTrigger() {
    setTriggering(true);
    try { await triggerCycle(); } catch { /* toast handles */ }
    setTriggering(false);
  }

  if (loading) {
    return (
      <div className="p-5 space-y-4">
        <Skeleton className="h-6 w-32 rounded" />
        <Skeleton className="h-20 rounded-md" />
        <Skeleton className="h-20 rounded-md" />
      </div>
    );
  }

  const status = journalistStatus || {};
  const synthesis = status.lastSynthesis;
  const history = status.history || [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border-subtle flex items-center gap-2">
        <Newspaper size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-text-0 font-sans flex-1">Journalist</h3>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleTrigger}
          disabled={triggering}
          className="gap-1.5 text-2xs"
        >
          <RefreshCw size={11} className={triggering ? 'animate-spin' : ''} />
          {triggering ? 'Running...' : 'Run Synthesis'}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-5 py-4 space-y-5">
          {/* Status bar */}
          <div className="flex items-center gap-3 text-2xs text-text-3 font-sans">
            <div className="flex items-center gap-1">
              <Activity size={10} />
              <span>{status.cycleCount || 0} cycles</span>
            </div>
            {status.lastCycleTime && (
              <div className="flex items-center gap-1">
                <Clock size={10} />
                <span>Last: {timeAgo(status.lastCycleTime)}</span>
              </div>
            )}
            <Badge variant={status.cycleCount > 0 ? 'success' : 'default'} className="text-2xs">
              {status.cycleCount > 0 ? 'Active' : 'Idle'}
            </Badge>
          </div>

          {/* Last synthesis summary */}
          {synthesis?.summary && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-1 font-sans flex items-center gap-1.5">
                <FileText size={12} className="text-text-3" />
                Latest Summary
              </label>
              <div className="bg-surface-0 rounded-lg border border-border-subtle px-3.5 py-3 text-xs text-text-2 font-sans leading-relaxed">
                {synthesis.summary}
              </div>
            </div>
          )}

          {/* Project Map */}
          {synthesis?.projectMap && (
            <Collapsible title="Project Map" icon={Map}>
              <div className="bg-surface-0 rounded-lg border border-border-subtle px-3.5 py-3 text-xs text-text-2 font-mono leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                {synthesis.projectMap}
              </div>
            </Collapsible>
          )}

          {/* Decisions */}
          {synthesis?.decisions && (
            <Collapsible title="Decisions Log" icon={FileText}>
              <div className="bg-surface-0 rounded-lg border border-border-subtle px-3.5 py-3 text-xs text-text-2 font-mono leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                {synthesis.decisions}
              </div>
            </Collapsible>
          )}

          {/* Synthesis History */}
          {history.length > 0 && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-1 font-sans flex items-center gap-1.5">
                <Clock size={12} className="text-text-3" />
                History ({history.length})
              </label>
              <div className="space-y-1.5">
                {history.slice().reverse().slice(0, 20).map((entry, i) => (
                  <div key={i} className="bg-surface-0 rounded-md border border-border-subtle px-3 py-2">
                    <div className="flex items-center gap-2 text-2xs">
                      <Badge variant="default" className="text-2xs">Cycle {entry.cycle}</Badge>
                      <span className="text-text-4 font-sans">{entry.agentCount} agent{entry.agentCount !== 1 ? 's' : ''}</span>
                      <span className="text-text-4 font-sans ml-auto">{timeAgo(entry.timestamp)}</span>
                    </div>
                    {entry.summary && (
                      <p className="text-xs text-text-2 font-sans mt-1 leading-relaxed">{entry.summary}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!synthesis && history.length === 0 && (
            <div className="text-center py-8 text-text-4 font-sans">
              <Newspaper size={28} className="mx-auto mb-2" />
              <p className="text-sm">No synthesis data yet</p>
              <p className="text-2xs mt-1">The journalist runs automatically when agents are active, or trigger manually above</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
