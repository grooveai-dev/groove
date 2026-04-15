// FSL-1.1-Apache-2.0 — see LICENSE
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { cn } from '../../lib/cn';
import { Plus, Radio } from 'lucide-react';

export function ServerList({ servers, selectedId, onSelect, onAddNew }) {
  return (
    <div className="flex flex-col h-full w-[220px] flex-shrink-0 border-r border-border-subtle bg-surface-1/50">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
        <span className="text-2xs font-semibold text-text-2 font-sans uppercase tracking-wider">Servers</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={onAddNew}
          className="h-6 text-2xs gap-1 text-text-3 hover:text-accent"
        >
          <Plus size={11} /> Add
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-1">
          {servers.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <Radio size={18} className="text-text-4 mx-auto mb-2" />
              <p className="text-2xs text-text-4 font-sans">No servers configured</p>
            </div>
          ) : (
            servers.map((server) => (
              <button
                key={server.id}
                onClick={() => onSelect(server.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 cursor-pointer transition-colors',
                  'hover:bg-surface-3',
                  selectedId === server.id
                    ? 'bg-accent/8 border-l-2 border-accent'
                    : 'border-l-2 border-transparent',
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <StatusDot status={server.active ? 'running' : 'stopped'} size="sm" />
                  <span className="text-xs font-semibold text-text-0 font-sans truncate">
                    {server.name}
                  </span>
                </div>
                <div className="text-2xs text-text-3 font-mono truncate pl-4">
                  {server.user}@{server.host}:{server.port || 22}
                </div>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
