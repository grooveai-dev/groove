// FSL-1.1-Apache-2.0 — see LICENSE
import { Network, Code2, ChartSpline, Puzzle, Gamepad2, Users, Box, Newspaper, Settings, Globe, MessageCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tooltip } from '../ui/tooltip';
import { useGrooveStore } from '../../stores/groove';
import { isElectron, getPlatform } from '../../lib/electron';

const BASE_NAV_ITEMS = [
  { id: 'agents',      icon: Network,   label: 'Agents' },
  { id: 'chat',        icon: MessageCircle, label: 'Chat' },
  { id: 'editor',      icon: Code2,     label: 'Editor' },
  { id: 'dashboard',   icon: ChartSpline, label: 'Dashboard' },
  { id: 'teams',       icon: Users,     label: 'Teams' },
  { id: 'marketplace', icon: Puzzle,     label: 'Marketplace' },
  { id: 'toys',        icon: Gamepad2,  label: 'Toys' },
  { id: 'models',      icon: Box,       label: 'Models' },
];

const NETWORK_NAV_ITEM = { id: 'network', icon: Globe, label: 'Network' };

const UTIL_ITEMS = [
  { id: 'journalist', icon: Newspaper, label: 'Journalist', panel: true },
  { id: 'settings',   icon: Settings,  label: 'Settings',   nav: true },
];

export function ActivityBar({ activeView, detailPanel, onNavigate, onTogglePanel }) {
  const darwinTrafficLights = isElectron() && getPlatform() === 'darwin';
  const networkUnlocked = useGrooveStore((s) => s.networkUnlocked);
  const NAV_ITEMS = networkUnlocked ? [...BASE_NAV_ITEMS, NETWORK_NAV_ITEM] : BASE_NAV_ITEMS;

  return (
    <nav className="w-12 flex-shrink-0 flex flex-col bg-surface-3 border-r border-border">
      {/* Sidebar header — no border (can't cleanly match BreadcrumbBar border due to h-9 vs h-11) */}
      {darwinTrafficLights && (
        <div className="flex-shrink-0 h-9 flex items-end justify-center pb-0.5">
          <img src="/favicon.png" alt="Groove" className="h-6 w-6 rounded-full" />
        </div>
      )}

      {/* Main nav */}
      <div className="flex flex-col items-center gap-1.5 pt-2.5">
        {NAV_ITEMS.map((item) => (
          <Tooltip key={item.id} content={item.label} side="right">
            <button
              onClick={() => onNavigate(item.id)}
              className={cn(
                'w-8 h-8 flex items-center justify-center rounded-md transition-colors cursor-pointer',
                activeView === item.id
                  ? 'text-accent bg-accent/10'
                  : 'text-text-3 hover:text-accent hover:bg-accent/10',
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
                    ? 'text-accent bg-accent/10'
                    : 'text-text-3 hover:text-accent hover:bg-accent/10',
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
