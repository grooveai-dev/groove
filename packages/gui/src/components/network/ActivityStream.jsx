// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';

const FILTERS = ['All', 'Sessions', 'Errors', 'Connections'];

const LEVEL_FILTER = {
  Sessions: ['session'],
  Errors: ['error', 'warning'],
  Connections: ['connected', 'disconnected'],
};

const LEVEL_COLOR = {
  info: 'text-text-3',
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-danger',
  connected: 'text-success',
  disconnected: 'text-warning',
  session: 'text-accent',
};

function fmtTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function levelTag(level) {
  const tags = {
    info: 'info',
    success: 'ok',
    warning: 'warn',
    error: 'ERR!',
    connected: 'conn',
    disconnected: 'disc',
    session: 'sess',
  };
  return (tags[level] || level || 'info').padEnd(4);
}

export function ActivityStream() {
  const events = useGrooveStore((s) => s.networkEvents);
  const [filter, setFilter] = useState('All');
  const bottomRef = useRef(null);

  const filtered = filter === 'All'
    ? events
    : events.filter((ev) => {
        const level = ev.level || ev.type || 'info';
        return (LEVEL_FILTER[filter] || []).includes(level);
      });

  const display = filtered.slice(-200);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [display.length]);

  return (
    <div className="border border-border-subtle bg-surface-0 rounded-sm overflow-hidden flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle flex-shrink-0">
        <span className="text-2xs font-mono text-text-4 tracking-wider">--- ACTIVITY ---</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-0.5 text-2xs font-mono rounded-sm transition-colors cursor-pointer',
                filter === f
                  ? 'bg-surface-3 text-text-0'
                  : 'text-text-4 hover:text-text-2',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-[120px] max-h-[360px]">
        {display.length === 0 ? (
          <div className="px-3 py-6 text-2xs font-mono text-text-4 text-center">
            No events yet — toggle your node on to start.
          </div>
        ) : (
          <div className="px-2 py-1">
            {display.map((ev, i) => {
              const level = ev.level || ev.type || 'info';
              const color = LEVEL_COLOR[level] || 'text-text-3';
              return (
                <div key={i} className="flex items-start gap-0 font-mono text-2xs leading-relaxed">
                  <span className="text-text-4 flex-shrink-0 w-[62px]">[{fmtTime(ev.timestamp || ev.ts)}]</span>
                  <span className={cn('flex-shrink-0 w-[38px]', color)}>{levelTag(level)}</span>
                  <span className="text-text-2 break-words min-w-0">{ev.msg || ev.message || ev.text || 'event'}</span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
