// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { HEX } from '../../lib/theme-hex';
import { fmtNum, fmtPct } from '../../lib/format';

const TIER_COLORS = { heavy: HEX.danger, medium: HEX.warning, light: HEX.success };
const TIER_LABELS = { heavy: 'Heavy', medium: 'Medium', light: 'Light' };

const DONUT_SIZE = 80;
const DONUT_STROKE = 6;
const DONUT_RADIUS = (DONUT_SIZE - DONUT_STROKE) / 2;
const DONUT_CIRCUMFERENCE = 2 * Math.PI * DONUT_RADIUS;

function TierDonut({ byTier, total, tiers }) {
  let offset = 0;
  const segments = [];
  for (const tier of tiers) {
    const count = byTier[tier] || 0;
    if (count === 0) continue;
    const pct = count / total;
    const dashLen = pct * DONUT_CIRCUMFERENCE;
    segments.push({ tier, dashLen, offset });
    offset += dashLen;
  }

  const heavyPct = total > 0 ? Math.round(((byTier.heavy || 0) / total) * 100) : 0;

  return (
    <svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`} className="flex-shrink-0">
      <circle
        cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_RADIUS}
        fill="none" strokeWidth={DONUT_STROKE}
        className="stroke-surface-4"
      />
      {segments.map((seg) => (
        <circle
          key={seg.tier}
          cx={DONUT_SIZE / 2} cy={DONUT_SIZE / 2} r={DONUT_RADIUS}
          fill="none" strokeWidth={DONUT_STROKE}
          strokeLinecap="butt"
          style={{
            stroke: TIER_COLORS[seg.tier],
            strokeDasharray: `${seg.dashLen} ${DONUT_CIRCUMFERENCE - seg.dashLen}`,
            strokeDashoffset: -seg.offset,
          }}
          transform={`rotate(-90 ${DONUT_SIZE / 2} ${DONUT_SIZE / 2})`}
        />
      ))}
      <text
        x={DONUT_SIZE / 2} y={DONUT_SIZE / 2 - 2}
        textAnchor="middle" dominantBaseline="central"
        className="fill-text-0 text-sm font-mono font-semibold"
      >
        {fmtNum(total)}
      </text>
      <text
        x={DONUT_SIZE / 2} y={DONUT_SIZE / 2 + 11}
        textAnchor="middle" dominantBaseline="central"
        className="fill-text-3 font-mono"
        style={{ fontSize: 7 }}
      >
        decisions
      </text>
    </svg>
  );
}

const RoutingChart = memo(function RoutingChart({ routing, agentBreakdown }) {
  if (!routing) return null;

  const { byTier = {}, totalDecisions = 0, autoRoutedCount = 0 } = routing;
  const tiers = ['heavy', 'medium', 'light'];
  const total = tiers.reduce((s, t) => s + (byTier[t] || 0), 0);

  const modelUsage = {};
  for (const a of (agentBreakdown || [])) {
    const model = a.model || 'default';
    if (!modelUsage[model]) modelUsage[model] = { tokens: 0, agents: 0 };
    modelUsage[model].tokens += a.tokens || 0;
    modelUsage[model].agents += 1;
  }
  const modelEntries = Object.entries(modelUsage).sort((a, b) => b[1].tokens - a[1].tokens);
  const maxModelTokens = modelEntries.length > 0 ? modelEntries[0][1].tokens : 0;

  return (
    <div className="flex flex-col h-full px-3 py-3 overflow-y-auto">
      {/* Tier donut + legend */}
      {total > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <TierDonut byTier={byTier} total={total} tiers={tiers} />
          <div className="flex flex-col gap-1.5 flex-1 min-w-0">
            {tiers.map((tier) => {
              const count = byTier[tier] || 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div key={tier} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TIER_COLORS[tier] }} />
                  <span className="text-2xs font-mono text-text-2 flex-1">{TIER_LABELS[tier]}</span>
                  <span className="text-2xs font-mono text-text-4 tabular-nums">{count}</span>
                  <span className="text-2xs font-mono text-text-4 tabular-nums w-8 text-right">{fmtPct(pct)}</span>
                </div>
              );
            })}
            {autoRoutedCount > 0 && (
              <div className="text-2xs font-mono text-text-4 mt-0.5">{autoRoutedCount} auto-routed</div>
            )}
          </div>
        </div>
      )}

      {/* Model usage breakdown */}
      {modelEntries.length > 0 && (
        <div className="space-y-1.5 flex-1">
          <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Models in Use</span>
          <div className="space-y-1.5">
            {modelEntries.map(([model, usage]) => {
              const barPct = maxModelTokens > 0 ? (usage.tokens / maxModelTokens) * 100 : 0;
              return (
                <div key={model} className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-text-1 flex-1 truncate">{shortModel(model)}</span>
                    <span className="text-2xs font-mono text-text-3 tabular-nums">{usage.agents} agent{usage.agents !== 1 ? 's' : ''}</span>
                    <span className="text-xs font-mono text-text-1 tabular-nums">{fmtNum(usage.tokens)}</span>
                  </div>
                  <div className="h-0.5 bg-surface-4 rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-all duration-500"
                      style={{ width: `${Math.max(barPct, 2)}%`, background: HEX.accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {total === 0 && modelEntries.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-text-3 font-mono">
          No routing data
        </div>
      )}
    </div>
  );
});

function shortModel(id) {
  if (!id || id === 'auto' || id === 'default') return 'Default';
  const claude = id.match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)/);
  if (claude) return `${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}.${claude[3]}`;
  if (id.startsWith('gemini-')) return id.replace('gemini-', 'Gemini ').replace('-preview', '');
  return id;
}

export { RoutingChart };
