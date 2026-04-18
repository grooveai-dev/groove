// FSL-1.1-Apache-2.0 — see LICENSE
import { Terminal, BookOpen, Radio, Plug, Globe, ArrowUpCircle, X, Unplug } from 'lucide-react';
import { cn } from '../../lib/cn';
import { StatusDot } from '../ui/status-dot';
import { fmtUptime } from '../../lib/format';
import { useGrooveStore } from '../../stores/groove';
import { isElectron, openExternal } from '../../lib/electron';

export function StatusBar({
  connected,
  agentCount,
  runningCount,
  uptime,
  terminalVisible,
  onToggleTerminal,
}) {
  const savedTunnels = useGrooveStore((s) => s.savedTunnels);
  const tunneled = useGrooveStore((s) => s.tunneled);
  const version = useGrooveStore((s) => s.version);
  const updateReady = useGrooveStore((s) => s.updateReady);
  const installUpdate = useGrooveStore((s) => s.installUpdate);
  const subscription = useGrooveStore((s) => s.subscription);
  const navigate = useGrooveStore((s) => s.setActiveView);
  const activeTunnel = savedTunnels.find((t) => t.active);
  const electron = isElectron();

  return (
    <footer className="h-6 flex-shrink-0 flex items-center px-3 bg-surface-3 border-t border-border text-2xs font-sans select-none">
      {/* Left: connection + stats */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <StatusDot status={connected ? 'running' : 'crashed'} size="sm" />
          <span className={connected ? 'text-text-2' : 'text-danger'}>
            {connected ? (electron ? 'Desktop' : 'Connected') : 'Offline'}
          </span>
        </div>
        {electron && connected && (
          <button
            onClick={() => openExternal(window.location.href)}
            className="flex items-center gap-1 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
            title="Open this workspace in your browser"
          >
            <Globe size={10} />
            <span>Browser</span>
          </button>
        )}
        {connected && uptime > 0 && (
          <span className="text-text-4">Up {fmtUptime(uptime)}</span>
        )}
        {connected && agentCount > 0 && (
          <span className="text-text-4">{runningCount}/{agentCount} agents</span>
        )}
        {activeTunnel ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const port = activeTunnel.localPort;
                const name = encodeURIComponent(activeTunnel.name);
                openExternal(`http://localhost:${port}?instance=${name}`);
              }}
              className="flex items-center gap-1.5 text-text-3 hover:text-text-1 cursor-pointer transition-colors"
              title="Open remote GUI"
            >
              <Radio size={10} className="text-success" />
              <span>{activeTunnel.name}</span>
              <span className="w-1.5 h-1.5 rounded-full bg-success" />
              {activeTunnel.latencyMs != null && (
                <span className="text-text-4">{activeTunnel.latencyMs}ms</span>
              )}
            </button>
            <button
              onClick={() => useGrooveStore.getState().disconnectTunnel(activeTunnel.id)}
              className="p-0.5 text-text-4 hover:text-danger cursor-pointer transition-colors rounded"
              title="Disconnect"
            >
              <X size={10} />
            </button>
          </div>
        ) : tunneled ? (
          <button
            onClick={() => window.groove?.remote?.close?.() || window.close()}
            className="flex items-center gap-1.5 text-text-3 hover:text-danger cursor-pointer transition-colors"
            title="Close remote connection"
          >
            <Unplug size={10} />
            <span>Disconnect</span>
          </button>
        ) : savedTunnels.length > 0 && (
          <button
            onClick={() => useGrooveStore.getState().toggleQuickConnect()}
            className="flex items-center gap-1.5 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
            title="Quick Connect to remote server"
          >
            <Plug size={10} />
            <span>Connect</span>
          </button>
        )}
        {subscription?.active && (subscription.plan === 'pro' || subscription.plan === 'team') && (
          <button
            onClick={() => navigate('federation')}
            className="flex items-center gap-1.5 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
            title="Federation"
          >
            <Globe size={10} />
            <span>Federation</span>
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Right: version + docs + terminal toggle */}
      {updateReady ? (
        <button
          onClick={installUpdate}
          className="flex items-center gap-1.5 px-2 h-full text-success hover:bg-success/10 transition-colors cursor-pointer"
          title={`Update to v${updateReady}`}
        >
          <ArrowUpCircle size={12} />
          <span>v{updateReady}</span>
        </button>
      ) : version ? (
        <span className="text-text-4 px-2">v{version}</span>
      ) : null}
      {!electron && (
        <a
          href="https://docs.groovedev.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-2 h-full text-text-3 hover:text-text-1 hover:bg-surface-5 transition-colors no-underline"
        >
          <BookOpen size={12} />
          <span>Docs</span>
        </a>
      )}
      <button
        onClick={onToggleTerminal}
        className={cn(
          'flex items-center gap-1.5 px-2 h-full transition-colors cursor-pointer',
          terminalVisible
            ? 'text-accent bg-accent/8 hover:bg-accent/12'
            : 'text-text-3 hover:text-text-1 hover:bg-surface-5',
        )}
      >
        <Terminal size={12} />
        <span>Terminal</span>
        <kbd className="font-mono text-text-4 ml-0.5">Cmd+J</kbd>
      </button>
    </footer>
  );
}
