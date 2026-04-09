// FSL-1.1-Apache-2.0 — see LICENSE
import { Network, Code2, BarChart3, Puzzle, Users, Newspaper, Settings } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/tooltip';

const NAV_ITEMS = [
  { id: 'agents',      icon: Network,   label: 'Agents' },
  { id: 'editor',      icon: Code2,     label: 'Editor' },
  { id: 'dashboard',   icon: BarChart3,  label: 'Dashboard' },
  { id: 'marketplace', icon: Puzzle,     label: 'Marketplace' },
  { id: 'teams',       icon: Users,     label: 'Teams' },
];

const UTIL_ITEMS = [
  { id: 'journalist', icon: Newspaper, label: 'Journalist', panel: true },
  { id: 'teams',      icon: Settings,  label: 'Settings',   nav: true },
];

export function ActivityBar({ activeView, detailPanel, onNavigate, onTogglePanel }) {
  return (
    <nav className="w-12 flex-shrink-0 flex flex-col bg-surface-3 border-r border-border">
      {/* Main nav */}
      <div className="flex flex-col items-center gap-0.5 pt-2">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.id} content={item.label} side="right">
            <button
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-10 h-10 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                activeView === item.id
                  ? 'text-text-0 bg-surface-5'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-4',
              )}
            >
              <item.icon size={20} strokeWidth={activeView === item.id ? 2 : 1.5} />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Utility nav */}
      <div className="flex flex-col items-center gap-0.5 pb-2">
        {UTIL_ITEMS.map((item) => {
          const isActive = item.panel
            ? detailPanel?.type === item.id
            : activeView === item.id;
          return (
            <Tooltip key={item.id} content={item.label} side="right">
              <button
                onClick={() => item.panel ? onTogglePanel(item.id) : onNavigate(item.nav ? item.id : item.id)}
                className={cn(
                  'w-10 h-10 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                  isActive
                    ? 'text-text-0 bg-surface-5'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-4',
                )}
              >
                <item.icon size={20} strokeWidth={isActive ? 2 : 1.5} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
