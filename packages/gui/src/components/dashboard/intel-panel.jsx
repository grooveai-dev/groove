// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { fmtNum, fmtPct, fmtDollar, timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { roleColor } from '../../lib/status';
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
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-text-2">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>
            {Math.round(pct)}%
          </span>
          <span className="text-2xs font-mono text-text-3 tabular-nums w-10 text-right">{fmtNum(value)}</span>
        </div>
      </div>
      <div className="h-[7px] rounded-full overflow-hidden" style={{ background: 'rgba(51,175,188,0.08)' }}>
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
  const coordSaved = savings.total || 0;
  const cacheSavedUsd = savings.cacheCostSavingsUsd || 0;
  const actualCostUsd = savings.actualCostUsd || tokens?.totalCostUsd || 0;
  const hypotheticalCostUsd = savings.hypotheticalCostUsd || actualCostUsd;
  const costEfficiency = savings.costEfficiency || 0;

  const coordBreakdownTotal = coordSaved || 1;
  const recentHistory = (rotation?.history || []).slice(-10).reverse();

  return (
    <div className="p-3 space-y-4">
      {/* Cost efficiency hero */}
      <div className="rounded p-3" style={{ background: 'rgba(74,225,104,0.06)', border: '1px solid rgba(74,225,104,0.15)' }}>
        <div className="flex items-end justify-between mb-2">
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Cost Efficiency</div>
            <div className="text-3xl font-mono font-bold tabular-nums leading-none" style={{ color: '#4ae168' }}>
              {fmtPct(costEfficiency)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xs font-mono text-text-4">saved</div>
            <div className="text-lg font-mono font-bold tabular-nums leading-none" style={{ color: '#4ae168' }}>
              {fmtDollar(cacheSavedUsd)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3 text-2xs font-mono text-text-3">
          <span>Actual: <span className="text-text-1 font-semibold">{fmtDollar(actualCostUsd)}</span></span>
          <span className="text-text-4">|</span>
          <span>Without cache: <span className="text-text-2">{fmtDollar(hypotheticalCostUsd)}</span></span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Rotations</div>
          <div className="text-2xl font-mono font-bold text-text-0 tabular-nums leading-none">
            {rotation?.totalRotations || 0}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Cache Rate</div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.accent }}>
            {fmtPct((tokens?.cacheHitRate || 0) * 100)}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Agents</div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.accent }}>
            {tokens?.agentCount || 0}
          </div>
        </div>
      </div>

      {/* Coordination savings breakdown */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Coordination Savings</span>
          <span className="text-2xs font-mono text-text-2 tabular-nums">{fmtNum(coordSaved)} tokens</span>
        </div>
        <div className="space-y-2">
          <SavingsBar label="Cold-start skip" value={savings.fromColdStartSkip || 0} total={coordBreakdownTotal} color={HEX.info} />
          <SavingsBar label="Rotation" value={savings.fromRotation || 0} total={coordBreakdownTotal} color={HEX.accent} />
          <SavingsBar label="Conflict prevention" value={savings.fromConflictPrevention || 0} total={coordBreakdownTotal} color="#4ec9d4" />
        </div>
      </div>

      {/* Rotation timeline */}
      {recentHistory.length > 0 ? (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2.5">Recent Rotations</div>
          <div className="space-y-0">
            {recentHistory.map((r, i) => (
              <div key={i} className="flex items-start gap-2.5">
                <div className="flex flex-col items-center flex-shrink-0">
                  <div className="h-1.5" />
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: i === 0 ? '#33afbc' : 'rgba(51,175,188,0.15)',
                      border: '1px solid rgba(51,175,188,0.5)',
                      boxShadow: i === 0 ? '0 0 6px rgba(51,175,188,0.35)' : 'none',
                    }}
                  />
                  {i < recentHistory.length - 1 && (
                    <div
                      className="w-px flex-1 mt-1"
                      style={{ background: 'rgba(51,175,188,0.15)', minHeight: '12px' }}
                    />
                  )}
                </div>
                <div className={cn('flex-1 bg-surface-0 rounded px-2 py-1.5', i < recentHistory.length - 1 && 'mb-2')}>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-1 font-medium capitalize truncate flex-1">
                      {r.agentName || r.role}
                    </span>
                    <span
                      className="text-2xs font-mono font-semibold tabular-nums flex-shrink-0"
                      style={{
                        color: (r.contextUsage || 0) > 0.8 ? '#e06c75' : (r.contextUsage || 0) > 0.6 ? '#e5c07b' : '#33afbc',
                      }}
                    >
                      {fmtPct((r.contextUsage || 0) * 100)}
                    </span>
                    <span className="text-2xs font-mono text-text-4 flex-shrink-0">{timeAgo(r.timestamp)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="bg-surface-0 rounded p-3 text-center space-y-1.5">
          <div className="text-xs font-mono text-text-2 font-semibold">No rotations yet</div>
          <div className="text-2xs font-mono text-text-3 leading-relaxed">
            Auto-rotation triggers when context exceeds the adaptive threshold, preserving progress via handoff brief.
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
      <div className="p-3">
        <div className="bg-surface-0 rounded p-4 text-center space-y-2">
          <div className="text-xs font-mono text-text-2 font-semibold">No adaptive profiles yet</div>
          <div className="text-2xs font-mono text-text-3 leading-relaxed">
            Adaptive thresholds learn when each agent role benefits from rotation. GROOVE tracks quality scores and adjusts rotation triggers automatically — converging to the optimal threshold per role and provider.
          </div>
        </div>
      </div>
    );
  }

  function parseKey(key) {
    const parts = key.split(':');
    return { provider: parts[0] || key, role: parts[1] || '' };
  }

  return (
    <div className="p-3 space-y-3">
      {adaptive.map((p) => {
        const { provider, role } = parseKey(p.key);
        const displayRole = role || provider;
        const hasHistory = p.thresholdHistory?.length > 1;
        const hasScores = p.recentScores?.length > 1;
        const rc = roleColor(displayRole);
        const signals = p.lastSignals;

        return (
          <div
            key={p.key}
            className="rounded overflow-hidden"
            style={{
              background: 'rgba(51,175,188,0.04)',
              borderLeft: p.converged ? '2px solid #33afbc' : '2px solid rgba(229,192,123,0.35)',
            }}
          >
            {/* Card header */}
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
              <span
                className="text-xs font-mono font-semibold capitalize px-1.5 py-px rounded-sm"
                style={{ background: rc.bg, color: rc.text }}
              >
                {displayRole}
              </span>
              {role && (
                <span className="text-2xs font-mono text-text-4 bg-surface-4 px-1.5 py-px rounded-sm">
                  {provider}
                </span>
              )}
              <div className="flex-1" />
              {/* Convergence pill */}
              <span
                className="flex items-center gap-1 text-2xs font-mono font-bold px-2 py-px rounded-full"
                style={{
                  background: p.converged ? 'rgba(74,225,104,0.12)' : 'rgba(229,192,123,0.12)',
                  color: p.converged ? '#4ae168' : '#e5c07b',
                }}
              >
                {!p.converged && (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: '#e5c07b', animation: 'node-pulse-bar 1.5s ease-in-out infinite' }}
                  />
                )}
                {p.converged ? 'Converged' : 'Learning'}
              </span>
            </div>

            {/* Threshold hero + adjustments */}
            <div className="flex items-end gap-5 px-3 pb-2">
              <div>
                <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-0.5">Threshold</div>
                <div
                  className="text-3xl font-mono font-bold tabular-nums leading-none"
                  style={{ color: p.converged ? '#33afbc' : '#e5c07b' }}
                >
                  {fmtPct(p.threshold * 100)}
                </div>
              </div>
              <div className="pb-0.5">
                <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-0.5">Adj.</div>
                <div className="text-lg font-mono font-semibold text-text-1 tabular-nums">{p.adjustments}</div>
              </div>
            </div>

            {/* Sparklines */}
            {(hasHistory || hasScores) && (
              <div className="px-3 pb-2 space-y-2 overflow-hidden">
                {hasHistory && (
                  <div>
                    <div className="text-2xs font-mono text-text-4 mb-0.5">Threshold history</div>
                    <TinySparkline
                      data={p.thresholdHistory.map((h) => h.v)}
                      color={p.converged ? HEX.accent : HEX.warning}
                      width={240}
                      height={32}
                    />
                  </div>
                )}
                {hasScores && (
                  <div>
                    <div className="text-2xs font-mono text-text-4 mb-0.5">Quality score</div>
                    <TinySparkline
                      data={p.recentScores}
                      color={HEX.warning}
                      width={240}
                      height={24}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Signal pills */}
            {signals && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                {signals.errorCount != null && (
                  <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                    Errors: <span className="text-danger">{signals.errorCount}</span>
                  </span>
                )}
                {signals.toolSuccessRate != null && (
                  <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                    Tools: <span className="text-text-1">{Math.round(signals.toolSuccessRate * 100)}%</span>
                  </span>
                )}
                {signals.fileChurn != null && (
                  <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                    Churn: <span className="text-text-1">{signals.fileChurn}</span>
                  </span>
                )}
                {signals.repetitions != null && (
                  <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                    Reps: <span className="text-warning">{signals.repetitions}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
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
