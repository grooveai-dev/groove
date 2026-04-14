// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect, useRef } from 'react';
import { Search, Plus, ChevronRight, LogIn, LogOut, User, ExternalLink, BookOpen, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useGrooveStore } from '../../stores/groove';
import { isElectron, getPlatform } from '../../lib/electron';

function ProfilePic({ user, size = 24 }) {
  const [broken, setBroken] = useState(false);
  const src = user?.avatar || user?.picture || user?.photoURL || user?.photo;

  if (src && !broken) {
    return (
      <img
        src={src}
        alt=""
        className="rounded-full"
        style={{ width: size, height: size }}
        referrerPolicy="no-referrer"
        crossOrigin="anonymous"
        onError={() => setBroken(true)}
      />
    );
  }

  return (
    <div
      className="rounded-full bg-accent/10 flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <User size={Math.round(size * 0.5)} className="text-accent" />
    </div>
  );
}

function UserMenu() {
  const authenticated = useGrooveStore((s) => s.marketplaceAuthenticated);
  const user = useGrooveStore((s) => s.marketplaceUser);
  const login = useGrooveStore((s) => s.marketplaceLogin);
  const logout = useGrooveStore((s) => s.marketplaceLogout);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  if (!authenticated) {
    return (
      <button
        onClick={login}
        className="flex items-center gap-1.5 h-7 px-3 rounded-md bg-surface-1 border border-border-subtle text-xs font-semibold font-sans text-text-2 hover:text-text-0 hover:border-border transition-colors cursor-pointer select-none flex-shrink-0"
      >
        <LogIn size={12} />
        Sign in
      </button>
    );
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          'flex items-center gap-2 h-7 pl-1 pr-2 rounded-md transition-colors cursor-pointer select-none',
          open ? 'bg-surface-1 border border-border' : 'hover:bg-surface-1 border border-transparent',
        )}
      >
        <ProfilePic user={user} size={20} />
        <span className="text-xs text-text-1 font-sans font-medium max-w-[100px] truncate">
          {user?.displayName || user?.id || 'Account'}
        </span>
        <ChevronDown size={10} className={cn('text-text-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 py-1 rounded-md bg-surface-1 border border-border shadow-lg z-50">
          <div className="px-3 py-2 border-b border-border-subtle">
            <p className="text-xs font-medium text-text-0 font-sans truncate">{user?.displayName || 'Account'}</p>
            {user?.email && <p className="text-2xs text-text-4 font-sans truncate">{user.email}</p>}
          </div>
          <a
            href="https://docs.groovedev.ai"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-2 hover:text-text-0 hover:bg-surface-3 font-sans cursor-pointer transition-colors"
          >
            <BookOpen size={12} />
            Docs
            <ExternalLink size={9} className="ml-auto text-text-4" />
          </a>
          <a
            href="https://groovedev.ai"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-text-2 hover:text-text-0 hover:bg-surface-3 font-sans cursor-pointer transition-colors"
          >
            <ExternalLink size={12} />
            groovedev.ai
          </a>
          <div className="my-1 h-px bg-border-subtle" />
          <button
            onClick={() => { setOpen(false); logout(); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-3 hover:text-danger hover:bg-surface-3 font-sans cursor-pointer transition-colors"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

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
        darwinDrag && 'pl-24 electron-drag electron-no-drag-children',
      )}
    >
      {/* Project name badge — clickable to open folder */}
      {instanceName && (
        <button
          onClick={() => window.groove?.openFolder?.()}
          className="text-2xs font-mono font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded flex-shrink-0 hover:bg-accent/20 transition-colors cursor-pointer"
        >
          {instanceName}
        </button>
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

      <UserMenu />
    </header>
  );
}
