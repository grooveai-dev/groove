// FSL-1.1-Apache-2.0 — see LICENSE
import { Network, Code2, ChartSpline, Puzzle, Gamepad2, Users, Box, Globe, Newspaper, Settings } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/tooltip';
import { isElectron, getPlatform } from '../../lib/electron';

const NAV_ITEMS = [
  { id: 'agents',      icon: Network,   label: 'Agents' },
  { id: 'editor',      icon: Code2,     label: 'Editor' },
  { id: 'dashboard',   icon: ChartSpline, label: 'Dashboard' },
  { id: 'marketplace', icon: Puzzle,     label: 'Marketplace' },
  { id: 'toys',        icon: Gamepad2,  label: 'Toys' },
  { id: 'models',      icon: Box,       label: 'Models' },
  { id: 'teams',       icon: Users,     label: 'Teams' },
  { id: 'federation', icon: Globe,     label: 'Federation' },
];

const UTIL_ITEMS = [
  { id: 'journalist', icon: Newspaper, label: 'Journalist', panel: true },
  { id: 'settings',   icon: Settings,  label: 'Settings',   nav: true },
];

export function ActivityBar({ activeView, detailPanel, onNavigate, onTogglePanel }) {
  const darwinTrafficLights = isElectron() && getPlatform() === 'darwin';

  return (
    <nav className="w-12 flex-shrink-0 flex flex-col bg-surface-3 border-r border-border">
      {/* Main nav */}
      <div className="flex flex-col items-center gap-1.5 pt-3">
        {darwinTrafficLights && (
          <div className="w-full h-[44px] flex-shrink-0 flex items-end justify-center pb-1.5">
            <img src="/favicon.png" alt="Groove" className="h-7 w-7 rounded-full" />
          </div>
        )}
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.id} content={item.label} side="right">
            <button
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                activeView === item.id
                  ? 'text-text-0 bg-surface-5'
                  : 'text-text-3 hover:text-text-1 hover:bg-surface-4',
              )}
            >
              <item.icon size={16} strokeWidth={activeView === item.id ? 2 : 1.5} />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Utility nav */}
      <div className="flex flex-col items-center gap-1.5 pb-3">
        {UTIL_ITEMS.map((item) => {
          const isActive = item.panel
            ? detailPanel?.type === item.id
            : activeView === item.id;
          return (
            <Tooltip key={item.id} content={item.label} side="right">
              <button
                onClick={() => item.panel ? onTogglePanel(item.id) : onNavigate(item.id)}
                className={cn(
                  'w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                  isActive
                    ? 'text-text-0 bg-surface-5'
                    : 'text-text-3 hover:text-text-1 hover:bg-surface-4',
                )}
              >
                <item.icon size={16} strokeWidth={isActive ? 2 : 1.5} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </nav>
  );
}
