// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { RotateCw, Zap, AlertTriangle, CheckCircle, UserPlus, Skull, XCircle } from 'lucide-react';
import { timeAgo } from '../../lib/format';

const ICONS = {
  spawn: UserPlus,
  complete: CheckCircle,
  crash: AlertTriangle,
  kill: XCircle,
  rotate: RotateCw,
  error: Skull,
};

const ICON_COLORS = {
  spawn: 'text-text-2',
  complete: 'text-text-2',
  crash: 'text-danger',
  kill: 'text-text-3',
  rotate: 'text-text-2',
  error: 'text-danger',
};

function eventLabel(event) {
  const name = event.agentName || event.role || '';
  switch (event.type) {
    case 'spawn': return `${name} spawned`;
    case 'complete': return `${name} completed`;
    case 'crash': return `${name} crashed`;
    case 'kill': return `${name} killed`;
    case 'rotate': return `${name} rotated`;
    default: return event.text || event.type || 'event';
  }
}

const ActivityFeed = memo(function ActivityFeed({ events = [] }) {
  if (!events.length) {
    return (
      <div className="text-xs text-text-3 font-mono py-2.5 text-center">
        No recent activity
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto py-2 px-3">
      {events.slice(-15).reverse().map((event, i) => {
        const Icon = ICONS[event.type] || Zap;
        const color = ICON_COLORS[event.type] || 'text-text-3';
        const label = eventLabel(event);
        return (
          <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
            <Icon size={11} className={color} />
            <span className="text-xs font-sans text-text-2 whitespace-nowrap">{label}</span>
            <span className="text-2xs font-mono text-text-4">{timeAgo(event.t || event.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
});

export { ActivityFeed };
