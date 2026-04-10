// FSL-1.1-Apache-2.0 — see LICENSE
import { fmtNum, fmtPct } from '../../lib/format';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { timeAgo } from '../../lib/format';

function SavingsBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-sans">
        <span className="text-text-2">{label}</span>
        <span className="text-text-0 font-mono">{fmtNum(value)}</span>
      </div>
      <div className="h-1.5 bg-surface-0 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

function StatRow({ label, value }) {
  return (
    <div className="flex items-center justify-between text-xs font-sans">
      <span className="text-text-3">{label}</span>
      <span className="text-text-0 font-mono">{value}</span>
    </div>
  );
}

export function SavingsPanel({ data, rotation, routing, adaptive }) {
  if (!data) return null;

  const savings = data.savings || {};
  const totalSaved = savings.total || data.totalSaved || 0;
  const rotationSaved = savings.fromRotation || data.rotationSaved || 0;
  const conflictSaved = savings.fromConflictPrevention || data.conflictSaved || 0;
  const coldStartSaved = savings.fromColdStartSkip || data.coldStartSaved || 0;
  const totalUsed = data.totalUsed || data.totalTokens || 0;
  const total = totalUsed + totalSaved;

  return (
    <div className="p-4 space-y-5 overflow-y-auto h-full">
      {/* Summary */}
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold font-mono text-success">{fmtNum(totalSaved)}</span>
        <span className="text-xs text-text-3 font-sans">tokens saved</span>
        {total > 0 && (
          <span className="text-xs text-text-4 font-sans">({fmtPct(totalSaved / total * 100)})</span>
        )}
      </div>

      {/* Breakdown */}
      <div className="space-y-3">
        <SavingsBar label="Rotation savings" value={rotationSaved} total={total} color={HEX.accent} />
        <SavingsBar label="Conflict prevention" value={conflictSaved} total={total} color={HEX.purple} />
        <SavingsBar label="Cold-start prevention" value={coldStartSaved} total={total} color={HEX.info} />
      </div>

      {/* Rotation Stats */}
      {rotation && (rotation.totalRotations > 0 || rotation.history?.length > 0) && (
        <div className="space-y-2">
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Rotations</span>
          <div className="space-y-1.5">
            <StatRow label="Total rotations" value={rotation.totalRotations || 0} />
            <StatRow label="Tokens saved" value={fmtNum(rotation.totalTokensSaved || 0)} />
          </div>
          {rotation.history?.length > 0 && (
            <div className="space-y-1 mt-2">
              {rotation.history.slice(-5).reverse().map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-2xs text-text-3 font-sans px-2 py-1 bg-surface-0 rounded">
                  <span className="text-text-1 font-medium capitalize">{r.agentName || r.role}</span>
                  <span className="font-mono">{fmtPct((r.contextUsage || 0) * 100)}</span>
                  <span className="ml-auto text-text-4">{timeAgo(r.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Routing Breakdown */}
      {routing && routing.totalDecisions > 0 && (
        <div className="space-y-2">
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Model Routing</span>
          <div className="space-y-1.5">
            <StatRow label="Auto-routed agents" value={routing.autoRoutedCount || 0} />
            <StatRow label="Total decisions" value={routing.totalDecisions || 0} />
            {routing.byTier && (
              <>
                <StatRow label="Heavy (Opus)" value={routing.byTier.heavy || 0} />
                <StatRow label="Medium (Sonnet)" value={routing.byTier.medium || 0} />
                <StatRow label="Light (Haiku)" value={routing.byTier.light || 0} />
              </>
            )}
          </div>
        </div>
      )}

      {/* Adaptive Thresholds */}
      {adaptive?.length > 0 && (
        <div className="space-y-2">
          <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Adaptive Thresholds</span>
          <div className="space-y-1">
            {adaptive.map((p) => (
              <div key={p.key} className="flex items-center gap-2 text-2xs font-sans px-2 py-1 bg-surface-0 rounded">
                <span className="text-text-1 font-mono flex-1 truncate">{p.key}</span>
                <span className="font-mono text-text-0">{fmtPct(p.threshold * 100)}</span>
                <span className={cn('text-2xs', p.converged ? 'text-success' : 'text-text-4')}>
                  {p.converged ? 'converged' : `${p.adjustments} adj`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
