// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState, useEffect, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { ScrollArea } from '../ui/scroll-area';

const FILTERS = ['All', 'Sessions', 'Errors', 'Connections'];

const LEVEL_FILTER = {
  Sessions: ['session'],
  Errors: ['error', 'warning'],
  Connections: ['connected', 'disconnected'],
};

const LEVEL_COLOR = {
  info: HEX.text3,
  success: HEX.success,
  warning: HEX.warning,
  error: HEX.danger,
  connected: HEX.success,
  disconnected: HEX.warning,
  session: HEX.accent,
};

function fmtTime(ts) {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-GB', { hour12: false });
}

function levelTag(level) {
  const tags = {
    info: 'info', success: ' ok ', warning: 'warn',
    error: 'ERR!', connected: 'conn', disconnected: 'disc', session: 'sess',
  };
  return tags[level] || level || 'info';
}

export const ActivityStream = memo(function ActivityStream() {
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
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1 flex-shrink-0">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Activity</span>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'px-2 py-0.5 text-2xs font-mono rounded-sm transition-colors cursor-pointer',
                filter === f
                  ? 'bg-[rgba(51,175,188,0.15)] text-accent'
                  : 'bg-surface-4 text-text-3 hover:text-text-2',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {display.length === 0 ? (
          <div className="px-3 py-6 text-2xs font-mono text-text-4 text-center">
            No events yet — toggle your node on to start.
          </div>
        ) : (
          <div className="px-2 py-1">
            {display.map((ev, i) => {
              const level = ev.level || ev.type || 'info';
              const color = LEVEL_COLOR[level] || HEX.text3;
              return (
                <div key={i} className="flex items-start gap-0 font-mono text-2xs leading-relaxed">
                  <span className="text-text-4 flex-shrink-0 w-[62px]">[{fmtTime(ev.timestamp || ev.ts)}]</span>
                  <span className="flex-shrink-0 w-[36px]" style={{ color }}>{levelTag(level)}</span>
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
});
