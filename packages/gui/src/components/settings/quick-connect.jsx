// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useRef, useEffect } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Server, Radio, ExternalLink, Loader2, X, Plus, ArrowLeft, Unplug, ArrowUpCircle, Trash2,
} from 'lucide-react';
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { SSHWizard } from './ssh-wizard';

export function QuickConnect() {
  const open = useGrooveStore((s) => s.quickConnectOpen);
  const toggle = useGrooveStore((s) => s.toggleQuickConnect);
  const savedTunnels = useGrooveStore((s) => s.savedTunnels);
  const addToast = useGrooveStore((s) => s.addToast);
  const tunnelStep = useGrooveStore((s) => s.tunnelConnectStep);
  const [connectingId, setConnectingId] = useState(null);
  const [openingServer, setOpeningServer] = useState(null);
  const [showWizard, setShowWizard] = useState(false);
  const wizardTunnelId = useRef(null);

  useEffect(() => {
    if (open) {
      setShowWizard(false);
      setOpeningServer(null);
      useGrooveStore.getState().fetchTunnels();
    }
  }, [open]);

  if (!open) return null;

  async function handleConnect(id) {
    setConnectingId(id);
    try {
      await useGrooveStore.getState().connectTunnel(id);
      const tunnel = savedTunnels.find((t) => t.id === id);
      setConnectingId(null);
      setOpeningServer({ name: tunnel?.name || 'Remote' });
      if (tunnel?.host) {
        addToast('info', `Add ${tunnel.host} to Federation Whitelist?`, '', {
          label: 'Add',
          onClick: () => useGrooveStore.getState().addToWhitelist(tunnel.host),
        });
      }
      setTimeout(() => { setOpeningServer(null); toggle(); }, 4000);
      return;
    } catch (err) {
      const detail = err?.message || 'Unknown error';
      const isSetupIssue = /permission|EACCES|sudo|Node\.js is not installed|npm install failed|write access/i.test(detail);
      if (isSetupIssue) {
        const tunnel = savedTunnels.find((t) => t.id === id);
        if (tunnel) {
          wizardTunnelId.current = tunnel.id;
          setShowWizard(true);
          addToast('warning', 'Remote setup needed', 'Follow the instructions to set up the remote server.');
        }
      } else {
        let msg = detail;
        if (msg.toLowerCase().includes('port forward')) {
          msg += ' — Try testing the connection first, or check your SSH key configuration.';
        }
        addToast('error', 'Connection failed', msg);
      }
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
            'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-[#24282f] border border-[#2c313a] rounded-lg shadow-2xl overflow-hidden',
            showWizard ? 'w-[680px]' : 'w-[480px]',
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#2c313a]">
            <div className="flex items-center gap-3">
              {showWizard && (
                <button
                  onClick={() => setShowWizard(false)}
                  className="p-1.5 -ml-1 text-[#6e7681] hover:text-[#e6e8ed] cursor-pointer transition-colors"
                >
                  <ArrowLeft size={16} />
                </button>
              )}
              <Radio size={17} className="text-[#33afbc]" />
              <span className="text-base font-semibold text-[#e6e8ed]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif", letterSpacing: '-0.2px' }}>
                {showWizard ? (wizardTunnelId.current ? 'Connection Setup' : 'Add Connection') : 'Quick Connect'}
              </span>
            </div>
            <button onClick={handleClose} className="p-1.5 text-[#6e7681] hover:text-[#e6e8ed] cursor-pointer transition-colors">
              <X size={16} />
            </button>
          </div>

          {openingServer ? (
            <div className="px-6 py-12 text-center">
              <div className="relative w-14 h-14 mx-auto mb-5">
                <span className="absolute inset-0 rounded-full border-2 border-[#33afbc]/20 animate-ping" style={{ animationDuration: '2s' }} />
                <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#33afbc] animate-spin" style={{ animationDuration: '1s' }} />
                <span className="absolute inset-[6px] rounded-full bg-[#33afbc]/8 flex items-center justify-center">
                  <Server size={18} className="text-[#33afbc]" />
                </span>
              </div>
              <p className="text-base font-semibold text-[#e6e8ed] mb-1.5" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}>
                Opening {openingServer.name}
              </p>
              <p className="text-sm text-[#6e7681]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}>
                Loading remote dashboard...
              </p>
              <button
                onClick={() => { setOpeningServer(null); toggle(); }}
                className="mt-6 text-xs text-[#6e7681] hover:text-[#e6e8ed] cursor-pointer transition-colors"
                style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}
              >
                Dismiss
              </button>
            </div>
          ) : showWizard ? (
            <SSHWizard
              server={wizardTunnelId.current ? savedTunnels.find((t) => t.id === wizardTunnelId.current) || null : null}
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
              <div className="overflow-y-auto max-h-[400px] py-2">
                {savedTunnels.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <Server size={32} className="text-[#6e7681] mx-auto mb-3" />
                    <p className="text-base font-semibold text-[#e6e8ed]" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}>No saved servers</p>
                    <p className="text-xs text-[#6e7681] mt-1.5" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}>Add a connection to get started.</p>
                    <button
                      onClick={() => { wizardTunnelId.current = null; setShowWizard(true); }}
                      className="inline-flex items-center gap-1.5 h-9 px-5 mt-4 rounded bg-[#33afbc] text-[#0a0c10] text-sm font-semibold cursor-pointer transition-opacity hover:opacity-90"
                      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}
                    >
                      <Plus size={14} /> Add Connection
                    </button>
                  </div>
                ) : (
                  savedTunnels.map((server) => (
                    <div
                      key={server.id}
                      className={cn(
                        'w-full flex items-center gap-4 px-5 py-3.5 transition-colors',
                        'hover:bg-[#2c313a]',
                        connectingId === server.id && 'opacity-60 pointer-events-none',
                      )}
                    >
                      <div className={cn(
                        'w-10 h-10 rounded flex items-center justify-center flex-shrink-0',
                        server.active ? 'bg-[#33afbc]/10' : 'bg-[rgba(255,255,255,0.04)]',
                      )}>
                        <Server size={18} className={server.active ? 'text-[#33afbc]' : 'text-[#8b95a5]'} />
                      </div>
                      <button
                        onClick={() => server.active ? handleOpenRemote(server) : handleConnect(server.id)}
                        disabled={connectingId === server.id}
                        className="flex-1 min-w-0 text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-[#e6e8ed] truncate" style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif", letterSpacing: '-0.2px' }}>{server.name}</span>
                          {server.active && <StatusDot status="running" size="sm" />}
                          {server.remoteVersion && (
                            <span className="text-xs text-[#6e7681] ml-1" style={{ fontFamily: "ui-monospace, 'SF Mono', Monaco, monospace" }}>v{server.remoteVersion}</span>
                          )}
                        </div>
                        <span className="text-xs text-[#6e7681]" style={{ fontFamily: "ui-monospace, 'SF Mono', Monaco, monospace" }}>{server.user}@{server.host}</span>
                      </button>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {connectingId === server.id ? (
                          <div className="flex items-center gap-1.5">
                            <Loader2 size={14} className="text-text-3 animate-spin" />
                            {tunnelStep?.id === server.id && tunnelStep?.step && (
                              <span className="text-2xs text-text-3 font-sans">
                                {{ testing: 'Testing…', installing: 'Installing…', checking: 'Checking for updates…', upgrading: 'Updating remote…', starting: 'Starting daemon…', connecting: 'Connecting…', forwarding: 'Establishing tunnel…' }[tunnelStep.step] || tunnelStep.step}
                              </span>
                            )}
                          </div>
                        ) : server.active ? (
                          <>
                            <button
                              onClick={() => handleOpenRemote(server)}
                              className="flex items-center gap-1 text-2xs text-success font-sans hover:text-success/80 cursor-pointer transition-colors"
                            >
                              <ExternalLink size={11} /> Open
                            </button>
                            {server.versionMatch === false && (
                              <button
                                onClick={async () => {
                                  try {
                                    await useGrooveStore.getState().upgradeTunnel(server.id);
                                    addToast('success', 'Upgrade started');
                                  } catch (err) {
                                    addToast('error', 'Upgrade failed', err.message);
                                  }
                                }}
                                className="flex items-center gap-1 text-2xs text-warning font-sans hover:text-warning/80 cursor-pointer transition-colors"
                                title={`Update remote from v${server.remoteVersion} to v${server.localVersion}`}
                              >
                                <ArrowUpCircle size={11} /> Update
                              </button>
                            )}
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
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useGrooveStore.getState().deleteTunnel(server.id);
                              }}
                              className="p-1 text-text-4 hover:text-danger cursor-pointer transition-colors rounded"
                              title="Delete connection"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => handleConnect(server.id)}
                              className="text-2xs text-text-3 font-sans hover:text-text-1 cursor-pointer transition-colors"
                            >
                              Connect
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                useGrooveStore.getState().deleteTunnel(server.id);
                              }}
                              className="p-1 text-text-4 hover:text-danger cursor-pointer transition-colors rounded"
                              title="Delete connection"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer with Add button */}
              <div className="px-5 py-3.5 border-t border-[#2c313a]">
                <button
                  onClick={() => { wizardTunnelId.current = null; setShowWizard(true); }}
                  className="flex items-center gap-2 text-sm text-[#33afbc] hover:opacity-80 font-semibold cursor-pointer transition-opacity"
                  style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif" }}
                >
                  <Plus size={14} /> Add new connection
                </button>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
