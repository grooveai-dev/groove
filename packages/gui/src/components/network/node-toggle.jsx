// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { Tooltip } from '../ui/tooltip';
import { Copy, Check, Cpu } from 'lucide-react';

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function nodeStatus(node) {
  if (node.active && node.status === 'connected') return 'running';
  if (node.status === 'connecting') return 'starting';
  return 'crashed';
}

function Toggle({ value, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!value)}
      disabled={disabled}
      className={cn(
        'relative inline-flex h-7 w-12 rounded-full p-0.5 transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        value ? 'bg-accent' : 'bg-surface-5',
      )}
    >
      <span
        className={cn(
          'inline-block h-6 w-6 rounded-full bg-white shadow-sm transition-transform',
          value ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function NodeToggle() {
  const node = useGrooveStore((s) => s.networkNode);
  const startNetworkNode = useGrooveStore((s) => s.startNetworkNode);
  const stopNetworkNode = useGrooveStore((s) => s.stopNetworkNode);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleToggle(next) {
    setPending(true);
    try {
      if (next) await startNetworkNode();
      else await stopNetworkNode();
    } catch { /* toasted in store */ }
    setPending(false);
  }

  async function handleCopy() {
    if (!node.nodeId) return;
    try {
      await navigator.clipboard.writeText(node.nodeId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  const active = !!node.active;
  const hardware = node.hardware || {};
  const layersLabel = Array.isArray(node.layers)
    ? `layers ${node.layers[0]}-${node.layers[1]}`
    : (node.layers && node.layers.start != null)
      ? `layers ${node.layers.start}-${node.layers.end}`
      : 'unassigned';
  const modelLabel = node.model || 'No model assigned';
  const memPct = Number.isFinite(node.memoryPct) ? node.memoryPct : null;

  return (
    <div className="rounded-lg border border-border bg-surface-1 overflow-hidden">
      {/* Hero toggle */}
      <div className="flex items-center gap-4 px-5 py-4 border-b border-border-subtle">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-text-0 font-sans">Lend Compute</div>
          <div className="text-2xs text-text-3 font-sans mt-0.5">
            {active ? 'Contributing to the Groove network' : 'Your machine can contribute to the Groove network'}
          </div>
        </div>
        <Toggle value={active} onChange={handleToggle} disabled={pending} />
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {!active ? (
          <div>
            <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-2">Detected hardware</div>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2">
                <div className="text-2xs text-text-4 font-sans">Device</div>
                <div className="text-xs font-mono text-text-1 truncate">{hardware.device || 'auto'}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2">
                <div className="text-2xs text-text-4 font-sans">Memory</div>
                <div className="text-xs font-mono text-text-1 truncate">{hardware.memory || '—'}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2">
                <div className="text-2xs text-text-4 font-sans">GPU</div>
                <div className="text-xs font-mono text-text-1 truncate">{hardware.gpu || 'None'}</div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Status row */}
            <div className="flex items-center gap-3">
              <StatusDot status={nodeStatus(node)} />
              <div className="text-xs font-sans text-text-1 capitalize">{node.status || 'disconnected'}</div>
              <div className="flex-1" />
              <Badge variant="accent" className="font-mono">
                <Cpu size={9} /> {modelLabel} · {layersLabel}
              </Badge>
            </div>

            {/* Identity */}
            {node.nodeId && (
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2.5">
                <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-1.5">Your Node Identity</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 h-8 px-2.5 flex items-center bg-surface-1 border border-border-subtle rounded-md text-xs font-mono text-text-1">
                    {shortAddress(node.nodeId)}
                  </code>
                  <Tooltip content={copied ? 'Copied' : 'Copy full address'} side="top">
                    <button
                      onClick={handleCopy}
                      className="h-8 w-8 inline-flex items-center justify-center rounded-md border border-border-subtle bg-surface-1 text-text-3 hover:text-accent hover:border-accent/40 cursor-pointer transition-colors"
                    >
                      {copied ? <Check size={12} /> : <Copy size={12} />}
                    </button>
                  </Tooltip>
                </div>
                <div className="mt-1.5 text-2xs font-sans text-text-4">This is your network wallet address</div>
              </div>
            )}

            {/* Sessions + memory */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2">
                <div className="text-2xs text-text-4 font-sans uppercase tracking-wider">Active Sessions</div>
                <div className="text-lg font-mono text-text-0 tabular-nums leading-tight">{node.sessions || 0}</div>
              </div>
              <div className="rounded-md border border-border-subtle bg-surface-0 px-3 py-2">
                <div className="text-2xs text-text-4 font-sans uppercase tracking-wider mb-1">Memory</div>
                {memPct != null ? (
                  <>
                    <div className="h-1.5 w-full rounded-full bg-surface-3 overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          memPct >= 90 ? 'bg-danger' : memPct >= 70 ? 'bg-warning' : 'bg-accent',
                        )}
                        style={{ width: `${Math.min(100, Math.max(0, memPct))}%` }}
                      />
                    </div>
                    <div className="mt-1 text-2xs font-mono text-text-3 tabular-nums">{Math.round(memPct)}%</div>
                  </>
                ) : (
                  <div className="text-xs font-mono text-text-3">—</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
