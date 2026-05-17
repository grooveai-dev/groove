// FSL-1.1-Apache-2.0 — see LICENSE
//
// ⚠️  AGENT CONTEXT LANDMINE — READ BEFORE MODIFYING THIS FILE
//
// This file's import chain pulls in heavy components (quick-connect → ssh-wizard
// at 22KB, folder-browser at 7KB, groove.js store at 41KB). Reading those files
// will blow your context window and cause compaction → stall → freeze.
//
// RULES FOR AI AGENTS:
//   1. Do NOT read groove.js — the store selectors below are the full interface
//   2. Do NOT read or modify quick-connect.jsx or ssh-wizard.jsx — they are
//      standalone components rendered as-is. Restyle them in their own files.
//   3. Do NOT read folder-browser.jsx — it's a dialog, just pass it props
//   4. Do NOT spawn Explore sub-agents to "understand the codebase" — everything
//      you need is in THIS file and app.css (for design tokens / CSS variables)
//   5. Redesign THIS file only. Never rewrite imported components as a side-effect.
//
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import {
  FolderOpen, Radio, X, Plus, ExternalLink, Loader2, Unplug,
  ArrowRight, Clock, Server,
} from 'lucide-react';
import { FolderBrowser } from '../agents/folder-browser'; // dialog — don't read source, just pass props
import { QuickConnect } from '../settings/quick-connect'; // self-contained — don't read or rewrite
import { StatusDot } from '../ui/status-dot';
import { ToastContainer } from '../ui/toast';

