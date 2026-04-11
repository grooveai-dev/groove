// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { fmtNum, fmtPct, timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { RotateCw, Brain, Radio } from 'lucide-react';

/* ── Tiny SVG sparkline for inline use ──────────────────────── */
function TinySparkline({ data, color = HEX.accent, width = 60, height = 16 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const vals = Array.isArray(data[0]) ? data : data.map((d) => (typeof d === 'number' ? d : d.v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round" strokeOpacity="0.7" />
    </svg>
  );
}

/* ── Savings bar ────────────────────────────────────────────── */
function SavingsBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs font-mono">
        <span className="text-text-2">{label}</span>
        <span className="text-text-1 tabular-nums">{fmtNum(value)}</span>
      </div>
      <div className="h-[2px] bg-surface-0 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Rotation Tab ───────────────────────────────────────────── */
function RotationTab({ tokens, rotation }) {
  const savings = tokens?.savings || {};
  const totalSaved = savings.total || 0;
  const totalUsed = tokens?.totalTokens || 0;
  const hypothetical = totalUsed + totalSaved;

  return (
    <div className="p-3 space-y-4">
      <div className="flex gap-4">
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Rotations</div>
          <div className="text-xl font-mono font-semibold text-text-0 tabular-nums leading-none">{rotation?.totalRotations || 0}</div>
        </div>
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Saved</div>
          <div className="text-xl font-mono font-semibold text-success tabular-nums leading-none">{fmtNum(totalSaved)}</div>
          {hypothetical > 0 && (
            <div className="text-2xs font-mono text-text-3 mt-0.5">{fmtPct((totalSaved / hypothetical) * 100)} of total</div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <SavingsBar label="Rotation" value={savings.fromRotation || 0} total={hypothetical} color={HEX.accent} />
        <SavingsBar label="Conflict prevention" value={savings.fromConflictPrevention || 0} total={hypothetical} color={HEX.purple} />
        <SavingsBar label="Cold-start skip" value={savings.fromColdStartSkip || 0} total={hypothetical} color={HEX.info} />
      </div>
      {rotation?.history?.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1.5">Recent</div>
          <div className="space-y-1">
            {rotation.history.slice(-8).reverse().map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 bg-surface-0 rounded">
                <span className="text-text-1 font-medium capitalize truncate flex-1">{r.agentName || r.role}</span>
                <span className="text-text-3 tabular-nums">{fmtPct((r.contextUsage || 0) * 100)}</span>
                <span className="text-text-4">{timeAgo(r.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Adaptive Tab ───────────────────────────────────────────── */
function AdaptiveTab({ adaptive }) {
  if (!adaptive?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-3 font-mono p-4">
        No adaptive profiles
      </div>
    );
  }

  // Split provider:role into readable parts
  function parseKey(key) {
    const parts = key.split(':');
    return { provider: parts[0] || key, role: parts[1] || '' };
  }

  return (
    <div>
      <div className="p-3 space-y-1">
        {/* Header */}
        <div className="flex items-center gap-2 px-2 pb-1 text-2xs font-mono text-text-4 uppercase tracking-wider">
          <span className="flex-1">Role</span>
          <span className="w-12 text-right">Threshold</span>
          <span className="w-12 text-right">Adj.</span>
          <span className="w-14 text-right">Status</span>
        </div>

        {adaptive.map((p) => {
          const { provider, role } = parseKey(p.key);
          const hasHistory = p.thresholdHistory?.length > 1;
          const hasScores = p.recentScores?.length > 1;

          return (
            <div key={p.key} className="bg-surface-0 rounded px-2 py-1.5">
              {/* Main row */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-mono text-text-1 capitalize">{role || provider}</span>
                  {role && <span className="text-2xs font-mono text-text-4 ml-1.5">{provider}</span>}
                </div>
                <span className="w-12 text-right text-xs font-mono font-semibold text-text-0 tabular-nums">
                  {fmtPct(p.threshold * 100)}
                </span>
                <span className="w-12 text-right text-2xs font-mono text-text-3 tabular-nums">
                  {p.adjustments}
                </span>
                <span className={cn(
                  'w-14 text-right text-2xs font-mono font-bold uppercase',
                  p.converged ? 'text-success' : 'text-text-4',
                )}>
                  {p.converged ? 'Converged' : 'Learning'}
                </span>
              </div>

              {/* Sparklines row (if data exists) */}
              {(hasHistory || hasScores) && (
                <div className="flex items-center gap-3 mt-1.5 pl-1">
                  {hasHistory && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xs font-mono text-text-4">Threshold</span>
                      <TinySparkline
                        data={p.thresholdHistory.map((h) => h.v)}
                        color={p.converged ? HEX.success : HEX.accent}
                        width={70}
                        height={12}
                      />
                    </div>
                  )}
                  {hasScores && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-2xs font-mono text-text-4">Quality</span>
                      <TinySparkline
                        data={p.recentScores}
                        color={HEX.warning}
                        width={70}
                        height={12}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Journalist Tab ─────────────────────────────────────────── */
function JournalistTab({ journalist }) {
  if (!journalist) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-3 font-mono p-4">
        Journalist inactive
      </div>
    );
  }

  return (
    <div>
      <div className="p-3 space-y-3">
        {/* Status row */}
        <div className="flex items-center gap-3">
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Cycles</div>
            <div className="text-lg font-mono font-semibold text-text-0 tabular-nums leading-none">
              {journalist.cycleCount || 0}
            </div>
          </div>
          {journalist.lastCycleAt && (
            <div>
              <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Last</div>
              <div className="text-xs font-mono text-text-2">{timeAgo(journalist.lastCycleAt)}</div>
            </div>
          )}
          {journalist.synthesizing && (
            <span className="text-2xs font-mono font-bold text-accent uppercase tracking-wider animate-pulse">
              Synthesizing
            </span>
          )}
        </div>

        {/* Summary */}
        {journalist.lastSummary && (
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Summary</div>
            <div className="text-xs font-sans text-text-2 leading-relaxed">
              {journalist.lastSummary}
            </div>
          </div>
        )}

        {/* Project Map */}
        {journalist.projectMap && (
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Project Map</div>
            <div className="text-xs font-mono text-text-2 leading-relaxed whitespace-pre-wrap">
              {journalist.projectMap}
            </div>
          </div>
        )}

        {/* Decisions */}
        {journalist.decisions && (
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Decisions</div>
            <div className="text-xs font-mono text-text-2 leading-relaxed whitespace-pre-wrap">
              {journalist.decisions}
            </div>
          </div>
        )}

        {/* Recent history */}
        {journalist.recentHistory?.length > 0 && (
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1.5">History</div>
            <div className="space-y-1">
              {journalist.recentHistory.slice().reverse().map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 bg-surface-0 rounded">
                  <span className="text-text-3">#{h.cycle}</span>
                  <span className="text-text-2 flex-1 truncate">{h.agentCount} agents</span>
                  <span className="text-text-4">{timeAgo(h.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Intel Panel (main export) ──────────────────────────────── */
const IntelPanel = memo(function IntelPanel({ tokens, rotation, adaptive, journalist }) {
  return (
    <Tabs defaultValue="rotation" className="flex flex-col h-full">
      <TabsList className="flex-shrink-0 px-1">
        <TabsTrigger value="rotation" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <RotateCw size={11} />
          Rotation
        </TabsTrigger>
        <TabsTrigger value="adaptive" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Brain size={11} />
          Adaptive
        </TabsTrigger>
        <TabsTrigger value="journalist" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Radio size={11} />
          Journalist
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rotation" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <RotationTab tokens={tokens} rotation={rotation} />
        </div>
      </TabsContent>
      <TabsContent value="adaptive" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <AdaptiveTab adaptive={adaptive} />
        </div>
      </TabsContent>
      <TabsContent value="journalist" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <JournalistTab journalist={journalist} />
        </div>
      </TabsContent>
    </Tabs>
  );
});

export { IntelPanel };
