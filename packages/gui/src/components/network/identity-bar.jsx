// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState, useEffect, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { fmtUptime } from '../../lib/format';
import { Copy, Check, Wallet } from 'lucide-react';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function nodeStatusMap(node) {
  if (node.active && node.status === 'connected') return 'running';
  if (node.status === 'connecting') return 'starting';
  return 'stopped';
}

function statusColor(status) {
  if (status === 'connected') return 'text-success';
  if (status === 'connecting') return 'text-warning';
  return 'text-danger';
}

export const IdentityBar = memo(function IdentityBar() {
  const node = useGrooveStore((s) => s.networkNode);
  const wallet = useGrooveStore((s) => s.networkWallet);
  const [copied, setCopied] = useState(false);
  const [uptime, setUptime] = useState(0);

  useEffect(() => {
    if (!node.startedAt) return;
    const tick = () => setUptime(Math.floor((Date.now() - node.startedAt) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [node.startedAt]);

  const handleCopy = useCallback(async () => {
    if (!node.nodeId) return;
    try {
      await navigator.clipboard.writeText(node.nodeId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }, [node.nodeId]);

  const connStatus = node.status || 'disconnected';

  return (
    <div className="flex items-center h-11 px-4 bg-surface-0 border-b border-border-subtle gap-3">
      {/* Left: node identity */}
      <div className="flex items-center gap-2">
        <StatusDot status={nodeStatusMap(node)} size="sm" />
        <code className="text-xs font-mono text-text-0">{shortAddr(node.nodeId)}</code>
        <Tooltip content={copied ? 'Copied' : 'Copy address'} side="bottom">
          <button
            onClick={handleCopy}
            className="h-6 w-6 inline-flex items-center justify-center rounded border border-border-subtle text-text-3 hover:text-accent hover:border-accent/40 cursor-pointer transition-colors"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        </Tooltip>
      </div>

      {/* Center: status + uptime */}
      <div className="flex-1 flex items-center justify-center gap-3">
        <span className={cn('text-2xs uppercase tracking-widest font-sans', statusColor(connStatus))}>
          {connStatus === 'connected' ? 'Connected' : connStatus === 'connecting' ? 'Connecting' : 'Disconnected'}
        </span>
        <span className="w-1 h-1 rounded-full bg-text-4" />
        <span className="text-2xs font-mono text-text-3 tabular-nums">
          {fmtUptime(uptime)}
        </span>
      </div>

      {/* Right: token balance + wallet */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-text-2">
          <span className="text-text-0">{wallet.balance}</span>
          <span className="text-text-3"> GROOVE</span>
        </span>
        <Button variant="outline" size="sm" className="text-2xs gap-1.5" disabled>
          <Wallet size={12} />
          Connect Wallet
        </Button>
      </div>
    </div>
  );
});
