// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { fmtUptime, timeAgo } from '../../lib/format';
import { StatusDot } from '../ui/status-dot';
import { RefreshCw } from 'lucide-react';

const DashboardHeader = memo(function DashboardHeader({ connected, runningCount, totalCount, uptime, lastFetch, activeTeam }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-surface-1 border-b border-[#262a32]">
      <h2 className="text-[12px] font-semibold text-[#e6e6e6] font-sans tracking-wide uppercase">Command Center</h2>

      {activeTeam && (
        <>
          <span className="text-[#2a2e36]">/</span>
          <span className="text-[9px] font-mono text-[#505862]">{activeTeam.name}</span>
        </>
      )}

      <div className="flex-1" />

      {connected && (
        <div className="flex items-center gap-3.5 text-[9px] font-mono text-[#505862]">
          <span>
            <span className="text-[#8b929e]">{runningCount}</span>
            <span className="text-[#3a3f4b]">/{totalCount}</span>
            <span className="ml-1">agents</span>
          </span>
          {uptime > 0 && (
            <span>Up {fmtUptime(uptime)}</span>
          )}
          {lastFetch > 0 && (
            <span className="flex items-center gap-1 text-[#3a3f4b]">
              <RefreshCw size={8} />
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
