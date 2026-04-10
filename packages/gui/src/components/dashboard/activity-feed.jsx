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
  spawn: '#33afbc',
  rotation: '#c678dd',
  completion: '#4ae168',
  error: '#e06c75',
  default: '#505862',
};

const ActivityFeed = memo(function ActivityFeed({ events = [] }) {
  if (!events.length) {
    return (
      <div className="text-[9px] text-[#3a3f4b] font-mono py-2.5 text-center">
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
            <Icon size={10} style={{ color }} />
            <span className="text-[9px] font-sans text-[#6e7681] whitespace-nowrap">{event.text}</span>
            <span className="text-[8px] font-mono text-[#3a3f4b]">{timeAgo(event.timestamp || event.t)}</span>
          </div>
        );
      })}
    </div>
  );
});

export { ActivityFeed };
