// FSL-1.1-Apache-2.0 — see LICENSE
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
      background: '#282c34',
    }}>
      <div className="col-span-3"><Skeleton className="h-[72px] rounded-none" /></div>
      <Skeleton className="rounded-none" />
      <Skeleton className="rounded-none" />
      <Skeleton className="rounded-none" />
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

  const runningCount = agents.filter((a) => a.status === 'running').length;

  if (!connected) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center space-y-2 text-text-3 font-mono">
          <BarChart3 size={28} className="mx-auto" />
          <p className="text-xs">Connecting to daemon...</p>
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
        background: '#282c34',
        gap: '1px',
      }}>
        {/* R3C1: Token Flow Chart — self-sizing via absolute inset-0 */}
        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 relative">
          <TokenChart data={snapshots} />
        </div>

        {/* R3C2: Cache Ring */}
        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-l border-border">
          <div className="px-3 pt-2.5 pb-1">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Cache Performance</span>
          </div>
          <CacheRing
            cacheRead={tokens.cacheReadTokens}
            cacheCreation={tokens.cacheCreationTokens}
            totalInput={tokens.totalInputTokens}
          />
        </div>

        {/* R3C3: Routing Chart */}
        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-l border-border">
          <div className="px-3 pt-2.5 pb-1">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Model Routing</span>
          </div>
          <RoutingChart routing={routing} />
        </div>

        {/* R4C1: Agent Fleet */}
        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-t border-border">
          <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Agent Fleet</span>
          </div>
          <FleetPanel agentBreakdown={agentBreakdown} rotating={rotating} />
        </div>

        {/* R4C2-3: Intel Panel (spans 2 cols) */}
        <div className="col-span-2 min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-t border-l border-border">
          <IntelPanel
            tokens={tokens}
            rotation={rotation}
            adaptive={adaptive}
            journalist={journalist}
          />
        </div>
      </div>

      {/* Activity feed */}
      <div className="flex-shrink-0 bg-surface-1 border-t border-border">
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}