export function WelcomeSplash() {
  // These are ALL the store selectors this component uses — no need to read groove.js
  const recentProjects = useGrooveStore((s) => s.recentProjects);
  const setProjectDir = useGrooveStore((s) => s.setProjectDir);
  const removeRecentProject = useGrooveStore((s) => s.removeRecentProject);
  const remoteHomedir = useGrooveStore((s) => s.remoteHomedir);
  const savedTunnels = useGrooveStore((s) => s.savedTunnels);
  const fetchTunnels = useGrooveStore((s) => s.fetchTunnels);
  const deleteTunnel = useGrooveStore((s) => s.deleteTunnel);
  const connectTunnel = useGrooveStore((s) => s.connectTunnel);
  const disconnectTunnel = useGrooveStore((s) => s.disconnectTunnel);
  const toggleQuickConnect = useGrooveStore((s) => s.toggleQuickConnect);
  const addToast = useGrooveStore((s) => s.addToast);

  const [browsing, setBrowsing] = useState(false);
  const [connectingId, setConnectingId] = useState(null);

  useEffect(() => { fetchTunnels(); }, [fetchTunnels]);

  const visibleProjects = (recentProjects || []).slice(0, 8);
  const hasRecent = visibleProjects.length > 0;
  const hasTunnels = savedTunnels.length > 0;
  const hasContent = hasRecent || hasTunnels;

  async function handleTunnelClick(server) {
    if (server.active) {
      if (window.groove?.remote?.openWindow) {
        window.groove.remote.openWindow(server.localPort, server.name);
      } else {
        window.open(`http://localhost:${server.localPort}?instance=${encodeURIComponent(server.name)}`, '_blank');
      }
      return;
    }
    setConnectingId(server.id);
    try {
      await connectTunnel(server.id);
    } catch (err) {
      const detail = err?.message || 'Unknown error';
      const isSetupIssue = /permission|EACCES|sudo|Node\.js is not installed|npm install failed|write access/i.test(detail);
      if (isSetupIssue) {
        toggleQuickConnect();
        addToast('warning', 'Remote setup needed', 'Follow the instructions to set up the remote server.');
      } else {
        addToast('error', 'Connection failed', detail);
      }
    }
    setConnectingId(null);
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto welcome-bg">
      <div className="pointer-events-none fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] rounded-full bg-accent/[0.03] blur-[120px]" />

      <div className="relative min-h-screen flex flex-col items-center px-8 pt-[14vh] pb-12 max-sm:pt-[8vh] max-sm:px-5">

        {/* ── Hero ──────────────────────────────────────────── */}
        <div className="flex flex-col items-center text-center mb-14">
          <div className="relative mb-8">
            <div className="absolute -inset-10 rounded-full bg-accent/[0.06] blur-3xl animate-welcome-breathe" />
            <div className="absolute -inset-4 rounded-full border border-accent/25 animate-welcome-ring" />
            <div className="absolute -inset-4 rounded-full border border-accent/15 animate-welcome-ring-delayed" />
            <div className="relative w-[88px] h-[88px] rounded-full bg-accent/[0.07] border border-accent/20 flex items-center justify-center welcome-logo-shadow">
              <img src="/favicon.png" className="w-12 h-12 rounded-full" alt="Groove" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-text-0 tracking-tight mb-3 font-sans max-sm:text-3xl">
            Welcome to Groove
          </h1>
          <p className="text-base text-text-2 font-sans max-w-md leading-relaxed max-sm:text-sm">
            The most powerful agenticOS ever built.
            <br className="max-sm:hidden" />
            <span className="max-sm:hidden"> </span>Spawn fast. Stay aware. Never lose context.
          </p>
        </div>

        {/* ── Action Cards ──────────────────────────────────── */}
        <div className="w-full max-w-2xl grid grid-cols-2 gap-4 mb-14 max-sm:grid-cols-1 max-sm:max-w-sm">
          <button
            onClick={() => setBrowsing(true)}
            className="group relative overflow-hidden rounded-xl border border-accent/20 bg-gradient-to-br from-accent/[0.08] via-accent/[0.03] to-transparent p-6 text-left hover:border-accent/40 hover:from-accent/[0.14] hover:via-accent/[0.06] transition-all duration-300 cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/15 border border-accent/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <FolderOpen size={24} className="text-accent" />
            </div>
            <div className="text-lg font-semibold text-text-0 font-sans mb-1">Open Project</div>
            <div className="text-sm text-text-2 font-sans">Browse the filesystem to pick a project</div>
            <div className="flex items-center gap-1 text-xs text-accent font-sans mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              Browse files <ArrowRight size={12} />
            </div>
          </button>

          <button
            onClick={toggleQuickConnect}
            className="group relative overflow-hidden rounded-xl border border-border bg-surface-1 p-6 text-left hover:border-accent/30 hover:bg-surface-2 transition-all duration-300 cursor-pointer"
          >
            <div className="w-12 h-12 rounded-xl bg-surface-4 border border-border-subtle flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-accent/10 group-hover:border-accent/20 transition-all duration-300">
              <Radio size={24} className="text-text-2 group-hover:text-accent transition-colors duration-300" />
            </div>
            <div className="text-lg font-semibold text-text-0 font-sans mb-1">Connect to Remote</div>
            <div className="text-sm text-text-2 font-sans">SSH tunnel to a server running Groove</div>
            <div className="flex items-center gap-1 text-xs text-accent font-sans mt-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              Setup connection <ArrowRight size={12} />
            </div>
          </button>
        </div>

        {/* ── Content Grid ──────────────────────────────────── */}
        {hasContent && (
          <div className={cn(
            'w-full max-w-4xl gap-6 mb-14 max-sm:flex max-sm:flex-col max-sm:gap-6',
            hasRecent && hasTunnels ? 'grid grid-cols-2' : 'flex justify-center',
          )}>
            {hasRecent && (
              <div className={cn(!hasTunnels && 'w-full max-w-lg')}>
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={13} className="text-text-3" />
                  <h2 className="text-2xs font-mono text-text-3 uppercase tracking-widest">Recent Projects</h2>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-1/50 overflow-hidden divide-y divide-border-subtle">
                  {visibleProjects.map((project) => (
                    <div
                      key={project.path}
                      className="group flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center flex-shrink-0 group-hover:bg-accent/10 transition-colors">
                        <FolderOpen size={14} className="text-text-3 group-hover:text-accent transition-colors" />
                      </div>
                      <button
                        onClick={() => setProjectDir(project.path)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="text-sm font-medium text-text-1 group-hover:text-accent truncate transition-colors font-sans">
                          {project.name}
                        </div>
                        <div className="text-2xs font-mono text-text-4 truncate">{project.path}</div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeRecentProject(project.path); }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-danger cursor-pointer transition-all flex-shrink-0"
                        title="Remove from recent"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasTunnels && (
              <div className={cn(!hasRecent && 'w-full max-w-lg')}>
                <div className="flex items-center gap-2 mb-3">
                  <Server size={13} className="text-text-3" />
                  <h2 className="text-2xs font-mono text-text-3 uppercase tracking-widest">SSH Connections</h2>
                </div>
                <div className="rounded-xl border border-border-subtle bg-surface-1/50 overflow-hidden divide-y divide-border-subtle">
                  {savedTunnels.map((server) => (
                    <div
                      key={server.id}
                      className={cn(
                        'group flex items-center gap-3 px-4 py-3 hover:bg-surface-2/50 transition-colors',
                        connectingId === server.id && 'opacity-60 pointer-events-none',
                      )}
                    >
                      <div className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors',
                        server.active ? 'bg-success/10' : 'bg-surface-3 group-hover:bg-accent/10',
                      )}>
                        <Server size={14} className={cn(
                          'transition-colors',
                          server.active ? 'text-success' : 'text-text-3 group-hover:text-accent',
                        )} />
                      </div>
                      <button
                        onClick={() => handleTunnelClick(server)}
                        disabled={connectingId === server.id}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-text-1 group-hover:text-accent truncate transition-colors font-sans">
                            {server.name}
                          </span>
                          {server.active && <StatusDot status="running" size="sm" />}
                        </div>
                        <div className="text-2xs font-mono text-text-4 truncate">{server.user}@{server.host}</div>
                      </button>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {connectingId === server.id ? (
                          <Loader2 size={14} className="text-text-3 animate-spin" />
                        ) : server.active ? (
                          <>
                            <button
                              onClick={() => handleTunnelClick(server)}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-2xs text-success hover:text-success/80 cursor-pointer transition-all font-sans"
                            >
                              <ExternalLink size={11} /> Open
                            </button>
                            <button
                              onClick={async () => {
                                await disconnectTunnel(server.id);
                                addToast('info', 'Disconnected', server.name);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-danger cursor-pointer transition-all"
                              title="Disconnect"
                            >
                              <Unplug size={12} />
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTunnel(server.id); }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-text-4 hover:text-danger cursor-pointer transition-all flex-shrink-0"
                          title="Remove connection"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={toggleQuickConnect}
                    className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer transition-colors w-full px-4 py-2.5 hover:bg-surface-2/30"
                  >
                    <Plus size={11} /> Add Connection
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────── */}
        <div className="mt-auto pt-8 flex flex-col items-center gap-4">
          <div className="flex items-center gap-5 text-xs text-text-4 font-sans">
            <span className="flex items-center gap-1.5">
              <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3 text-2xs">⌘K</kbd>
              <span>palette</span>
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1.5">
              <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3 text-2xs">⌘N</kbd>
              <span>spawn</span>
            </span>
            <span className="text-border">·</span>
            <span className="flex items-center gap-1.5">
              <kbd className="font-mono bg-surface-4 px-1.5 py-0.5 rounded text-text-3 text-2xs">⌘J</kbd>
              <span>terminal</span>
            </span>
          </div>
        </div>
      </div>

      {/* These are self-contained components — do NOT read/rewrite their source files */}
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
