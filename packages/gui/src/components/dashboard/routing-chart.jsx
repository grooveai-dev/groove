// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { HEX } from '../../lib/theme-hex';
import { fmtNum, fmtPct } from '../../lib/format';

const TIER_COLORS = { heavy: HEX.danger, medium: HEX.warning, light: HEX.success };
const TIER_LABELS = { heavy: 'Heavy', medium: 'Medium', light: 'Light' };

const RoutingChart = memo(function RoutingChart({ routing, agentBreakdown }) {
  if (!routing) return null;

  const { byTier = {}, totalDecisions = 0, autoRoutedCount = 0 } = routing;
  const tiers = ['heavy', 'medium', 'light'];
  const total = tiers.reduce((s, t) => s + (byTier[t] || 0), 0);

  // Build model usage from agent breakdown
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
      {/* Tier distribution bar */}
      {total > 0 && (
        <div className="space-y-1.5 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Tier Distribution</span>
            <span className="text-2xs font-mono text-text-4 ml-auto tabular-nums">{fmtNum(total)} decisions</span>
          </div>
          {/* Stacked horizontal bar */}
          <div className="h-0.5 bg-surface-2 rounded-sm overflow-hidden flex">
            {tiers.map((tier) => {
              const count = byTier[tier] || 0;
              if (count === 0) return null;
              const pct = (count / total) * 100;
              return (
                <div
                  key={tier}
                  className="h-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: TIER_COLORS[tier] }}
                  title={`${TIER_LABELS[tier]}: ${count} (${Math.round(pct)}%)`}
                />
              );
            })}
          </div>
          {/* Tier legend */}
          <div className="flex items-center gap-3">
            {tiers.map((tier) => {
              const count = byTier[tier] || 0;
              if (count === 0) return null;
              const pct = total > 0 ? (count / total) * 100 : 0;
              return (
                <div key={tier} className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: TIER_COLORS[tier] }} />
                  <span className="text-2xs font-mono text-text-2">{TIER_LABELS[tier]}</span>
                  <span className="text-2xs font-mono text-text-4 tabular-nums">{fmtPct(pct)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Model usage breakdown */}
      {modelEntries.length > 0 && (
        <div className="space-y-1.5 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-wider">Models in Use</span>
            {autoRoutedCount > 0 && (
              <span className="text-2xs font-mono text-text-4 ml-auto">{autoRoutedCount} auto</span>
            )}
          </div>
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
                  <div className="h-[3px] bg-surface-4 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
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
