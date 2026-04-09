// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '../ui/dialog';
import { Button } from '../ui/button';
import { api } from '../../lib/api';
import { cn } from '../../lib/cn';
import {
  FolderOpen, FolderClosed, ChevronRight, Home, HardDrive,
  ArrowUp, Check, Loader2,
} from 'lucide-react';

function BreadcrumbPath({ path, onNavigate }) {
  const parts = path.split('/').filter(Boolean);
  return (
    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto py-1.5 scrollbar-none">
      <button
        onClick={() => onNavigate('/')}
        className="flex-shrink-0 p-1 rounded hover:bg-surface-5 cursor-pointer text-text-3 hover:text-text-0 transition-colors"
      >
        <HardDrive size={13} />
      </button>
      {parts.map((part, i) => {
        const fullPath = '/' + parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        return (
          <div key={i} className="flex items-center gap-0.5 flex-shrink-0">
            <ChevronRight size={11} className="text-text-4" />
            <button
              onClick={() => onNavigate(fullPath)}
              className={cn(
                'px-1.5 py-0.5 rounded text-xs font-mono cursor-pointer transition-colors',
                isLast
                  ? 'text-text-0 bg-surface-4 font-medium'
                  : 'text-text-3 hover:text-text-0 hover:bg-surface-5',
              )}
            >
              {part}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function FolderBrowser({ open, onOpenChange, currentPath, onSelect }) {
  const [path, setPath] = useState(currentPath || process.env.HOME || '/');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      navigateTo(currentPath || '/');
    }
  }, [open]);

  async function navigateTo(target) {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/browse-system?path=${encodeURIComponent(target)}`);
      setPath(data.current || target);
      setEntries(data.dirs || []);
    } catch (err) {
      setError(err.message);
      setEntries([]);
    }
    setLoading(false);
  }

  function goUp() {
    const parent = path === '/' ? '/' : path.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  }

  function goHome() {
    navigateTo(process.env.HOME || '/Users');
  }

  function handleSelect() {
    onSelect(path);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Select Working Directory" description="Choose a directory for this agent to work in" className="max-w-[520px]">
        <div className="px-5 py-4 space-y-3">
          {/* Navigation bar */}
          <div className="flex items-center gap-2">
            <button
              onClick={goUp}
              disabled={path === '/'}
              className="p-1.5 rounded-md bg-surface-4 border border-border text-text-2 hover:text-text-0 hover:bg-surface-5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowUp size={14} />
            </button>
            <button
              onClick={goHome}
              className="p-1.5 rounded-md bg-surface-4 border border-border text-text-2 hover:text-text-0 hover:bg-surface-5 transition-colors cursor-pointer"
            >
              <Home size={14} />
            </button>
            <div className="flex-1 min-w-0 bg-surface-0 rounded-md border border-border-subtle px-2">
              <BreadcrumbPath path={path} onNavigate={navigateTo} />
            </div>
          </div>

          {/* Directory listing */}
          <div className="bg-surface-0 rounded-lg border border-border-subtle overflow-hidden">
            <div className="max-h-[340px] overflow-y-auto">
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={18} className="text-text-3 animate-spin" />
                </div>
              )}
              {error && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-danger font-sans">{error}</p>
                </div>
              )}
              {!loading && !error && entries.length === 0 && (
                <div className="px-4 py-6 text-center">
                  <p className="text-xs text-text-3 font-sans">No subdirectories</p>
                </div>
              )}
              {!loading && !error && entries.map((entry) => (
                <button
                  key={entry.path}
                  onClick={() => navigateTo(entry.path)}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3.5 py-2 text-left cursor-pointer',
                    'hover:bg-surface-4 transition-colors border-b border-border-subtle last:border-0',
                  )}
                >
                  {entry.hasChildren
                    ? <FolderClosed size={15} className="text-warning flex-shrink-0" />
                    : <FolderOpen size={15} className="text-text-3 flex-shrink-0" />
                  }
                  <span className="text-sm text-text-0 font-sans truncate flex-1">{entry.name}</span>
                  {entry.hasChildren && (
                    <ChevronRight size={12} className="text-text-4 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Current selection */}
          <div className="flex items-center gap-3 bg-surface-4/50 rounded-lg px-3.5 py-2.5 border border-border-subtle">
            <FolderOpen size={16} className="text-accent flex-shrink-0" />
            <span className="text-xs font-mono text-text-1 truncate flex-1">{path}</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleSelect} className="gap-1.5">
              <Check size={14} /> Select Folder
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
