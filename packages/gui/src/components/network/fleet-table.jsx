// FSL-1.1-Apache-2.0 — see LICENSE
import { memo, useState, useMemo, useCallback } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';
import { fmtUptime } from '../../lib/format';
import { ArrowUp, ArrowDown, Search } from 'lucide-react';

function shortAddr(addr) {
  if (!addr || typeof addr !== 'string') return '\u2014';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}\u2026${addr.slice(-4)}`;
}

function fmtMb(mb) {
  if (!mb && mb !== 0) return '\u2014';
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

const COLUMNS = [
  { key: 'status', label: 'STATUS', w: 'w-[52px]' },
  { key: 'node', label: 'NODE', w: 'flex-1 min-w-[90px]' },
  { key: 'device', label: 'DEVICE', w: 'w-[72px]' },
  { key: 'gpu', label: 'GPU', w: 'w-[90px]' },
  { key: 'ram', label: 'RAM', w: 'w-[88px]', numeric: true },
  { key: 'vram', label: 'VRAM', w: 'w-[88px]', numeric: true },
  { key: 'cpu', label: 'CPU', w: 'w-[42px]', numeric: true },
  { key: 'gpuUtil', label: 'GPU%', w: 'w-[48px]', numeric: true },
  { key: 'layers', label: 'LAYERS', w: 'w-[60px]' },
  { key: 'sessions', label: 'SESS', w: 'w-[42px]', numeric: true },
  { key: 'uptime', label: 'UPTIME', w: 'w-[60px]' },
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
    case 'gpuUtil': return node.gpu_utilization_pct ?? -1;
    case 'sessions': return node.sessions || node.active_sessions || 0;
    case 'uptime': return node.uptime_seconds || 0;
    default: return 0;
  }
}

function ExpandedRow({ node }) {
  const gpuPct = node.gpu_utilization_pct;
  const details = [
    { label: 'GPU Utilization', value: gpuPct != null ? `${Math.round(gpuPct)}%` : '—' },
    { label: 'VRAM Used', value: node.vram_used_mb != null ? fmtMb(node.vram_used_mb) : '—' },
    { label: 'RAM Used', value: node.ram_used_mb != null ? fmtMb(node.ram_used_mb) : '—' },
    { label: 'Uptime', value: node.uptime_seconds ? fmtUptime(node.uptime_seconds) : '—' },
    { label: 'Bandwidth', value: node.bandwidth_mbps ? `${Math.round(node.bandwidth_mbps)} Mbps` : '—' },
  ];
  return (
    <div className="px-3 py-2 bg-surface-0 border-t border-border-subtle">
      <div className="grid grid-cols-5 gap-3">
        {details.map((d) => (
          <div key={d.label}>
            <div className="text-2xs font-mono text-text-4 uppercase tracking-wider">{d.label}</div>
            <div className="text-xs font-mono text-text-1 tabular-nums">{d.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const FleetTable = memo(function FleetTable() {
  const nodes = useGrooveStore((s) => s.networkStatus.nodes || []);
  const ownNodeId = useGrooveStore((s) => s.networkNode.nodeId);
  const [sortKey, setSortKey] = useState('status');
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const handleSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) { setSortAsc((v) => !v); return prev; }
      setSortAsc(true);
      return key;
    });
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return nodes;
    const q = search.toLowerCase();
    return nodes.filter((n) => {
      const id = (n.node_id || n.nodeId || '').toLowerCase();
      const gpu = (n.gpu_model || '').toLowerCase();
      const device = (n.device || '').toLowerCase();
      return id.includes(q) || gpu.includes(q) || device.includes(q);
    });
  }, [nodes, search]);

  const sorted = useMemo(() => {
    const list = [...filtered];
    list.sort((a, b) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortAsc]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex-shrink-0 flex items-center justify-between">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Node Fleet</span>
        <span className="text-2xs font-mono text-text-3 tabular-nums">{nodes.length} nodes</span>
      </div>

      <div className="px-3 pb-1 flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-text-4" />
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 w-full rounded-md pl-7 pr-2 text-xs bg-surface-1 border border-border-subtle text-text-0 placeholder:text-text-4 focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent font-mono transition-colors"
          />
        </div>
      </div>

      <div className="flex items-center gap-0 px-3 py-1 flex-shrink-0 bg-accent/[0.04]">
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
              sortAsc ? <ArrowUp size={8} /> : <ArrowDown size={8} />
            )}
          </button>
        ))}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        {sorted.length === 0 ? (
          <div className="px-3 py-6 text-2xs font-mono text-text-4 text-center">
            {search ? 'No matching nodes' : 'No nodes online'}
          </div>
        ) : (
          <div>
            {sorted.map((n, i) => {
              const id = n.node_id || n.nodeId || '';
              const isSelf = ownNodeId && id && id === ownNodeId;
              const layersLabel = Array.isArray(n.layers) ? `${n.layers[0]}-${n.layers[1]}` : n.layers || '\u2014';
              const isActive = n.status === 'active' || n.status === 'connecting';
              const gpuPct = n.gpu_utilization_pct;
              const gpuClr = gpuPct == null ? undefined : gpuPct > 80 ? HEX.danger : gpuPct > 50 ? HEX.warning : HEX.success;
              const ramPct = n.ram_pct || (n.ram_mb > 0 && n.ram_used_mb != null ? (n.ram_used_mb / n.ram_mb) * 100 : null);
              const vramPct = n.vram_mb > 0 && n.vram_used_mb != null ? (n.vram_used_mb / n.vram_mb) * 100 : null;
              const isExpanded = expandedId === id;

              return (
                <div key={id || i}>
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                    className={cn(
                      'flex items-center gap-0 px-3 py-2 text-xs font-mono transition-colors cursor-pointer',
                      isSelf ? 'border-l-2 border-accent bg-accent/[0.04]' : 'hover:bg-surface-2',
                    )}
                  >
                    <div className={cn('flex items-center gap-1.5', COLUMNS[0].w)}>
                      <span className="relative flex-shrink-0 w-[6px] h-[6px]">
                        <span className="absolute inset-0 rounded-sm" style={{ background: isActive ? HEX.success : HEX.text4 }} />
                        {isActive && (
                          <span
                            className="absolute inset-[-2px] rounded-sm"
                            style={{ background: HEX.success, opacity: 0.15, animation: 'node-pulse-bar 2s ease-in-out infinite' }}
                          />
                        )}
                      </span>
                    </div>
                    <div className={cn('truncate text-text-1', COLUMNS[1].w)}>
                      {shortAddr(id)}
                      {isSelf && <Badge variant="accent" className="ml-1 text-2xs">You</Badge>}
                    </div>
                    <div className={cn('truncate text-text-2', COLUMNS[2].w)}>{n.device || '\u2014'}</div>
                    <div className={cn('truncate text-text-2', COLUMNS[3].w)}>{n.gpu_model || '\u2014'}</div>
                    <div className={cn('text-right tabular-nums', COLUMNS[4].w)}>
                      <div className="text-text-2">{n.ram_used_mb != null ? `${fmtMb(n.ram_used_mb)}/${fmtMb(n.ram_mb)}` : fmtMb(n.ram_mb)}</div>
                      {ramPct != null && (
                        <div className="h-0.5 rounded-sm mt-0.5 overflow-hidden bg-accent/[0.08]">
                          <div className="h-full rounded-sm" style={{ width: `${Math.min(100, ramPct)}%`, background: ramPct > 90 ? HEX.danger : ramPct > 70 ? HEX.warning : HEX.accent }} />
                        </div>
                      )}
                    </div>
                    <div className={cn('text-right tabular-nums', COLUMNS[5].w)}>
                      <div className="text-text-2">{n.vram_used_mb != null ? `${fmtMb(n.vram_used_mb)}/${fmtMb(n.vram_mb)}` : fmtMb(n.vram_mb)}</div>
                      {vramPct != null && (
                        <div className="h-0.5 rounded-sm mt-0.5 overflow-hidden bg-accent/[0.08]">
                          <div className="h-full rounded-sm" style={{ width: `${Math.min(100, vramPct)}%`, background: vramPct > 90 ? HEX.danger : vramPct > 70 ? HEX.warning : HEX.info }} />
                        </div>
                      )}
                    </div>
                    <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[6].w)}>{n.cpu_cores || '\u2014'}</div>
                    <div className={cn('text-right tabular-nums', COLUMNS[7].w)} style={{ color: gpuClr }}>
                      {gpuPct != null ? `${Math.round(gpuPct)}%` : '\u2014'}
                    </div>
                    <div className={cn('text-text-2', COLUMNS[8].w)}>{layersLabel}</div>
                    <div className={cn('text-right text-text-2 tabular-nums', COLUMNS[9].w)}>{n.sessions ?? n.active_sessions ?? 0}</div>
                    <div className={cn('text-text-2', COLUMNS[10].w)}>{n.uptime_seconds ? fmtUptime(n.uptime_seconds) : '\u2014'}</div>
                  </div>
                  {isExpanded && <ExpandedRow node={n} />}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
