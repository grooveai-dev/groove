// FSL-1.1-Apache-2.0 — see LICENSE
import { useGrooveStore } from '../../stores/groove';
import { ScrollArea } from '../ui/scroll-area';
import { timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';
import { Activity, Zap, AlertTriangle, CheckCircle } from 'lucide-react';

const EVENT_ICON = {
  info: Activity,
  success: CheckCircle,
  warning: AlertTriangle,
  error: AlertTriangle,
  connected: CheckCircle,
  disconnected: AlertTriangle,
  session: Zap,
};

const EVENT_COLOR = {
  info: 'text-text-3',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
  connected: 'text-success',
  disconnected: 'text-warning',
  session: 'text-accent',
};

export function NodeDetails() {
  const events = useGrooveStore((s) => s.networkEvents);

  return (
    <div className="flex flex-col rounded-sm border border-border bg-surface-1 overflow-hidden min-h-0">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle">
        <Activity size={12} className="text-text-3" />
        <span className="text-xs font-semibold text-text-1 font-sans">Node Activity</span>
        <div className="flex-1" />
        <span className="text-2xs font-mono text-text-4">{events.length} events</span>
      </div>
      <ScrollArea className="flex-1 min-h-[160px] max-h-[320px]">
        {events.length === 0 ? (
          <div className="px-4 py-8 text-center text-2xs text-text-4 font-sans">
            Toggle on to start contributing — events will appear here.
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {[...events].reverse().map((ev, i) => {
              const level = ev.level || ev.type || 'info';
              const Icon = EVENT_ICON[level] || Activity;
              const color = EVENT_COLOR[level] || 'text-text-3';
              return (
                <li key={i} className="flex items-start gap-2.5 px-4 py-2">
                  <Icon size={11} className={cn('flex-shrink-0 mt-0.5', color)} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-sans text-text-1 break-words">{ev.msg || ev.message || ev.text || 'event'}</div>
                    {ev.detail && <div className="text-2xs text-text-4 font-mono mt-0.5">{ev.detail}</div>}
                  </div>
                  <span className="text-2xs font-mono text-text-4 flex-shrink-0">{timeAgo(ev.timestamp || ev.ts)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </ScrollArea>
    </div>
  );
}
