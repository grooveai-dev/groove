// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Server, Radio, ExternalLink, Loader2, X, Plus, Settings,
} from 'lucide-react';
import { StatusDot } from '../ui/status-dot';

export function QuickConnect() {
  const open = useGrooveStore((s) => s.quickConnectOpen);
  const toggle = useGrooveStore((s) => s.toggleQuickConnect);
  const savedTunnels = useGrooveStore((s) => s.savedTunnels);
  const [connectingId, setConnectingId] = useState(null);

  if (!open) return null;

  async function handleConnect(id) {
    setConnectingId(id);
    try {
      await useGrooveStore.getState().connectTunnel(id);
      toggle();
    } catch {}
    setConnectingId(null);
  }

  function handleOpenRemote(server) {
    const port = server.localPort;
    const name = encodeURIComponent(server.name);
    window.open(`http://localhost:${port}?instance=${name}`, '_blank');
    toggle();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={toggle} />

      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className="fixed top-[20%] left-1/2 -translate-x-1/2 z-50 w-[400px] bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              <Radio size={15} className="text-accent" />
              <span className="text-sm font-semibold text-text-0 font-sans">Quick Connect</span>
            </div>
            <button onClick={toggle} className="p-1 text-text-4 hover:text-text-1 cursor-pointer transition-colors">
              <X size={14} />
            </button>
          </div>

          {/* Server list */}
          <div className="overflow-y-auto max-h-[320px] py-1">
            {savedTunnels.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Server size={24} className="text-text-4 mx-auto mb-2" />
                <p className="text-sm text-text-3 font-sans">No saved servers</p>
                <p className="text-2xs text-text-4 font-sans mt-1">Add one in Settings to get started.</p>
                <button
                  onClick={() => {
                    toggle();
                    useGrooveStore.getState().setActiveView('settings');
                  }}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 font-sans cursor-pointer transition-colors"
                >
                  <Settings size={12} /> Go to Settings
                </button>
              </div>
            ) : (
              savedTunnels.map((server) => (
                <button
                  key={server.id}
                  onClick={() => server.active ? handleOpenRemote(server) : handleConnect(server.id)}
                  disabled={connectingId === server.id}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left cursor-pointer transition-colors',
                    'hover:bg-surface-5',
                    connectingId === server.id && 'opacity-60 pointer-events-none',
                  )}
                >
                  <Server size={15} className={server.active ? 'text-success' : 'text-text-4'} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-0 font-sans truncate">{server.name}</span>
                      {server.active && <StatusDot status="running" size="sm" />}
                    </div>
                    <span className="text-2xs text-text-4 font-mono">{server.user}@{server.host}</span>
                  </div>
                  <div className="flex-shrink-0">
                    {connectingId === server.id ? (
                      <Loader2 size={14} className="text-text-3 animate-spin" />
                    ) : server.active ? (
                      <span className="flex items-center gap-1 text-2xs text-success font-sans">
                        <ExternalLink size={11} /> Open
                      </span>
                    ) : (
                      <span className="text-2xs text-text-3 font-sans">Connect</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          {savedTunnels.length > 0 && (
            <div className="px-4 py-2 border-t border-border-subtle">
              <button
                onClick={() => {
                  toggle();
                  useGrooveStore.getState().setActiveView('settings');
                }}
                className="flex items-center gap-1.5 text-2xs text-text-4 hover:text-text-2 font-sans cursor-pointer transition-colors"
              >
                <Plus size={10} /> Manage servers in Settings
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
