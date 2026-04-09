// FSL-1.1-Apache-2.0 — see LICENSE
import { RotateCw, Zap, AlertTriangle, CheckCircle, UserPlus } from 'lucide-react';
import { timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';

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

export function ActivityFeed({ events = [] }) {
  if (!events.length) {
    return (
      <div className="text-xs text-text-4 font-sans py-3 text-center">
        No recent activity
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto py-2 px-3">
      {events.slice(-10).reverse().map((event, i) => {
        const Icon = ICONS[event.type] || ICONS.default;
        const color = ICON_COLORS[event.type] || ICON_COLORS.default;
        return (
          <div key={i} className="flex items-center gap-1.5 flex-shrink-0 text-2xs font-sans">
            <Icon size={12} className={color} />
            <span className="text-text-2 whitespace-nowrap">{event.text}</span>
            <span className="text-text-4">{timeAgo(event.timestamp)}</span>
          </div>
        );
      })}
    </div>
  );
}
