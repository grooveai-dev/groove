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
  ExternalLink, Server, Clock, Activity, KeyRound, Globe, Settings,
} from 'lucide-react';

export function ServerDetail({ server, onEdit, onDelete, onConnect, onDisconnect, onTest }) {
  const [testResult, setTestResult] = useState(null);
  const [testLoading, setTestLoading] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectStep, setConnectStep] = useState(null);

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

  useEffect(() => {
    setTestResult(null);
    setConnectStep(null);
    setConnecting(false);
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
      : connecting
        ? 'Connecting...'
        : 'Connect';

  const uptimeSeconds = server.active && server.startedAt
    ? Math.floor((Date.now() - new Date(server.startedAt).getTime()) / 1000)
    : 0;

  return (
    <div className="p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-8 rounded-lg bg-surface-3 flex items-center justify-center">
          <Server size={14} className="text-text-2" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-text-0 font-sans truncate">{server.name}</h3>
          <span className="text-2xs text-text-3 font-mono">
            {server.user}@{server.host}:{server.port || 22}
          </span>
        </div>
        {server.active ? (
          <Badge variant="success" className="text-2xs gap-1">
            <StatusDot status="running" size="sm" /> Connected
          </Badge>
        ) : (
          <Badge variant="default" className="text-2xs">Disconnected</Badge>
        )}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Connection Info Card */}
        <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
              <Globe size={12} className="text-accent" />
            </div>
            <span className="text-[13px] font-medium text-text-0 font-sans">Connection</span>
          </div>
          <div className="space-y-2 text-2xs font-sans">
            <div className="flex items-center justify-between">
              <span className="text-text-3">Host</span>
              <span className="text-text-0 font-mono">{server.host}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-3">User</span>
              <span className="text-text-0 font-mono">{server.user}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-3">SSH Port</span>
              <span className="text-text-0 font-mono">{server.port || 22}</span>
            </div>
            {server.sshKeyPath && (
              <div className="flex items-center justify-between">
                <span className="text-text-3">SSH Key</span>
                <span className="text-text-0 font-mono truncate max-w-36">{server.sshKeyPath}</span>
              </div>
            )}
          </div>
        </div>

        {/* Status / Stats Card */}
        <div className="rounded-lg border border-border-subtle bg-surface-1 px-4 py-3.5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-accent/8 flex items-center justify-center flex-shrink-0">
              <Settings size={12} className="text-accent" />
            </div>
            <span className="text-[13px] font-medium text-text-0 font-sans">Settings</span>
          </div>
          <div className="space-y-2 text-2xs font-sans">
            <div className="flex items-center justify-between">
              <span className="text-text-3">Auto-start daemon</span>
              <Badge variant={server.autoStart ? 'accent' : 'default'} className="text-2xs">
                {server.autoStart ? 'On' : 'Off'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-text-3">Auto-connect</span>
              <Badge variant={server.autoConnect ? 'accent' : 'default'} className="text-2xs">
                {server.autoConnect ? 'On' : 'Off'}
              </Badge>
            </div>
            {server.active && uptimeSeconds > 0 && (
              <div className="flex items-center justify-between">
                <span className="text-text-3">Uptime</span>
                <span className="text-text-0 font-sans">{fmtUptime(uptimeSeconds)}</span>
              </div>
            )}
            {server.active && server.latencyMs != null && (
              <div className="flex items-center justify-between">
                <span className="text-text-3">Latency</span>
                <span className="text-text-0 font-mono">{server.latencyMs}ms</span>
              </div>
            )}
            {server.active && server.localPort && (
              <div className="flex items-center justify-between">
                <span className="text-text-3">Local Port</span>
                <span className="text-text-0 font-mono">{server.localPort}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-wrap items-center gap-2">
        {server.active ? (
          <>
            <Button
              variant="primary"
              size="sm"
              onClick={handleOpenRemote}
              className="h-8 text-xs gap-1.5"
            >
              <ExternalLink size={12} />
              Open Remote GUI
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDisconnect}
              disabled={connecting}
              className="h-8 text-xs text-danger hover:text-danger gap-1.5"
            >
              <Plug size={12} />
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
              className="h-8 text-xs gap-1.5"
            >
              {connecting ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
              {connectLabel}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleTest}
              disabled={testLoading || connecting}
              className="h-8 text-xs text-text-3 gap-1.5"
            >
              {testLoading ? <Loader2 size={12} className="animate-spin" /> : <PlugZap size={12} />}
              Test
            </Button>
          </>
        )}
        <div className="flex-1" />
        {!server.active && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(server)}
              className="h-8 text-xs text-text-3 gap-1.5"
            >
              <Pencil size={12} />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(server.id)}
              className="h-8 text-xs text-danger hover:text-danger gap-1.5"
            >
              <Trash2 size={12} />
              Delete
            </Button>
          </>
        )}
      </div>

      {/* Inline test result */}
      {testResult && !connecting && (
        <div className={cn(
          'px-3 py-2.5 rounded-lg text-2xs font-sans flex items-start gap-2',
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

      {server.active && (
        <div className="text-2xs text-text-4 bg-surface-1 rounded-lg px-3 py-2 border border-border-subtle">
          Separate Groove instance on your remote server. Local teams are not affected.
        </div>
      )}
    </div>
  );
}
