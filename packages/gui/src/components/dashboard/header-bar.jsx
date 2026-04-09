// FSL-1.1-Apache-2.0 — see LICENSE
import { fmtUptime, timeAgo } from '../../lib/format';
import { StatusDot } from '../ui/status-dot';
import { RefreshCw } from 'lucide-react';

export function DashboardHeader({ connected, runningCount, totalCount, uptime, lastFetch }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2.5 bg-surface-1 border-b border-border">
      <h2 className="text-sm font-semibold text-text-0 font-sans">Command Center</h2>
      <div className="flex-1" />

      {connected && (
        <div className="flex items-center gap-4 text-2xs text-text-3 font-sans">
          <span>{runningCount}/{totalCount} agents</span>
          {uptime > 0 && <span>Up {fmtUptime(uptime)}</span>}
          {lastFetch > 0 && (
            <span className="flex items-center gap-1 text-text-4">
              <RefreshCw size={10} /> {timeAgo(lastFetch)}
            </span>
          )}
        </div>
      )}
      <StatusDot status={connected ? 'running' : 'crashed'} size="sm" />
    </div>
  );
}
