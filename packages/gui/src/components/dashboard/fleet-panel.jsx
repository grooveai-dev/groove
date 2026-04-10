// FSL-1.1-Apache-2.0 — see LICENSE
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { StatusDot } from '../ui/status-dot';
import { fmtNum, fmtPct } from '../../lib/format';
import { cn } from '../../lib/cn';
import { ScrollArea } from '../ui/scroll-area';

const STATUS_VARIANT = {
  running: 'success', starting: 'warning', stopped: 'default',
  crashed: 'danger', completed: 'accent', killed: 'default',
};

export function FleetPanel({ agents }) {
  if (!agents?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-4 font-sans p-4">
        No agents running
      </div>
    );
  }

  // Group by team
  const teams = {};
  for (const a of agents) {
    const team = a.teamId || 'Ungrouped';
    if (!teams[team]) teams[team] = [];
    teams[team].push(a);
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-4">
        {Object.entries(teams).map(([team, members]) => (
          <div key={team}>
            <div className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider mb-2">{team}</div>
            <div className="space-y-1">
              {members.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-surface-5 transition-colors">
                  <StatusDot status={a.status} size="sm" />
                  <Avatar name={a.name} role={a.role} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-text-0 font-sans truncate">{a.name}</div>
                  </div>
                  <span className="text-2xs font-mono text-text-3">{fmtNum(a.tokensUsed || 0)}</span>
                  {/* Mini context bar */}
                  <div className="w-10 h-1 bg-surface-0 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(a.contextUsage || 0, 100)}%`,
                        background: (a.contextUsage || 0) >= 80 ? 'var(--color-danger)' : (a.contextUsage || 0) >= 60 ? 'var(--color-warning)' : 'var(--color-success)',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
