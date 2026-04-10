// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { fmtUptime, timeAgo } from '../../lib/format';
import { StatusDot } from '../ui/status-dot';
import { RefreshCw } from 'lucide-react';

const DashboardHeader = memo(function DashboardHeader({ connected, runningCount, totalCount, uptime, lastFetch, activeTeam }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-surface-1 border-b border-border">
      <h2 className="text-xs font-semibold text-text-0 font-sans tracking-wide uppercase">Command Center</h2>

      {activeTeam && (
        <>
          <span className="text-text-4">/</span>
          <span className="text-xs font-mono text-text-2">{activeTeam.name}</span>
        </>
      )}

      <div className="flex-1" />

      {connected && (
        <div className="flex items-center gap-3.5 text-xs font-mono text-text-2">
          <span>
            <span className="text-text-1">{runningCount}</span>
            <span className="text-text-3">/{totalCount}</span>
            <span className="ml-1 text-text-3">agents</span>
          </span>
          {uptime > 0 && (
            <span className="text-text-3">Up {fmtUptime(uptime)}</span>
          )}
          {lastFetch > 0 && (
            <span className="flex items-center gap-1 text-text-4">
              <RefreshCw size={9} />
              <span>{timeAgo(lastFetch)}</span>
            </span>
          )}
        </div>
      )}

      <StatusDot status={connected ? 'running' : 'crashed'} size="sm" />
    </div>
  );
});

export { DashboardHeader };
