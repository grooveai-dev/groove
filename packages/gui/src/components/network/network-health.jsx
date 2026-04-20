// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { useGrooveStore } from '../../stores/groove';
import { cn } from '../../lib/cn';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { fmtNum } from '../../lib/format';
import { StatusDot } from '../ui/status-dot';
import { Badge } from '../ui/badge';
import { ScrollArea } from '../ui/scroll-area';

function coverageState(covered, total) {
  if (!total) return { color: HEX.danger, label: 'Insufficient' };
  const pct = covered / total;
  if (pct >= 1) return { color: HEX.success, label: 'Full coverage' };
  if (pct >= 0.5) return { color: HEX.warning, label: 'Partial' };
  return { color: HEX.danger, label: 'Insufficient' };
}

export const NetworkHealth = memo(function NetworkHealth() {
  const status = useGrooveStore((s) => s.networkStatus);
  const signalReachable = useGrooveStore((s) => s.networkStatusReachable);
  const node = useGrooveStore((s) => s.networkNode);

  const nodes = Array.isArray(status.nodes) ? status.nodes : [];
  const totalLayers = status.totalLayers || 34;
  const covered = status.coverage || 0;
  const coverage = coverageState(covered, totalLayers);
  const coveragePct = totalLayers ? Math.min(100, (covered / totalLayers) * 100) : 0;
  const models = Array.isArray(status.models) ? status.models : [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Network Health</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-3 py-2 space-y-3">
          {/* Signal connection */}
          <div className="bg-surface-0 rounded p-2.5">
            <div className="flex items-center gap-2">
              <span className="relative flex-shrink-0 w-[6px] h-[6px]">
                <span className="absolute inset-0 rounded-sm" style={{ background: signalReachable ? HEX.success : HEX.danger }} />
                {signalReachable && (
                  <span
                    className="absolute inset-[-2px] rounded-sm"
                    style={{ background: HEX.success, opacity: 0.15, animation: 'node-pulse-bar 2s ease-in-out infinite' }}
                  />
                )}
              </span>
              <span className="text-2xs font-mono text-text-3">Signal</span>
              <span className="text-2xs font-mono text-text-1">signal.groovedev.ai</span>
              <div className="flex-1" />
              <span className="text-2xs font-mono" style={{ color: signalReachable ? HEX.success : HEX.danger }}>
                {signalReachable ? 'Connected' : 'Unreachable'}
              </span>
            </div>
          </div>

          {/* Coverage */}
          <div className="bg-surface-0 rounded p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Layer Coverage</span>
              <span className="text-2xs font-mono tabular-nums" style={{ color: coverage.color }}>
                {covered}/{totalLayers}
              </span>
            </div>
            <div className="h-0.5 rounded-sm overflow-hidden" style={{ background: hexAlpha(HEX.accent, 0.08) }}>
              <div
                className="h-full rounded-sm transition-all duration-700"
                style={{ width: `${coveragePct}%`, background: coverage.color }}
              />
            </div>
            <div className="mt-1 text-2xs font-mono text-text-4">{coverage.label}</div>
          </div>

          {/* Session throughput */}
          <div className="bg-surface-0 rounded p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Sessions</span>
              <span className="text-base font-mono font-semibold text-text-0 tabular-nums leading-none">
                {fmtNum(status.activeSessions || 0)}
              </span>
            </div>
            <div className="text-2xs font-mono text-text-4 mt-0.5">Active streams</div>
          </div>

          {/* Uptime */}
          {node.active && (
            <div className="bg-surface-0 rounded p-2.5">
              <div className="flex items-center justify-between">
                <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Node Status</span>
                <span className="text-2xs font-mono capitalize" style={{ color: node.status === 'connected' ? HEX.success : HEX.warning }}>
                  {node.status || 'disconnected'}
                </span>
              </div>
              {node.sessions > 0 && (
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-2xs font-mono text-text-4">Local Sessions</span>
                  <span className="text-xs font-mono text-text-1 tabular-nums">{node.sessions}</span>
                </div>
              )}
            </div>
          )}

          {/* Models */}
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1.5">Models</div>
            {models.length === 0 ? (
              <div className="text-2xs font-mono text-text-4">No models available</div>
            ) : (
              <div className="space-y-1">
                {models.map((m, i) => {
                  const name = typeof m === 'string' ? m : m.name;
                  const available = typeof m === 'string' ? true : !!m.available;
                  return (
                    <div key={i} className="flex items-center gap-2 bg-surface-0 rounded px-2.5 py-1.5">
                      <span className="relative flex-shrink-0 w-[5px] h-[5px]">
                        <span className="absolute inset-0 rounded-sm" style={{ background: available ? HEX.success : HEX.text4 }} />
                      </span>
                      <span className="text-xs font-mono text-text-1 truncate flex-1">{name}</span>
                      <span className="text-2xs font-mono" style={{ color: available ? HEX.success : HEX.text3 }}>
                        {available ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
});
