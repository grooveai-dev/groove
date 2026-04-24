// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { cn } from '../../lib/cn';
import {
  FolderOpen, Radio, X, Plus, ExternalLink, Loader2, Unplug,
} from 'lucide-react';
import { FolderBrowser } from '../agents/folder-browser';
import { QuickConnect } from '../settings/quick-connect';
import { StatusDot } from '../ui/status-dot';
import { ToastContainer } from '../ui/toast';

export function WelcomeSplash() {
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
  const hasRightContent = hasRecent || hasTunnels;

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
      addToast('error', 'Connection failed', err?.message || 'Unknown error');
    }
    setConnectingId(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: `radial-gradient(ellipse at 50% 40%, ${hexAlpha(HEX.accent, 0.06)} 0%, transparent 70%) ${HEX.surface0}` }}
    >
      <div className={cn(
        'w-full max-w-4xl px-8 flex gap-12',
        hasRightContent ? 'items-start' : 'items-center justify-center',
        'max-md:flex-col max-md:items-center max-md:gap-8 max-md:overflow-y-auto max-md:max-h-[100vh] max-md:py-12',
      )}>
        {/* ── Left Panel ─────────────────────────────────────── */}
        <div className={cn(
          'flex flex-col',
          hasRightContent ? 'w-[55%] max-md:w-full' : 'w-full max-w-lg',
          hasRightContent ? 'pt-[10vh]' : 'items-center text-center',
        )}>
          {/* Hero */}
          <div className={cn('flex items-center gap-4 mb-6', !hasRightContent && 'flex-col')}>
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: hexAlpha(HEX.accent, 0.08),
                border: `1px solid ${hexAlpha(HEX.accent, 0.15)}`,
                boxShadow: `0 0 40px ${hexAlpha(HEX.accent, 0.1)}`,
              }}
            >
              <img src="/favicon.png" className="w-9 h-9 rounded-full" alt="Groove" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-text-0 font-sans tracking-tight">Welcome to Groove</h1>
              <p className="text-sm text-text-2 font-sans mt-0.5">Your AI coding team, ready in minutes</p>
            </div>
          </div>

          {/* Action cards */}
          <div className="flex flex-col gap-3 mt-4 w-full">
            <button
              onClick={() => setBrowsing(true)}
              className="w-full flex items-center gap-4 p-5 rounded-lg border border-accent/25 bg-gradient-to-r from-accent/8 to-accent/3 hover:from-accent/14 hover:to-accent/6 hover:border-accent/40 transition-all cursor-pointer group text-left"
            >
              <div className="w-11 h-11 rounded-lg bg-accent/20 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                <FolderOpen size={22} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-text-0 font-sans">Open Project</div>
                <div className="text-sm text-text-2 font-sans mt-0.5">Browse the filesystem to pick a project</div>
              </div>
            </button>

            <button
              onClick={toggleQuickConnect}
              className="w-full flex items-center gap-4 p-5 rounded-lg border border-border bg-surface-1 hover:bg-surface-2 hover:border-border transition-all cursor-pointer group text-left"
            >
              <div className="w-11 h-11 rounded-lg bg-surface-4 flex items-center justify-center group-hover:scale-110 transition-transform flex-shrink-0">
                <Radio size={22} className="text-text-1" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-semibold text-text-0 font-sans">Connect to Remote</div>
                <div className="text-sm text-text-2 font-sans mt-0.5">SSH tunnel to a server</div>
              </div>
            </button>
          </div>

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

        {/* ── Right Panel ────────────────────────────────────── */}
        {hasRightContent && (
          <div className="w-[45%] max-md:w-full pt-[10vh] max-md:pt-0 min-w-0 max-h-[80vh] overflow-y-auto">
            {/* Recent Projects */}
            {hasRecent && (
              <div>
                <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-2">Recent</div>
                <div className="flex flex-col">
                  {visibleProjects.map((project) => (
                    <div
                      key={project.path}
                      className="group flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-1 transition-colors"
                    >
                      <button
                        onClick={() => setProjectDir(project.path)}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="text-sm font-medium text-text-1 hover:text-accent truncate transition-colors">
                          {project.name}
                        </div>
                        <div className="text-2xs font-mono text-text-4 truncate">{project.path}</div>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); removeRecentProject(project.path); }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-text-4 hover:text-danger cursor-pointer transition-all flex-shrink-0"
                        title="Remove from recent"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Divider */}
            {hasRecent && hasTunnels && (
              <div className="border-t border-border-subtle my-4" />
            )}

            {/* SSH Connections */}
            {hasTunnels && (
              <div>
                <div className="text-2xs font-mono text-text-3 uppercase tracking-widest mb-2">SSH Connections</div>
                <div className="flex flex-col">
                  {savedTunnels.map((server) => (
                    <div
                      key={server.id}
                      className={cn(
                        'group flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-surface-1 transition-colors',
                        connectingId === server.id && 'opacity-60 pointer-events-none',
                      )}
                    >
                      <button
                        onClick={() => handleTunnelClick(server)}
                        disabled={connectingId === server.id}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-text-1 hover:text-accent truncate transition-colors">
                            {server.name}
                          </span>
                          {server.active && <StatusDot status="running" size="sm" />}
                        </div>
                        <div className="text-2xs font-mono text-text-4 truncate">{server.user}@{server.host}</div>
                      </button>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {connectingId === server.id ? (
                          <Loader2 size={14} className="text-text-3 animate-spin" />
                        ) : server.active ? (
                          <>
                            <button
                              onClick={() => handleTunnelClick(server)}
                              className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 text-2xs text-success hover:text-success/80 cursor-pointer transition-all"
                            >
                              <ExternalLink size={11} /> Open
                            </button>
                            <button
                              onClick={async () => {
                                await disconnectTunnel(server.id);
                                addToast('info', 'Disconnected', server.name);
                              }}
                              className="opacity-0 group-hover:opacity-100 p-0.5 text-text-4 hover:text-danger cursor-pointer transition-all"
                              title="Disconnect"
                            >
                              <Unplug size={12} />
                            </button>
                          </>
                        ) : null}
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteTunnel(server.id); }}
                          className="opacity-0 group-hover:opacity-100 p-0.5 text-text-4 hover:text-danger cursor-pointer transition-all flex-shrink-0"
                          title="Remove connection"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  onClick={toggleQuickConnect}
                  className="flex items-center gap-1 text-xs text-accent hover:underline font-sans cursor-pointer mt-2 px-2"
                >
                  <Plus size={12} /> Add Connection
                </button>
              </div>
            )}

            {/* Empty state */}
            {!hasRecent && !hasTunnels && (
              <p className="text-sm text-text-4 italic px-2">No recent activity</p>
            )}
          </div>
        )}
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
