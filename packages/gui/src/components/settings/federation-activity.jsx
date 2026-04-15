// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/cn';
import { timeAgo } from '../../lib/format';
import {
  ArrowUpRight, ArrowDownLeft, MessageSquare,
} from 'lucide-react';

const FILTERS = ['All', 'Sent', 'Received'];

export function FederationActivity() {
  const pouchLog = useGrooveStore((s) => s.federation.pouchLog);
  const [filter, setFilter] = useState('All');

  const filtered = filter === 'All'
    ? pouchLog
    : pouchLog.filter((e) => e.direction === filter.toLowerCase());

  const entries = [...filtered].reverse().slice(0, 200);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare size={12} className="text-accent" />
          <span className="text-xs font-semibold text-text-1 font-sans">Activity</span>
          {pouchLog.length > 0 && (
            <Badge variant="default" className="text-2xs">{pouchLog.length}</Badge>
          )}
        </div>
        <div className="flex bg-surface-0 rounded-md p-0.5 border border-border-subtle">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2.5 py-1 text-2xs font-semibold font-sans rounded transition-all cursor-pointer',
                filter === f
                  ? 'bg-accent/15 text-accent shadow-sm'
                  : 'text-text-3 hover:text-text-1',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-1/50 px-4 py-6 text-center">
          <MessageSquare size={18} className="text-text-4 mx-auto mb-1.5" />
          <p className="text-2xs text-text-4 font-sans">
            {filter === 'All'
              ? 'No diplomatic pouches exchanged yet.'
              : `No ${filter.toLowerCase()} pouches.`}
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-80">
          <div className="relative pl-5">
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border-subtle" />

            {entries.map((entry, i) => {
              const isSent = entry.direction === 'sent';
              return (
                <div key={entry.id || i} className="relative flex items-start gap-3 pb-3 last:pb-0">
                  <div className={cn(
                    'absolute left-[-13px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-surface-2 z-10',
                    isSent ? 'bg-accent' : 'bg-success',
                  )} />
                  <div className="flex items-center gap-2 flex-1 rounded-md bg-surface-1 px-3 py-2 min-w-0">
                    {isSent ? (
                      <ArrowUpRight size={11} className="text-accent flex-shrink-0" />
                    ) : (
                      <ArrowDownLeft size={11} className="text-success flex-shrink-0" />
                    )}
                    <span className="text-2xs text-text-1 font-sans truncate flex-1">
                      {entry.contractType || entry.type || 'message'}
                    </span>
                    <span className="text-2xs text-text-4 font-mono truncate max-w-24">
                      {entry.peerId || ''}
                    </span>
                    <span className="text-2xs text-text-3 font-sans flex-shrink-0">
                      {timeAgo(entry.timestamp || entry.ts)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
