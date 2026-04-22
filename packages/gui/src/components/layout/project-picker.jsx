// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { FolderBrowser } from '../agents/folder-browser';
import { cn } from '../../lib/cn';
import {
  FolderOpen, FolderClosed, Clock, ChevronRight, Plus, Monitor,
} from 'lucide-react';

function formatTimeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ProjectPicker() {
  const show = useGrooveStore((s) => s.showProjectPicker);
  const recentProjects = useGrooveStore((s) => s.recentProjects);
  const setProjectDir = useGrooveStore((s) => s.setProjectDir);
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [loading, setLoading] = useState(null);

  if (!show) return null;

  async function handleSelect(path) {
    setLoading(path);
    try {
      await setProjectDir(path);
    } catch {
      setLoading(null);
    }
  }

  async function handleBrowseSelect(path) {
    setBrowserOpen(false);
    await handleSelect(path);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/90 backdrop-blur-sm">
      <div className="w-full max-w-lg mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 mb-4">
            <Monitor size={28} className="text-accent" />
          </div>
          <h1 className="text-xl font-semibold text-text-0 mb-1">Open a project</h1>
          <p className="text-sm text-text-3">Select a working directory for this session</p>
        </div>

        {/* Recent projects */}
        {recentProjects.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Clock size={13} className="text-text-4" />
              <span className="text-xs font-medium text-text-3 uppercase tracking-wider">Recent</span>
            </div>
            <div className="bg-surface-2 rounded-xl border border-border overflow-hidden">
              {recentProjects.map((project, i) => (
                <button
                  key={project.path}
                  onClick={() => handleSelect(project.path)}
                  disabled={loading !== null}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer',
                    'hover:bg-surface-4 transition-colors',
                    'disabled:opacity-50 disabled:cursor-wait',
                    i < recentProjects.length - 1 && 'border-b border-border-subtle',
                  )}
                >
                  <FolderClosed size={18} className="text-warning flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-0 truncate">{project.name}</div>
                    <div className="text-xs text-text-3 font-mono truncate">{project.path}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {project.openedAt && (
                      <span className="text-[11px] text-text-4">{formatTimeAgo(project.openedAt)}</span>
                    )}
                    {loading === project.path ? (
                      <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <ChevronRight size={14} className="text-text-4" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Open folder button */}
        <button
          onClick={() => setBrowserOpen(true)}
          disabled={loading !== null}
          className={cn(
            'w-full flex items-center gap-3 px-4 py-3.5 rounded-xl cursor-pointer',
            'bg-surface-2 border border-border border-dashed',
            'hover:bg-surface-4 hover:border-accent/30 transition-colors',
            'disabled:opacity-50 disabled:cursor-wait',
          )}
        >
          <div className="flex items-center justify-center w-9 h-9 rounded-lg bg-accent/10">
            <Plus size={18} className="text-accent" />
          </div>
          <div className="text-left">
            <div className="text-sm font-medium text-text-0">Open Folder</div>
            <div className="text-xs text-text-3">Browse the filesystem</div>
          </div>
        </button>

        <FolderBrowser
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          currentPath={remoteHomedir || '/home'}
          homePath={remoteHomedir}
          onSelect={handleBrowseSelect}
        />
      </div>
    </div>
  );
}
