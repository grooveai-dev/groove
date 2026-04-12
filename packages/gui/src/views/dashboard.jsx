// FSL-1.1-Apache-2.0 — see LICENSE
import { useDashboard } from '../lib/hooks/use-dashboard';
import { useGrooveStore } from '../stores/groove';
import { DashboardHeader } from '../components/dashboard/header-bar';
import { KpiStrip } from '../components/dashboard/kpi-card';
import { FleetPanel } from '../components/dashboard/fleet-panel';
import { TokenChart } from '../components/dashboard/token-chart';
import { CacheRing } from '../components/dashboard/cache-ring';
import { RoutingChart } from '../components/dashboard/routing-chart';
import { IntelPanel } from '../components/dashboard/intel-panel';
import { TeamBurnPanel } from '../components/dashboard/team-burn-panel';
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
    agentBreakdown, routing, rotation, adaptive, journalist, rotating, teamBurn, memory,
  } = useDashboard();

  const teams = useGrooveStore((s) => s.teams);
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
    internalOverhead: rawTokens.internalOverhead || { tokens: 0, costUsd: 0, components: {} },
  };

  const ioRatio = tokens.totalOutputTokens > 0 ? (tokens.totalInputTokens / tokens.totalOutputTokens).toFixed(1) : '—';
  const totalRotations = rotation?.totalRotations || 0;

  const agentsWithQ = (agentBreakdown || []).filter((a) => a.quality?.score != null);
  const avgQuality = agentsWithQ.length > 0
    ? Math.round(agentsWithQ.reduce((s, a) => s + a.quality.score, 0) / agentsWithQ.length)
    : null;

  const timeline = data.timeline || {};
  const snapshots = timeline.snapshots || [];
  const events = timeline.events || data.events || [];

  const kpis = [
    { label: 'Tokens Used',  value: fmtNum(tokens.totalTokens),        sparkData: kpiHistory.tokens,      color: HEX.accent, hint: 'Total tokens consumed across all agents — input, output, and cache tokens combined.' },
    { label: 'Total Cost',   value: fmtDollar(tokens.totalCostUsd),    sparkData: kpiHistory.cost,        color: HEX.warning, hint: 'Actual cost reported by providers. Claude Code reports real billing; other providers use estimated rates.' },
    { label: 'Quality',      value: avgQuality != null ? `${avgQuality}` : '—', sparkData: kpiHistory.saved, color: avgQuality >= 70 ? HEX.success : avgQuality >= 40 ? HEX.warning : HEX.danger, hint: 'Average session quality score (0-100) across running agents. Based on error rate, repetitions, file churn, and tool success. Below 40 triggers auto-rotation.' },
    { label: 'Cache Rate',   value: fmtPct(tokens.cacheHitRate * 100), sparkData: kpiHistory.cache,       color: HEX.info, hint: 'Percentage of input tokens served from prompt cache. Higher = faster responses and lower cost. Managed by your AI provider.' },
    { label: 'Rotations',    value: `${totalRotations}`,               sparkData: kpiHistory.efficiency,  color: HEX.purple, hint: 'Total context rotations — includes quality-based (auto), context threshold, natural compaction (provider-managed), and manual rotations.' },
    { label: 'I/O Ratio',    value: `${ioRatio}:1`,                    sparkData: kpiHistory.inputOutput, color: HEX.orange, hint: 'Ratio of input to output tokens. High ratios mean agents are reading more than writing — common for analysis tasks.' },
    { label: 'Agents',       value: `${runningCount}/${agents.length}`, sparkData: kpiHistory.agents,      color: HEX.accent, hint: 'Running agents out of total spawned this session (including completed and crashed).' },
    { label: 'Turns',        value: fmtNum(tokens.totalTurns),         sparkData: kpiHistory.turns,       color: HEX.text2, hint: 'Total conversation turns across all agents. Each turn is one request-response cycle with the AI provider.' },
  ];

  return (
    <div className="flex flex-col h-full">
      <DashboardHeader
        connected={connected}
        runningCount={runningCount}
        totalCount={agents.length}
        uptime={data.uptime || 0}
        lastFetch={lastFetch}
        activeTeam={data.activeTeam}
      />

      <KpiStrip kpis={kpis} />

      <div className="flex-1 min-h-0 grid" style={{
        gridTemplateRows: 'minmax(0, 1fr) minmax(0, 1fr)',
        gridTemplateColumns: '3fr 1.5fr 1.5fr',
        background: '#282c34',
        gap: '1px',
      }}>
        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 relative">
          <TokenChart data={snapshots} />
        </div>

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

        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-l border-border">
          <div className="px-3 pt-2.5 pb-1">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Model Routing</span>
          </div>
          <RoutingChart routing={routing} agentBreakdown={agentBreakdown} />
        </div>

        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-t border-border">
          <div className="px-3 pt-2.5 pb-1 flex-shrink-0">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Agent Fleet</span>
          </div>
          <FleetPanel agentBreakdown={agentBreakdown} rotating={rotating} teams={teams} />
        </div>

        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-t border-l border-border">
          <IntelPanel
            tokens={tokens}
            rotation={rotation}
            adaptive={adaptive}
            journalist={journalist}
            agentBreakdown={agentBreakdown}
            memory={memory}
          />
        </div>

        <div className="min-w-0 min-h-0 overflow-hidden bg-surface-1 flex flex-col border-t border-l border-border">
          <TeamBurnPanel teams={teamBurn} />
        </div>
      </div>

      <div className="flex-shrink-0 bg-surface-1 border-t border-border">
        <ActivityFeed events={events} />
      </div>
    </div>
  );
}
