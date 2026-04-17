// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Server, Radio, ExternalLink, Loader2, X, Plus, ArrowLeft, Unplug,
} from 'lucide-react';
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { SSHWizard } from './ssh-wizard';

export function QuickConnect() {
  const open = useGrooveStore((s) => s.quickConnectOpen);
  const toggle = useGrooveStore((s) => s.toggleQuickConnect);
  const savedTunnels = useGrooveStore((s) => s.savedTunnels);
  const addToast = useGrooveStore((s) => s.addToast);
  const [connectingId, setConnectingId] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const wizardTunnelId = useRef(null);

  if (!open) return null;

  async function handleConnect(id) {
    setConnectingId(id);
    try {
      await useGrooveStore.getState().connectTunnel(id);
      toggle();
    } catch (err) {
      addToast('error', 'Connection failed', err?.message || 'Unknown error');
    }
    setConnectingId(null);
  }

  function handleOpenRemote(server) {
    if (window.groove?.remote?.openWindow) {
      window.groove.remote.openWindow(server.localPort, server.name);
    } else {
      const name = encodeURIComponent(server.name);
      window.open(`http://localhost:${server.localPort}?instance=${name}`, '_blank');
    }
    toggle();
  }

  function handleClose() {
    setShowWizard(false);
    toggle();
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={handleClose} />

      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, y: -20, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -10, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          className={cn(
            'fixed top-[15%] left-1/2 -translate-x-1/2 z-50 bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden',
            showWizard ? 'w-[520px]' : 'w-[400px]',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
            <div className="flex items-center gap-2">
              {showWizard && (
                <button
                  onClick={() => setShowWizard(false)}
                  className="p-1 -ml-1 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
                >
                  <ArrowLeft size={14} />
                </button>
              )}
              <Radio size={15} className="text-accent" />
              <span className="text-sm font-semibold text-text-0 font-sans">
                {showWizard ? 'Add Connection' : 'Quick Connect'}
              </span>
            </div>
            <button onClick={handleClose} className="p-1 text-text-4 hover:text-text-1 cursor-pointer transition-colors">
              <X size={14} />
            </button>
          </div>

          {showWizard ? (
            <SSHWizard
              server={null}
              onSave={async (data) => {
                const existingId = data.id || wizardTunnelId.current;
                if (existingId) {
                  await useGrooveStore.getState().updateTunnel(existingId, data);
                  addToast('success', 'Server updated');
                } else {
                  const result = await useGrooveStore.getState().saveTunnel(data);
                  if (result?.id) wizardTunnelId.current = result.id;
                  addToast('success', 'Server added');
                }
              }}
              onTest={() => {
                const id = wizardTunnelId.current;
                if (id) return useGrooveStore.getState().testTunnel(id);
              }}
              onConnect={() => {
                const id = wizardTunnelId.current;
                if (id) return useGrooveStore.getState().connectTunnel(id);
              }}
              onCancel={() => {
                wizardTunnelId.current = null;
                setShowWizard(false);
              }}
            />
          ) : (
            <>
              {/* Server list */}
              <div className="overflow-y-auto max-h-[320px] py-1">
                {savedTunnels.length === 0 ? (
                  <div className="px-4 py-8 text-center">
                    <Server size={24} className="text-text-4 mx-auto mb-2" />
                    <p className="text-sm text-text-3 font-sans">No saved servers</p>
                    <p className="text-2xs text-text-4 font-sans mt-1">Add a connection to get started.</p>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => { wizardTunnelId.current = null; setShowWizard(true); }}
                      className="h-8 text-xs gap-1.5 mt-3"
                    >
                      <Plus size={12} /> Add Connection
                    </Button>
                  </div>
                ) : (
                  savedTunnels.map((server) => (
                    <div
                      key={server.id}
                      className={cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 transition-colors',
                        'hover:bg-surface-5',
                        connectingId === server.id && 'opacity-60 pointer-events-none',
                      )}
                    >
                      <Server size={15} className={server.active ? 'text-success' : 'text-text-4'} />
                      <button
                        onClick={() => server.active ? handleOpenRemote(server) : handleConnect(server.id)}
                        disabled={connectingId === server.id}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-text-0 font-sans truncate">{server.name}</span>
                          {server.active && <StatusDot status="running" size="sm" />}
                        </div>
                        <span className="text-2xs text-text-4 font-mono">{server.user}@{server.host}</span>
                      </button>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {connectingId === server.id ? (
                          <Loader2 size={14} className="text-text-3 animate-spin" />
                        ) : server.active ? (
                          <>
                            <button
                              onClick={() => handleOpenRemote(server)}
                              className="flex items-center gap-1 text-2xs text-success font-sans hover:text-success/80 cursor-pointer transition-colors"
                            >
                              <ExternalLink size={11} /> Open
                            </button>
                            <button
                              onClick={async () => {
                                await useGrooveStore.getState().disconnectTunnel(server.id);
                                addToast('info', 'Disconnected', server.name);
                              }}
                              className="p-1 text-text-4 hover:text-danger cursor-pointer transition-colors rounded"
                              title="Disconnect"
                            >
                              <Unplug size={12} />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => handleConnect(server.id)}
                            className="text-2xs text-text-3 font-sans hover:text-text-1 cursor-pointer transition-colors"
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer with Add button */}
              <div className="px-4 py-2.5 border-t border-border-subtle">
                <button
                  onClick={() => { wizardTunnelId.current = null; setShowWizard(true); }}
                  className="flex items-center gap-1.5 text-2xs text-accent hover:text-accent/80 font-sans font-medium cursor-pointer transition-colors"
                >
                  <Plus size={10} /> Add new connection
                </button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
