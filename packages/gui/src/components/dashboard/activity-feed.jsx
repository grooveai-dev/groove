// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { RotateCw, Zap, AlertTriangle, CheckCircle, UserPlus } from 'lucide-react';
import { timeAgo } from '../../lib/format';

const ICONS = {
  spawn: UserPlus,
  rotation: RotateCw,
  completion: CheckCircle,
  error: AlertTriangle,
  default: Zap,
};

const ICON_COLORS = {
  spawn: 'text-accent',
  rotation: 'text-purple',
  completion: 'text-success',
  error: 'text-danger',
  default: 'text-text-3',
};

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
        const Icon = ICONS[event.type] || ICONS.default;
        const color = ICON_COLORS[event.type] || ICON_COLORS.default;
        return (
          <div key={i} className="flex items-center gap-1.5 flex-shrink-0">
            <Icon size={11} className={color} />
            <span className="text-xs font-sans text-text-2 whitespace-nowrap">{event.text}</span>
            <span className="text-2xs font-mono text-text-4">{timeAgo(event.timestamp || event.t)}</span>
          </div>
        );
      })}
    </div>
  );
});

export { ActivityFeed };
