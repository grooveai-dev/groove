// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { StatusDot } from '../ui/status-dot';
import { Button } from '../ui/button';
import { Tooltip } from '../ui/tooltip';
import { Copy, Check, Wallet } from 'lucide-react';

function nodeStatusMap(node) {
  if (node.active && node.status === 'connected') return 'running';
  if (node.status === 'connecting') return 'starting';
  return 'stopped';
}

export const IdentityBar = memo(function IdentityBar() {
  const node = useGrooveStore((s) => s.networkNode);
  const wallet = useGrooveStore((s) => s.networkWallet);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!node.nodeId) return;
    try {
      await navigator.clipboard.writeText(node.nodeId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }, [node.nodeId]);

  return (
    <div className="flex items-center h-11 px-4 bg-surface-0 border-b border-border-subtle gap-3">
      {/* Left: node identity */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <StatusDot status={nodeStatusMap(node)} size="sm" />
        <code className="text-xs font-mono text-text-0 truncate">{node.nodeId || '—'}</code>
        <Tooltip content={copied ? 'Copied' : 'Copy address'} side="bottom">
          <button
            onClick={handleCopy}
            className="h-6 w-6 inline-flex items-center justify-center rounded border border-border-subtle text-text-3 hover:text-accent hover:border-accent/40 cursor-pointer transition-colors flex-shrink-0"
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
          </button>
        </Tooltip>
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
