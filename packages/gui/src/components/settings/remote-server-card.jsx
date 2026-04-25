// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { useGrooveStore } from '../../stores/groove';
import { fmtUptime } from '../../lib/format';
import { cn } from '../../lib/cn';
import {
  Plug, PlugZap, Pencil, Trash2, Loader2, Check, X, AlertTriangle,
  ExternalLink, Download, Play,
} from 'lucide-react';

export function RemoteServerCard({ server, onEdit, onDelete, onConnect, onDisconnect, onTest }) {
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStep, setConnectStep] = useState(null);

  // Listen for tunnel.status WebSocket events for progress updates
  useEffect(() => {
    function handleWs(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tunnel.status' && msg.data?.id === server.id) {
          setConnectStep(msg.data.step);
        }
      } catch {}
    }
    const ws = useGrooveStore.getState().ws;
    if (ws) ws.addEventListener('message', handleWs);
    return () => { if (ws) ws.removeEventListener('message', handleWs); };
  }, [server.id]);

  async function handleTest() {
    setTestLoading(true);
    setTestResult(null);
    try {
      const result = await onTest();
      setTestResult(result);
    } catch (err) {
      setTestResult({ error: err.message || 'Test failed' });
    }
    setTestLoading(false);
  }

  async function handleConnect() {
    setConnecting(true);
    setConnectStep(null);
    setTestResult(null);
    try {
      await onConnect();
      setConnectStep(null);
    } catch (err) {
      const tr = err?.testResult || err?.body?.testResult;
      if (tr) {
        setTestResult(tr);
      } else {
        setTestResult({ error: err?.body?.error || err?.message || 'Connection failed' });
      }
      setConnectStep(null);
    }
    setConnecting(false);
  }

  async function handleDisconnect() {
    setConnecting(true);
    try {
      await onDisconnect();
    } catch {}
    setConnecting(false);
  }

  function handleOpenRemote() {
    const port = server.localPort;
    const name = encodeURIComponent(server.name);
    window.open(`http://localhost:${port}?instance=${name}`, '_blank');
  }

  const connectLabel = connectStep === 'installing'
    ? 'Installing Groove...'
    : connectStep === 'starting'
      ? 'Starting daemon...'
      : connectStep === 'forwarding'
        ? 'Establishing tunnel...'
        : connecting
          ? 'Connecting...'
          : 'Connect';

  const uptimeSeconds = server.active && server.startedAt
    ? Math.floor((Date.now() - new Date(server.startedAt).getTime()) / 1000)
    : 0;

  return (
    <div className={cn(
      'rounded-lg border bg-surface-2 p-4',
      server.active ? 'border-success/40' : 'border-border-subtle',
    )}>
      {/* Top row: name + status */}
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[13px] font-semibold text-text-0 font-sans">{server.name}</span>
        {server.active ? (
          <Badge variant="success" className="text-2xs gap-1">
            <StatusDot status="running" size="sm" /> Connected
          </Badge>
        ) : (
          <Badge variant="default" className="text-2xs">Disconnected</Badge>
        )}
      </div>

      {/* Connection string */}
      <div className="text-xs text-text-3 font-mono mb-1">
        {server.user}@{server.host}:{server.port || 22}
      </div>

      {/* SSH key */}
      {server.sshKeyDisplay && (
        <div className="text-2xs text-text-4 font-mono truncate mb-2">
          Key: {server.sshKeyDisplay}
        </div>
      )}

      {/* Active connection stats */}
      {server.active && (
        <div className="flex items-center gap-3 text-2xs text-text-3 font-sans mb-2">
          {uptimeSeconds > 0 && <span>Uptime: {fmtUptime(uptimeSeconds)}</span>}
          {server.latencyMs != null && <span>Latency: {server.latencyMs}ms</span>}
          {server.localPort && <span>Port: {server.localPort}</span>}
        </div>
      )}

      {/* Connected instance explanation */}
      {server.active && (
        <div className="text-2xs text-text-4 bg-surface-1 rounded px-2.5 py-1.5 mb-3">
          Separate Groove instance on your remote server. Local teams are not affected.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2">
        {server.active ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenRemote}
              className="h-7 text-2xs gap-1"
            >
              <ExternalLink size={11} />
              Open Remote GUI
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={connecting}
              className="h-7 text-2xs text-danger hover:text-danger gap-1"
            >
              <Plug size={11} />
              {connecting ? 'Disconnecting...' : 'Disconnect'}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={handleConnect}
              disabled={connecting}
              className="h-7 text-2xs gap-1"
            >
              {connecting ? <Loader2 size={11} className="animate-spin" /> : <PlugZap size={11} />}
              {connectLabel}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={testLoading || connecting}
              className="h-7 text-2xs text-text-3 gap-1"
            >
              {testLoading ? <Loader2 size={11} className="animate-spin" /> : <PlugZap size={11} />}
              Test
            </Button>
          </>
        )}
        <div className="flex-1" />
        {!server.active && (
          <>
            <button
              onClick={() => onEdit(server)}
              className="p-1.5 text-text-4 hover:text-text-1 cursor-pointer transition-colors"
              title="Edit"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => onDelete(server.id)}
              className="p-1.5 text-text-4 hover:text-danger cursor-pointer transition-colors"
              title="Delete"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>

      {/* Inline test result */}
      {testResult && !connecting && (
        <div className={cn(
          'mt-2 px-3 py-2 rounded-md text-2xs font-sans flex items-start gap-2',
          testResult.error
            ? 'bg-danger/8 border border-danger/20 text-danger'
            : testResult.reachable
              ? 'bg-success/8 border border-success/20 text-success'
              : 'bg-warning/8 border border-warning/20 text-warning',
        )}>
          {testResult.error ? (
            <><X size={11} className="mt-0.5 flex-shrink-0" /> {testResult.error}</>
          ) : testResult.reachable ? (
            <>
              <Check size={11} className="mt-0.5 flex-shrink-0" />
              <span>
                {testResult.daemonRunning
                  ? 'Connected. Groove running.'
                  : testResult.grooveInstalled
                    ? 'Connected. Groove installed but stopped.'
                    : 'Connected. Groove not installed.'}
                {!testResult.daemonRunning && ' Click Connect to set up automatically.'}
              </span>
            </>
          ) : (
            <><AlertTriangle size={11} className="mt-0.5 flex-shrink-0" /> Host unreachable</>
          )}
          <button
            onClick={() => setTestResult(null)}
            className="ml-auto text-text-4 hover:text-text-1 cursor-pointer flex-shrink-0"
          >
            <X size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
