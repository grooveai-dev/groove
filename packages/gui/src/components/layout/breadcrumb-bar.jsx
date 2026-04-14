// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Search, Plus, ChevronRight, FolderOpen } from 'lucide-react';
import { cn } from '../../lib/cn';
import { isElectron, getPlatform } from '../../lib/electron';

const VIEW_LABELS = {
  agents: 'Agents',
  editor: 'Editor',
  dashboard: 'Dashboard',
  marketplace: 'Marketplace',
  teams: 'Teams',
};

export function BreadcrumbBar({
  activeView,
  connected,
  daemonHost,
  editorActiveFile,
  onOpenCommandPalette,
  onSpawn,
}) {
  const crumbs = ['Groove', VIEW_LABELS[activeView] || activeView];
  if (activeView === 'editor' && editorActiveFile) {
    crumbs.push(editorActiveFile.split('/').pop());
  }

  const electron = isElectron();
  const darwinDrag = electron && getPlatform() === 'darwin';

  const [instanceName, setInstanceName] = useState(null);

  useEffect(() => {
    if (window.groove?.getInstanceInfo) {
      window.groove.getInstanceInfo().then(info => {
        if (info?.name) setInstanceName(info.name);
      });
    } else {
      const param = new URLSearchParams(window.location.search).get('instance');
      if (param) setInstanceName(param);
    }
  }, []);

  return (
    <header
      className={cn(
        'h-11 flex-shrink-0 flex items-center gap-3 px-4 bg-surface-3 border-b border-border',
        darwinDrag && 'pl-20 electron-drag electron-no-drag-children',
      )}
    >
      {/* Logo */}
      <img src="/favicon.png" alt="Groove" className="h-7 w-7 rounded-full flex-shrink-0" />

      {/* Open Folder — Electron only */}
      {window.groove?.openFolder && (
        <button
          onClick={() => window.groove.openFolder()}
          className="p-1.5 rounded-md text-text-3 hover:text-text-0 hover:bg-surface-4 transition-colors cursor-pointer"
          title="Open Folder (new window)"
        >
          <FolderOpen size={15} />
        </button>
      )}

      {/* Project name badge */}
      {instanceName && (
        <span className="text-2xs font-mono font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded flex-shrink-0">
          {instanceName}
        </span>
      )}

      {/* Host badge — show raw host when no instance */}
      {!instanceName && daemonHost && (
        <span className="text-2xs font-mono font-semibold text-text-3 bg-surface-5 px-1.5 py-0.5 rounded flex-shrink-0">
          {daemonHost}
        </span>
      )}

      <div className="flex-1 min-w-4" />

      {/* Command palette — pill style */}
      <button
        onClick={onOpenCommandPalette}
        className={cn(
          'flex items-center gap-2.5 h-8 px-4 rounded-md w-full max-w-md',
          'bg-surface-1 border border-border-subtle',
          'text-xs text-text-4 font-sans',
          'hover:border-border hover:text-text-3 transition-colors cursor-pointer',
        )}
      >
        <Search size={14} className="flex-shrink-0" />
        <span className="flex-1 text-left">Search commands...</span>
        <kbd className="text-2xs font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-4 ml-1">Cmd+K</kbd>
      </button>

      <div className="flex-1 min-w-4" />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 text-xs font-sans text-text-3 flex-shrink-0">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight size={11} className="text-text-4" />}
            <span className={cn(i === crumbs.length - 1 ? 'text-text-2' : 'text-text-4')}>
              {crumb}
            </span>
          </span>
        ))}
      </div>

      {/* Spawn button */}
      {connected && (
        <button
          onClick={onSpawn}
          className="ml-1 flex items-center gap-1 h-7 px-3.5 rounded-md bg-accent/15 text-accent text-xs font-semibold font-sans hover:bg-accent/25 transition-colors cursor-pointer select-none flex-shrink-0"
        >
          <Plus size={14} />
          Spawn
        </button>
      )}
    </header>
  );
}
