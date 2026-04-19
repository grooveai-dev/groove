// FSL-1.1-Apache-2.0 — see LICENSE
import { useState } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { fmtNum } from '../../lib/format';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { ScrollArea } from '../ui/scroll-area';
import { ChevronDown, ChevronRight, Globe, Layers, Activity } from 'lucide-react';

function shortAddress(addr) {
  if (!addr || typeof addr !== 'string') return '—';
  if (addr.length < 14) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function coverageState(covered, total) {
  if (!total) return { tone: 'danger', color: 'bg-danger', label: 'Insufficient' };
  const pct = covered / total;
  if (pct >= 1) return { tone: 'success', color: 'bg-success', label: 'Full coverage' };
  if (pct >= 0.5) return { tone: 'warning', color: 'bg-warning', label: 'Partial' };
  return { tone: 'danger', color: 'bg-danger', label: 'Insufficient' };
}

function KpiTile({ icon: Icon, label, value, sub }) {
  return (
    <div className="rounded-lg border border-border bg-surface-1 px-3 py-2.5 flex items-center gap-2.5 min-w-0">
      <div className="w-8 h-8 rounded-md bg-accent/10 text-accent flex items-center justify-center flex-shrink-0">
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-2xs font-mono text-text-3 uppercase tracking-wider truncate">{label}</div>
        <div className="text-base font-semibold font-mono text-text-0 tabular-nums leading-none">{value}</div>
        {sub && <div className="text-2xs text-text-4 font-sans mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  );
}

export function NetworkStatus() {
  const status = useGrooveStore((s) => s.networkStatus);
  const ownNodeId = useGrooveStore((s) => s.networkNode.nodeId);
  const signalReachable = useGrooveStore((s) => s.networkStatusReachable);
  const [nodesOpen, setNodesOpen] = useState(true);

  const nodes = Array.isArray(status.nodes) ? status.nodes : [];
  const totalLayers = status.totalLayers || 24;
  const covered = status.coverage || 0;
  const coverage = coverageState(covered, totalLayers);
  const coveragePct = totalLayers ? Math.min(100, (covered / totalLayers) * 100) : 0;
  const models = Array.isArray(status.models) ? status.models : [];

  return (
    <div className="flex flex-col gap-3">
      {/* Signal connection indicator */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface-1">
        <StatusDot status={signalReachable ? 'running' : 'crashed'} size="sm" />
        <span className="text-2xs font-sans text-text-3">Signal:</span>
        <span className="text-2xs font-mono text-text-1">signal.groovedev.ai</span>
        <div className="flex-1" />
        <span className={cn('text-2xs font-sans', signalReachable ? 'text-success' : 'text-danger')}>
          {signalReachable ? 'Connected' : 'Unreachable'}
        </span>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2">
        <KpiTile icon={Globe}   label="Nodes"    value={fmtNum(nodes.length)} sub={`${nodes.filter((n) => n.status === 'active').length} active`} />
        <KpiTile icon={Layers}  label="Coverage" value={`${covered}/${totalLayers}`} sub={coverage.label} />
        <KpiTile icon={Activity} label="Sessions" value={fmtNum(status.activeSessions || 0)} sub="Active streams" />
      </div>

      {/* Coverage bar */}
      <div className="rounded-lg border border-border bg-surface-1 px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-text-1 font-sans">Layer Coverage</span>
          <Badge variant={coverage.tone}>{coverage.label}</Badge>
        </div>
        <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', coverage.color)}
            style={{ width: `${coveragePct}%` }}
          />
        </div>
        <div className="mt-1.5 text-2xs font-mono text-text-3 tabular-nums">{covered} of {totalLayers} layers online</div>
      </div>

      {/* Models */}
      <div className="rounded-lg border border-border bg-surface-1 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border-subtle">
          <span className="text-xs font-semibold text-text-1 font-sans">Models</span>
        </div>
        {models.length === 0 ? (
          <div className="px-4 py-3 text-2xs text-text-4 font-sans">No models available yet.</div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {models.map((m, i) => {
              const name = typeof m === 'string' ? m : m.name;
              const available = typeof m === 'string' ? true : !!m.available;
              return (
                <li key={i} className="flex items-center gap-2 px-4 py-2">
                  <StatusDot status={available ? 'running' : 'crashed'} size="sm" />
                  <span className="text-xs font-mono text-text-1 truncate">{name}</span>
                  <div className="flex-1" />
                  <Badge variant={available ? 'success' : 'default'}>{available ? 'Available' : 'Offline'}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Nodes table */}
      <div className="rounded-lg border border-border bg-surface-1 overflow-hidden">
        <button
          onClick={() => setNodesOpen((v) => !v)}
          className="w-full flex items-center gap-2 px-4 py-2.5 border-b border-border-subtle cursor-pointer hover:bg-surface-2/40 transition-colors"
        >
          {nodesOpen ? <ChevronDown size={12} className="text-text-3" /> : <ChevronRight size={12} className="text-text-3" />}
          <span className="text-xs font-semibold text-text-1 font-sans">Nodes</span>
          <div className="flex-1" />
          <span className="text-2xs font-mono text-text-4">{nodes.length}</span>
        </button>
        {nodesOpen && (
          <ScrollArea className="max-h-[280px]">
            {nodes.length === 0 ? (
              <div className="px-4 py-3 text-2xs text-text-4 font-sans">No nodes online.</div>
            ) : (
              <table className="w-full text-xs font-sans">
                <thead>
                  <tr className="text-text-4 text-2xs uppercase tracking-wider">
                    <th className="text-left font-semibold px-4 py-1.5">Address</th>
                    <th className="text-left font-semibold px-2 py-1.5">Device</th>
                    <th className="text-left font-semibold px-2 py-1.5">Layers</th>
                    <th className="text-left font-semibold px-4 py-1.5">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((n, i) => {
                    const id = n.node_id || n.nodeId || '';
                    const layers = Array.isArray(n.layers) ? `${n.layers[0]}-${n.layers[1]}` : n.layers || '—';
                    const isSelf = ownNodeId && id && id === ownNodeId;
                    return (
                      <tr
                        key={id || i}
                        className={cn(
                          'border-t border-border-subtle',
                          isSelf ? 'bg-accent/8' : 'hover:bg-surface-2/40',
                        )}
                      >
                        <td className="px-4 py-2 font-mono text-text-1">
                          <div className="flex items-center gap-1.5">
                            {shortAddress(id)}
                            {isSelf && <Badge variant="accent" className="ml-1">You</Badge>}
                          </div>
                        </td>
                        <td className="px-2 py-2 font-mono text-text-2">{n.device || '—'}</td>
                        <td className="px-2 py-2 font-mono text-text-2">{layers}</td>
                        <td className="px-4 py-2">
                          <div className="flex items-center gap-1.5">
                            <StatusDot status={n.status === 'active' ? 'running' : 'crashed'} size="sm" />
                            <span className="text-2xs capitalize text-text-2">{n.status || 'unknown'}</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
