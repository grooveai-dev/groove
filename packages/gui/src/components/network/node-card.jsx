// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { StatusDot } from '../ui/status-dot';

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

function modelShort(model) {
  if (!model) return '—';
  const parts = model.split('/');
  return parts[parts.length - 1];
}

export const NodeCard = memo(function NodeCard() {
  const node = useGrooveStore((s) => s.networkNode);
  const hardware = node.hardware || {};
  const memPct = Number.isFinite(node.memoryPct) ? node.memoryPct : null;
  const layersLabel = Array.isArray(node.layers) ? `${node.layers[0]}-${node.layers[1]}` : '—';

  const metrics = [
    { label: 'DEVICE', value: hardware.device || 'auto' },
    { label: 'GPU', value: hardware.gpu || 'None' },
    { label: 'LAYERS', value: layersLabel },
    { label: 'MODEL', value: modelShort(node.model) },
    { label: 'SESSIONS', value: node.sessions ?? 0 },
    { label: 'VRAM', value: hardware.memory || '—' },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Your Node</span>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div>
          <div className="text-2xs text-text-4 uppercase tracking-wider">ADDRESS</div>
          <div className="text-xs font-mono text-accent truncate">{shortAddr(node.nodeId)}</div>
        </div>

        <div className="flex items-center gap-1.5">
          <StatusDot status={nodeStatusMap(node)} size="sm" />
          <span className="text-2xs capitalize text-text-2">{node.status || 'disconnected'}</span>
        </div>

        <div className="border-t border-border-subtle my-1" />

        <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
          {metrics.map((m) => (
            <div key={m.label}>
              <div className="text-2xs text-text-4 uppercase tracking-wider">{m.label}</div>
              <div className="text-xs font-mono text-text-1 tabular-nums truncate">{m.value}</div>
            </div>
          ))}
        </div>

        {memPct != null && (
          <div className="mt-1">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-2xs text-text-4 uppercase tracking-wider">MEM</span>
              <span className="text-2xs font-mono text-text-3 tabular-nums">{Math.round(memPct)}%</span>
            </div>
            <div className="h-1 w-full rounded-full bg-surface-3 overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  memPct > 90 ? 'bg-danger' : memPct > 70 ? 'bg-warning' : 'bg-accent',
                )}
                style={{ width: `${Math.min(100, Math.max(0, memPct))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
