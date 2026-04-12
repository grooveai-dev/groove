// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { fmtNum, fmtDollar } from '../../lib/format';
import { HEX } from '../../lib/theme-hex';
import { ScrollArea } from '../ui/scroll-area';

export const TeamBurnPanel = memo(function TeamBurnPanel({ teams = [] }) {
  const totalTokens = teams.reduce((s, t) => s + (t.totalTokens || 0), 0);
  const maxTokens = teams.reduce((m, t) => Math.max(m, t.totalTokens || 0), 0);

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-2.5 pb-1 flex-shrink-0 flex items-center justify-between">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Team Burn</span>
        <span className="text-2xs font-mono text-text-3">{fmtNum(totalTokens)} total</span>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        {teams.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-3 font-mono">No team activity yet</div>
        ) : (
          <div className="px-3 pb-2 space-y-1.5">
            {teams.map((t) => {
              const pct = maxTokens > 0 ? (t.totalTokens / maxTokens) * 100 : 0;
              return (
                <div key={t.teamId} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-xs font-semibold text-text-0 font-sans truncate">{t.teamName}</span>
                      {t.isDefault && (
                        <span className="text-[9px] font-mono text-text-3 uppercase tracking-wider">default</span>
                      )}
                      <span className="text-2xs font-mono text-text-3 flex-shrink-0">
                        {t.agentCount} {t.agentCount === 1 ? 'agent' : 'agents'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 font-mono text-2xs">
                      <span className="text-text-1">{fmtNum(t.totalTokens)}</span>
                      <span className="text-text-3">{fmtDollar(t.totalCostUsd)}</span>
                    </div>
                  </div>
                  <div className="h-0.5 bg-surface-2 rounded-sm overflow-hidden">
                    <div
                      className="h-full rounded-sm transition-all"
                      style={{ width: `${pct}%`, background: HEX.accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
