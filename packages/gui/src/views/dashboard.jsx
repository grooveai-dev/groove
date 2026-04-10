// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useState, useEffect } from 'react';
import { useDashboard } from '../lib/hooks/use-dashboard';
import { DashboardHeader } from '../components/dashboard/header-bar';
import { KpiCard } from '../components/dashboard/kpi-card';
import { FleetPanel } from '../components/dashboard/fleet-panel';
import { SavingsPanel } from '../components/dashboard/savings-panel';
import { TokenChart } from '../components/dashboard/token-chart';
import { ActivityFeed } from '../components/dashboard/activity-feed';
import { Skeleton } from '../components/ui/skeleton';
import { HEX } from '../lib/theme-hex';
import { fmtNum, fmtDollar, fmtPct } from '../lib/format';
import { BarChart3 } from 'lucide-react';

function DashboardSkeleton() {
  return (
    <div className="flex-1 flex flex-col p-4 gap-3">
      <div className="flex gap-3">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-16 flex-1 rounded-md" />
        ))}
      </div>
      <div className="flex gap-3 flex-1">
        <Skeleton className="flex-[5] rounded-md" />
        <Skeleton className="flex-[3] rounded-md" />
        <Skeleton className="flex-[3] rounded-md" />
      </div>
    </div>
  );
}

export default function DashboardView() {
  const { data, loading, agents, connected, kpiHistory, lastFetch } = useDashboard();
  const chartContainerRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 400, height: 200 });

  const runningCount = agents.filter((a) => a.status === 'running').length;

  // Measure chart container
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setChartSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(chartContainerRef.current);
    return () => observer.disconnect();
  }, []);

  if (!connected) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center space-y-2 text-text-4 font-sans">
          <BarChart3 size={32} className="mx-auto" />
          <p className="text-sm">Connecting to daemon...</p>
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="flex flex-col h-full">
        <DashboardHeader connected={connected} runningCount={0} totalCount={0} uptime={0} lastFetch={0} />
        <DashboardSkeleton />
      </div>
    );
  }

  const rawTokens = data.tokens || {};
  // Normalize field names from API to what the dashboard expects
  const tokens = {
    totalUsed: rawTokens.totalTokens || 0,
    totalCostUsd: rawTokens.totalCostUsd || 0,
    totalSaved: rawTokens.savings?.total || 0,
    cacheHitRate: rawTokens.cacheHitRate || 0,
    totalInputTokens: rawTokens.totalInputTokens || 0,
    totalOutputTokens: rawTokens.totalOutputTokens || 0,
    cacheReadTokens: rawTokens.cacheReadTokens || 0,
    cacheCreationTokens: rawTokens.cacheCreationTokens || 0,
    totalTurns: rawTokens.totalTurns || 0,
    agentCount: rawTokens.agentCount || 0,
    savings: rawTokens.savings || {},
    perAgent: rawTokens.perAgent || [],
  };
  const timeline = data.timeline || [];
  const totalHypothetical = tokens.totalUsed + tokens.totalSaved;
  const efficiency = totalHypothetical > 0 ? (tokens.totalSaved / totalHypothetical) * 100 : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <DashboardHeader
        connected={connected}
        runningCount={runningCount}
        totalCount={agents.length}
        uptime={data.uptime || 0}
        lastFetch={lastFetch}
      />

      {/* KPI Strip */}
      <div className="flex flex-shrink-0 border-b border-border">
        <KpiCard label="Tokens Used" value={fmtNum(tokens.totalUsed)} sparkData={kpiHistory.tokens} color={HEX.accent} className="flex-1" />
        <KpiCard label="Total Cost" value={fmtDollar(tokens.totalCostUsd)} sparkData={kpiHistory.cost} color={HEX.warning} className="flex-1 border-l border-border-subtle" />
        <KpiCard label="Tokens Saved" value={fmtNum(tokens.totalSaved)} sparkData={kpiHistory.saved} color={HEX.success} className="flex-1 border-l border-border-subtle" />
        <KpiCard label="Efficiency" value={fmtPct(efficiency)} sparkData={kpiHistory.efficiency} color={HEX.purple} className="flex-1 border-l border-border-subtle" />
        <KpiCard label="Cache Rate" value={fmtPct(tokens.cacheHitRate)} sparkData={kpiHistory.cache} color={HEX.info} className="flex-1 border-l border-border-subtle" />
      </div>

      {/* Main grid */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Token chart */}
        <div ref={chartContainerRef} className="flex-[5] min-w-0 bg-surface-1 border-r border-border-subtle">
          {chartSize.width > 0 && (
            <TokenChart data={timeline.snapshots || timeline} width={chartSize.width} height={chartSize.height} />
          )}
        </div>

        {/* Center: Agent fleet */}
        <div className="flex-[3] flex flex-col min-w-0 bg-surface-1 border-r border-border-subtle">
          <div className="px-3 py-2 border-b border-border-subtle">
            <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Agent Fleet</span>
          </div>
          <FleetPanel agents={agents} />
        </div>

        {/* Right: Savings */}
        <div className="flex-[3] flex flex-col min-w-0 bg-surface-1">
          <div className="px-3 py-2 border-b border-border-subtle">
            <span className="text-2xs font-semibold text-text-3 font-sans uppercase tracking-wider">Savings</span>
          </div>
          <SavingsPanel data={tokens} rotation={data.rotation} routing={data.routing} adaptive={data.adaptive} />
        </div>
      </div>

      {/* Activity feed */}
      <div className="flex-shrink-0 border-t border-border bg-surface-1">
        <ActivityFeed events={timeline.events || data.events || []} />
      </div>
    </div>
  );
}
