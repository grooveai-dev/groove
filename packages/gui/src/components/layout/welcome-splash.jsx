// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import { Zap, FolderOpen, Radio } from 'lucide-react';
import { FolderBrowser } from '../agents/folder-browser';
import { QuickConnect } from '../settings/quick-connect';
import { ToastContainer } from '../ui/toast';

export function WelcomeSplash() {
  const recentProjects = useGrooveStore((s) => s.recentProjects);
  const setProjectDir = useGrooveStore((s) => s.setProjectDir);
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const [browsing, setBrowsing] = useState(false);

  const visibleProjects = (recentProjects || []).slice(0, 6);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto"
      style={{ background: `radial-gradient(ellipse at 50% 40%, ${hexAlpha(HEX.accent, 0.06)} 0%, transparent 70%) ${HEX.surface0}` }}
    >
      <div className="max-w-2xl w-full px-8 py-16 flex flex-col items-center text-center">
        {/* Hero icon */}
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center mb-6"
          style={{
            background: hexAlpha(HEX.accent, 0.08),
            border: `1px solid ${hexAlpha(HEX.accent, 0.15)}`,
            boxShadow: `0 0 40px ${hexAlpha(HEX.accent, 0.1)}`,
          }}
        >
          <img src="/favicon.png" className="w-12 h-12 rounded-full" alt="Groove" />
        </div>

        {/* Headline */}
        <h1 className="text-3xl font-bold text-text-0 font-sans tracking-tight">Welcome to Groove</h1>
        <p className="text-sm text-text-2 font-sans mt-2">Your AI coding team, ready in minutes</p>

        {/* Primary action */}
        <div className="w-full mt-10">
          <button
            onClick={() => useGrooveStore.setState({ showProjectPicker: false })}
            className="w-full flex items-center gap-4 p-5 rounded-lg border border-accent/25 bg-gradient-to-r from-accent/8 to-accent/3 hover:from-accent/14 hover:to-accent/6 hover:border-accent/40 transition-all cursor-pointer group text-left"
          >
            <div className="w-12 h-12 rounded-lg bg-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <Zap size={24} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold text-text-0 font-sans">Start with a Planner</div>
              <div className="text-sm text-text-2 font-sans mt-0.5">Describe what you want to build and let AI plan the perfect team</div>
            </div>
            <div className="text-accent text-xs font-semibold font-sans flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
              Recommended
            </div>
          </button>
        </div>

        {/* Secondary actions */}
        <div className="w-full grid grid-cols-2 gap-3 mt-3">
          <button
            onClick={() => setBrowsing(true)}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all cursor-pointer group text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-surface-4 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <FolderOpen size={20} className="text-text-1" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-0 font-sans">Open Project</div>
              <div className="text-xs text-text-3 font-sans mt-0.5">Browse the filesystem</div>
            </div>
          </button>

          <button
            onClick={() => useGrooveStore.getState().toggleQuickConnect()}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all cursor-pointer group text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-surface-4 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
              <Radio size={20} className="text-text-1" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-0 font-sans">Connect to Remote</div>
              <div className="text-xs text-text-3 font-sans mt-0.5">SSH tunnel to a server</div>
            </div>
          </button>
        </div>

        {/* Recent projects */}
        {visibleProjects.length > 0 && (
          <div className="w-full mt-8">
            <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-2 text-left">Recent</div>
            <div className={cn('grid gap-2', visibleProjects.length === 1 ? 'grid-cols-1' : visibleProjects.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
              {visibleProjects.map((project) => (
                <button
                  key={project.path}
                  onClick={() => setProjectDir(project.path)}
                  className="bg-surface-1 rounded-sm border border-border-subtle px-4 py-3 cursor-pointer hover:bg-surface-2 transition-colors text-left"
                >
                  <div className="text-sm font-medium text-text-0 truncate">{project.name}</div>
                  <div className="text-2xs font-mono text-text-4 truncate mt-1">{project.path}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Keyboard shortcuts */}
        <p className="text-xs text-text-4 font-sans mt-8">
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+K</kbd>
          <span className="mx-1.5">command palette</span>
          <span className="text-text-4 mx-1">&middot;</span>
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+N</kbd>
          <span className="mx-1.5">spawn</span>
          <span className="text-text-4 mx-1">&middot;</span>
          <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3">Cmd+J</kbd>
          <span className="mx-1.5">terminal</span>
        </p>
      </div>

      <FolderBrowser
        open={browsing}
        onOpenChange={setBrowsing}
        currentPath={remoteHomedir || '/home'}
        homePath={remoteHomedir}
        onSelect={(dir) => { setBrowsing(false); setProjectDir(dir); }}
      />
      <QuickConnect />
      <ToastContainer />
    </div>
  );
}
