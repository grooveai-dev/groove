// FSL-1.1-Apache-2.0 — see LICENSE
import { useRef, useState, useEffect } from 'react';
import { useDashboard } from '../lib/hooks/use-dashboard';
import { DashboardHeader } from '../components/dashboard/header-bar';
import { KpiStrip } from '../components/dashboard/kpi-card';
import { FleetPanel } from '../components/dashboard/fleet-panel';
import { TokenChart } from '../components/dashboard/token-chart';
import { CacheRing } from '../components/dashboard/cache-ring';
import { RoutingChart } from '../components/dashboard/routing-chart';
import { IntelPanel } from '../components/dashboard/intel-panel';
import { ActivityFeed } from '../components/dashboard/activity-feed';
import { Skeleton } from '../components/ui/skeleton';
import { HEX } from '../lib/theme-hex';
import { fmtNum, fmtDollar, fmtPct } from '../lib/format';
import { BarChart3 } from 'lucide-react';

function DashboardSkeleton() {
  return (
    <div className="flex-1 grid gap-px p-0" style={{
      gridTemplateRows: 'auto minmax(0, 1fr) minmax(0, 1fr)',
      gridTemplateColumns: '3fr 1.5fr 1.5fr',
      background: '#1a1e25',
    }}>
      {/* KPI row */}
      <div className="col-span-3"><Skeleton className="h-[72px] rounded-none" /></div>
      {/* Chart row */}
      <Skeleton className="rounded-none" />
      <Skeleton className="rounded-none" />
      <Skeleton className="rounded-none" />
      {/* Intel row */}
      <Skeleton className="rounded-none" />
      <div className="col-span-2"><Skeleton className="h-full rounded-none" /></div>
    </div>
  );
}

export default function DashboardView() {
  const {
    data, loading, agents, connected, kpiHistory, lastFetch,
    agentBreakdown, routing, rotation, adaptive, journalist, rotating,
  } = useDashboard();

  const chartRef = useRef(null);
  const [chartSize, setChartSize] = useState({ width: 400, height: 200 });

  const runningCount = agents.filter((a) => a.status === 'running').length;

  // Measure token chart container
  useEffect(() => {
    if (!chartRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setChartSize({ width: Math.floor(width), height: Math.floor(height) });
    });
    observer.observe(chartRef.current);
    return () => observer.disconnect();
  }, []);

  if (!connected) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center space-y-2 text-[#3a3f4b] font-mono">
          <BarChart3 size={28} className="mx-auto" />
          <p className="text-[10px]">Connecting to daemon...</p>
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
  const tokens = {
    totalTokens: rawTokens.totalTokens || 0,
    totalCostUsd: rawTokens.totalCostUsd || 0,
    totalInputTokens: rawTokens.totalInputTokens || 0,
    totalOutputTokens: rawTokens.totalOutputTokens || 0,
    cacheReadTokens: rawTokens.cacheReadTokens || 0,
    cacheCreationTokens: rawTokens.cacheCreationTokens || 0,
    cacheHitRate: rawTokens.cacheHitRate || 0,
    totalTurns: rawTokens.totalTurns || 0,
    agentCount: rawTokens.agentCount || 0,
    savings: rawTokens.savings || {},
  };

  const totalHypothetical = tokens.totalTokens + (tokens.savings.total || 0);
  const efficiency = totalHypothetical > 0 ? ((tokens.savings.total || 0) / totalHypothetical) * 100 : 0;
  const ioRatio = tokens.totalOutputTokens > 0 ? (tokens.totalInputTokens / tokens.totalOutputTokens).toFixed(1) : '—';

  const timeline = data.timeline || {};
  const snapshots = timeline.snapshots || [];
  const events = timeline.events || data.events || [];

  // Build KPI definitions
  const kpis = [
    { label: 'Tokens Used',  value: fmtNum(tokens.totalTokens),        sparkData: kpiHistory.tokens,      color: HEX.accent },
    { label: 'Total Cost',   value: fmtDollar(tokens.totalCostUsd),    sparkData: kpiHistory.cost,        color: HEX.warning },
    { label: 'Tokens Saved', value: fmtNum(tokens.savings.total || 0), sparkData: kpiHistory.saved,       color: HEX.success },
    { label: 'Efficiency',   value: fmtPct(efficiency),                sparkData: kpiHistory.efficiency,  color: HEX.purple },
    { label: 'Cache Rate',   value: fmtPct(tokens.cacheHitRate * 100), sparkData: kpiHistory.cache,       color: HEX.info },
    { label: 'I/O Ratio',    value: `${ioRatio}:1`,                    sparkData: kpiHistory.inputOutput, color: HEX.orange },
    { label: 'Agents',       value: `${runningCount}/${agents.length}`, sparkData: kpiHistory.agents,      color: HEX.accent },
    { label: 'Turns',        value: fmtNum(tokens.totalTurns),         sparkData: kpiHistory.turns,       color: HEX.text2 },
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <DashboardHeader
        connected={connected}
        runningCount={runningCount}
        totalCount={agents.length}
        uptime={data.uptime || 0}
        lastFetch={lastFetch}
        activeTeam={data.activeTeam}
      />

      {/* KPI Strip */}
      <KpiStrip kpis={kpis} />

      {/* Main grid */}
      <div className="flex-1 min-h-0 grid" style={{
        gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
        gridTemplateColumns: '3fr 1.5fr 1.5fr',
        background: '#1a1e25',
        gap: '1px',
      }}>
        {/* R3C1: Token Flow Chart */}
        <div ref={chartRef} className="min-w-0 min-h-0 bg-[#1e2127]">
          {chartSize.width > 0 && (
            <TokenChart data={snapshots} width={chartSize.width} height={chartSize.height} />
          )}
        </div>

        {/* R3C2: Cache Ring */}
        <div className="min-w-0 min-h-0 bg-[#1e2127] flex flex-col">
          <div className="px-3 pt-2 pb-1">
            <span className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest">Cache Performance</span>
          </div>
          <CacheRing
            cacheRead={tokens.cacheReadTokens}
            cacheCreation={tokens.cacheCreationTokens}
            totalInput={tokens.totalInputTokens}
          />
        </div>

        {/* R3C3: Routing Chart */}
        <div className="min-w-0 min-h-0 bg-[#1e2127] flex flex-col">
          <div className="px-3 pt-2 pb-1">
            <span className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest">Model Routing</span>
          </div>
          <RoutingChart routing={routing} />
        </div>

        {/* R4C1: Agent Fleet */}
        <div className="min-w-0 min-h-0 bg-[#1e2127] flex flex-col">
          <div className="px-3 pt-2 pb-1 flex-shrink-0">
            <span className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest">Agent Fleet</span>
          </div>
          <FleetPanel agentBreakdown={agentBreakdown} rotating={rotating} />
        </div>

        {/* R4C2-3: Intel Panel (spans 2 cols) */}
        <div className="col-span-2 min-w-0 min-h-0 bg-[#1e2127] flex flex-col">
          <IntelPanel
            tokens={tokens}
            rotation={rotation}
            adaptive={adaptive}
            journalist={journalist}
          />
        </div>
      </div>

      {/* Activity feed */}
      <div className="flex-shrink-0 bg-[#1e2127] border-t border-[#262a32]">
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}
