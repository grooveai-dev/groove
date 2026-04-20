// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useMemo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';
import { StatusDot } from '../ui/status-dot';
import { Badge } from '../ui/badge';
import { ArrowUp, ArrowDown } from 'lucide-react';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmtMb(mb) {
  if (!mb && mb !== 0) return '—';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

function loadColor(load) {
  if (load == null) return 'text-text-3';
  if (load < 1.0) return 'text-success';
  if (load <= 2.0) return 'text-warning';
  return 'text-danger';
}

function statusMap(s) {
  if (s === 'active') return 'running';
  if (s === 'connecting') return 'starting';
  return 'crashed';
}

const COLUMNS = [
  { key: 'status', label: 'STATUS', w: 'w-[60px]' },
  { key: 'node', label: 'NODE', w: 'flex-1 min-w-[100px]' },
  { key: 'device', label: 'DEVICE', w: 'w-[80px]' },
  { key: 'gpu', label: 'GPU', w: 'w-[100px]' },
  { key: 'ram', label: 'RAM', w: 'w-[70px]', numeric: true },
  { key: 'vram', label: 'VRAM', w: 'w-[70px]', numeric: true },
  { key: 'cpu', label: 'CPU', w: 'w-[50px]', numeric: true },
  { key: 'layers', label: 'LAYERS', w: 'w-[70px]' },
  { key: 'sessions', label: 'SESS', w: 'w-[50px]', numeric: true },
  { key: 'load', label: 'LOAD', w: 'w-[60px]', numeric: true },
];

function getSortValue(node, key) {
  switch (key) {
    case 'status': return node.status === 'active' ? 0 : node.status === 'connecting' ? 1 : 2;
    case 'node': return (node.node_id || node.nodeId || '').toLowerCase();
    case 'device': return (node.device || '').toLowerCase();
    case 'gpu': return (node.gpu_model || '').toLowerCase();
    case 'ram': return node.ram_mb || 0;
    case 'vram': return node.vram_mb || 0;
    case 'cpu': return node.cpu_cores || 0;
    case 'layers': return Array.isArray(node.layers) ? node.layers[0] : 0;
    case 'sessions': return node.sessions || 0;
    case 'load': return node.load ?? 999;
    default: return 0;
  }
}

export function FleetTable() {
  const nodes = useGrooveStore((s) => s.networkStatus.nodes || []);
  const ownNodeId = useGrooveStore((s) => s.networkNode.nodeId);
  const [sortKey, setSortKey] = useState('status');
  const [sortAsc, setSortAsc] = useState(true);

  function handleSort(key) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sorted = useMemo(() => {
    const list = [...nodes];
    list.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [nodes, sortKey, sortAsc]);

  return (
    <div className="border border-border-subtle bg-surface-0 rounded-sm overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
        <span className="text-2xs font-mono text-text-4 tracking-wider">--- NODE FLEET ---</span>
        <div className="flex-1 h-px bg-border-subtle" />
        <span className="text-2xs font-mono text-text-3 tabular-nums">{nodes.length} nodes</span>
      </div>

      {/* Header */}
      <div className="flex items-center gap-0 px-3 py-1.5 border-b border-border-subtle bg-surface-1/50">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            onClick={() => handleSort(col.key)}
            className={cn(
              'flex items-center gap-0.5 text-2xs font-mono text-text-4 uppercase tracking-wider cursor-pointer hover:text-text-2 transition-colors',
              col.w,
              col.numeric && 'justify-end',
            )}
          >
            {col.label}
            {sortKey === col.key && (
              sortAsc ? <ArrowUp size={9} /> : <ArrowDown size={9} />
            )}
          </button>
        ))}
      </div>

      {/* Rows */}
      <ScrollArea className="max-h-[320px]">
        {sorted.length === 0 ? (
          <div className="px-3 py-4 text-2xs font-mono text-text-4 text-center">No nodes online.</div>
        ) : (
          sorted.map((n, i) => {
            const id = n.node_id || n.nodeId || '';
            const isSelf = ownNodeId && id && id === ownNodeId;
            const layersLabel = Array.isArray(n.layers) ? `${n.layers[0]}-${n.layers[1]}` : n.layers || '—';
            return (
              <div
                key={id || i}
                className={cn(
                  'flex items-center gap-0 px-3 py-1.5 border-b border-border-subtle/50 text-xs font-mono',
                  isSelf ? 'bg-accent/8' : 'hover:bg-surface-1/40',
                )}
              >
                <div className={cn('flex items-center gap-1.5', COLUMNS[0].w)}>
                  <StatusDot status={statusMap(n.status)} size="sm" />
                </div>
                <div className={cn('truncate text-text-1', COLUMNS[1].w)}>
                  {shortAddr(id)}
                  {isSelf && <Badge variant="accent" className="ml-1 text-2xs">YOU</Badge>}
                </div>
                <div className={cn('truncate text-text-2', COLUMNS[2].w)}>{n.device || '—'}</div>
                <div className={cn('truncate text-text-2', COLUMNS[3].w)}>{n.gpu_model || '—'}</div>
                <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[4].w)}>{fmtMb(n.ram_mb)}</div>
                <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[5].w)}>{fmtMb(n.vram_mb)}</div>
                <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[6].w)}>{n.cpu_cores || '—'}</div>
                <div className={cn('text-text-2', COLUMNS[7].w)}>{layersLabel}</div>
                <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[8].w)}>{n.sessions ?? 0}</div>
                <div className={cn('text-right tabular-nums', COLUMNS[9].w, loadColor(n.load))}>
                  {n.load != null ? n.load.toFixed(2) : '—'}
                </div>
              </div>
            );
          })
        )}
      </ScrollArea>
    </div>
  );
}
