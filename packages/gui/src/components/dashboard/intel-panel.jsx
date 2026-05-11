// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { fmtNum, fmtPct, fmtDollar, timeAgo } from '../../lib/format';
import { HEX, hexAlpha } from '../../lib/theme-hex';
import { roleColor } from '../../lib/status';
import { HelpCircle } from 'lucide-react';
import { Tooltip } from '../ui/tooltip';

function Tip({ text }) {
  return (
    <Tooltip content={<span className="max-w-[220px] block leading-relaxed">{text}</span>} side="bottom">
      <HelpCircle size={9} className="text-text-4 hover:text-text-2 cursor-help flex-shrink-0 transition-colors ml-0.5" />
    </Tooltip>
  );
}

function Label({ children, tip }) {
  return (
    <div className="text-2xs font-mono text-text-4 uppercase tracking-wider flex items-center gap-0.5">
      {children}{tip && <Tip text={tip} />}
    </div>
  );
}

function Stat({ label, value, tip }) {
  return (
    <div>
      <Label tip={tip}>{label}</Label>
      <div className="text-sm font-mono font-semibold text-text-1 tabular-nums leading-snug">{value}</div>
    </div>
  );
}

function Section({ title, children, tip }) {
  return (
    <div className="px-3 py-2.5">
      <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-2 flex items-center gap-0.5">
        {title}{tip && <Tip text={tip} />}
      </div>
      {children}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-border mx-3" />;
}

/* ── Metrics row ───────────────────────────────────────────── */
function MetricsRow({ tokens, rotation, agentBreakdown }) {
  const allAgents = agentBreakdown || [];
  const withQuality = allAgents.filter((a) => a.quality?.score != null);
  const avgQ = withQuality.length > 0
    ? Math.round(withQuality.reduce((s, a) => s + a.quality.score, 0) / withQuality.length)
    : null;

  return (
    <div className="px-3 py-3 flex items-start gap-5">
      <Stat label="Quality" value={avgQ ?? '—'} tip="Average session quality (0-100). Below 40 triggers auto-rotation." />
      <Stat label="Cache" value={fmtPct((tokens?.cacheHitRate || 0) * 100)} tip="Prompt cache hit rate. Higher = faster + cheaper." />
      <Stat label="Rotations" value={rotation?.totalRotations || 0} tip="Total context rotations this session." />
      {(tokens?.totalCostUsd || 0) > 0 && (
        <Stat label="Cost" value={fmtDollar(tokens.totalCostUsd)} tip="Total cost reported by providers." />
      )}
    </div>
  );
}

/* ── Live agents ───────────────────────────────────────────── */
function LiveAgents({ agentBreakdown, rotation }) {
  const liveScores = rotation?.liveScores || {};
  const running = (agentBreakdown || []).filter((a) => a.status === 'running');
  if (running.length === 0) return null;

  return (
    <>
      <Divider />
      <Section title="Live agents">
        <div className="space-y-0">
          {running.map((agent) => {
            const q = agent.quality || {};
            const score = liveScores[agent.id]?.score ?? q.score;
            const rc = roleColor(agent.role);
            const issues = [
              q.errorCount > 0 && `${q.errorCount} err`,
              q.repetitions > 0 && `${q.repetitions} rep`,
              q.fileChurn > 0 && `${q.fileChurn} churn`,
            ].filter(Boolean);

            return (
              <div key={agent.id} className="flex items-center gap-2 py-1 text-xs font-mono">
                <span className="text-2xs font-semibold capitalize px-1 py-px rounded-sm flex-shrink-0" style={{ background: rc.bg, color: rc.text }}>
                  {agent.role}
                </span>
                <span className="text-text-2 truncate flex-1">{agent.name}</span>
                {issues.length > 0 && (
                  <span className="text-2xs text-text-4 flex-shrink-0">{issues.join(' · ')}</span>
                )}
                <span className="text-text-1 font-semibold tabular-nums flex-shrink-0 w-6 text-right">
                  {score ?? '—'}
                </span>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

/* ── Recent rotations ──────────────────────────────────────── */
function RecentRotations({ rotation }) {
  const history = (rotation?.history || []).slice(-5).reverse();
  if (history.length === 0) return null;

  function reason(r) {
    if (r.reason === 'quality_degradation') return `Q:${r.qualityScore}`;
    if (r.reason === 'token_limit_exceeded') return 'tokens';
    if (r.reason === 'runaway_velocity') return 'velocity';
    if (r.reason === 'natural_compaction') return 'compacted';
    return fmtPct((r.contextUsage || 0) * 100);
  }

  return (
    <>
      <Divider />
      <Section title="Recent rotations">
        <div className="space-y-0">
          {history.map((r, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 text-xs font-mono">
              <span className="text-text-2 truncate flex-1">{r.agentName || r.role}</span>
              <span className="text-text-3 flex-shrink-0">{reason(r)}</span>
              <span className="text-text-4 flex-shrink-0 w-10 text-right">{timeAgo(r.timestamp)}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/* ── Adaptive profiles ─────────────────────────────────────── */
function AdaptiveProfiles({ adaptive }) {
  if (!adaptive?.length) return null;

  function parseKey(key) {
    const parts = key.split(':');
    return { provider: parts[0] || key, role: parts[1] || '' };
  }

  return (
    <>
      <Divider />
      <Section title="Adaptive thresholds" tip="Per-role rotation thresholds. GROOVE learns when each role benefits from rotation and adjusts automatically.">
        <div className="space-y-0">
          {adaptive.map((p) => {
            const { provider, role } = parseKey(p.key);
            const displayRole = role || provider;
            const rc = roleColor(displayRole);

            return (
              <div key={p.key} className="flex items-center gap-2 py-1 text-xs font-mono">
                <span className="text-2xs font-semibold capitalize px-1 py-px rounded-sm flex-shrink-0" style={{ background: rc.bg, color: rc.text }}>
                  {displayRole}
                </span>
                {role && <span className="text-2xs text-text-4 flex-shrink-0">{provider}</span>}
                <div className="flex-1" />
                <span className="text-text-1 font-semibold tabular-nums flex-shrink-0">
                  {fmtPct(p.threshold * 100)}
                </span>
                {p.converged ? (
                  <span className="text-2xs font-semibold flex-shrink-0" style={{ color: HEX.accent }}>Converged</span>
                ) : (
                  <span className="text-2xs text-text-3 flex-shrink-0 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full [animation:node-pulse-bar_1.5s_ease-in-out_infinite]" style={{ background: HEX.text3 }} />
                    Learning
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}

/* ── Journalist ────────────────────────────────────────────── */
function JournalistSection({ journalist }) {
  if (!journalist) return null;
  const hasCycles = (journalist.cycleCount || 0) > 0;
  if (!hasCycles && !journalist.synthesizing) return null;

  return (
    <>
      <Divider />
      <Section title="Journalist">
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className="text-text-2">{journalist.cycleCount || 0} cycles</span>
          {journalist.lastCycleAt && (
            <span className="text-text-4">{timeAgo(journalist.lastCycleAt)}</span>
          )}
          {journalist.synthesizing && (
            <span className="font-semibold text-accent animate-pulse">Synthesizing</span>
          )}
        </div>
        {journalist.lastSummary && (
          <div className="text-xs text-text-3 leading-relaxed mt-1.5 line-clamp-3">
            {journalist.lastSummary}
          </div>
        )}
      </Section>
    </>
  );
}

/* ── Memory ────────────────────────────────────────────────── */
function MemorySection({ memory }) {
  const constraints = memory?.constraints || [];
  const discoveries = memory?.discoveries || [];
  const roles = memory?.roles || [];
  const perRole = memory?.specializations?.perProjectRole || {};
  const agentCount = Object.keys(memory?.specializations?.perAgent || {}).length;

  const total = constraints.length + discoveries.length + roles.length + agentCount;
  if (total === 0) return null;

  const counts = [
    constraints.length > 0 && `${constraints.length} constraints`,
    discoveries.length > 0 && `${discoveries.length} discoveries`,
    roles.length > 0 && `${roles.length} role chains`,
    agentCount > 0 && `${agentCount} specializations`,
  ].filter(Boolean);

  return (
    <>
      <Divider />
      <Section title="Memory" tip="Persistent knowledge across agent rotations. Constraints, error→fix discoveries, and handoff chains.">
        <div className="text-xs font-mono text-text-3 mb-1.5">{counts.join(' · ')}</div>

        {constraints.length > 0 && (
          <div className="mt-2 space-y-0">
            <div className="text-2xs font-mono text-text-4 mb-1">Constraints</div>
            {constraints.slice(0, 3).map((c) => (
              <div key={c.hash} className="text-xs font-mono text-text-2 py-0.5 truncate">
                {c.text}
              </div>
            ))}
            {constraints.length > 3 && (
              <div className="text-2xs font-mono text-text-4">+{constraints.length - 3} more</div>
            )}
          </div>
        )}

        {discoveries.length > 0 && (
          <div className="mt-2 space-y-0">
            <div className="text-2xs font-mono text-text-4 mb-1">Discoveries</div>
            {discoveries.slice(0, 3).map((d, i) => (
              <div key={i} className="text-xs font-mono text-text-2 py-0.5 truncate">
                <span className="text-text-4">{d.trigger}</span> → {d.fix}
              </div>
            ))}
            {discoveries.length > 3 && (
              <div className="text-2xs font-mono text-text-4">+{discoveries.length - 3} more</div>
            )}
          </div>
        )}

        {Object.keys(perRole).length > 0 && (
          <div className="mt-2">
            <div className="text-2xs font-mono text-text-4 mb-1">Role quality</div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {Object.entries(perRole).map(([role, data]) => (
                <span key={role} className="text-xs font-mono text-text-3">
                  <span className="text-text-2 capitalize">{role}</span> Q:{data.avgQualityScore} <span className="text-text-4">({data.sessionCount}s)</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </Section>
    </>
  );
}

/* ── Overhead (collapsed) ──────────────────────────────────── */
function OverheadSection({ tokens }) {
  if (!tokens?.internalOverhead?.tokens || !tokens?.savings?.total) return null;
  const oh = tokens.internalOverhead;
  const sv = tokens.savings;
  const pct = tokens.totalTokens > 0 ? Math.round((oh.tokens / tokens.totalTokens) * 100) : 0;

  return (
    <>
      <Divider />
      <div className="px-3 py-2.5 flex items-center gap-3 text-xs font-mono">
        <span className="text-text-4">Overhead</span>
        <span className="text-text-3 tabular-nums">{fmtNum(oh.tokens)} ({pct}%)</span>
        <div className="flex-1" />
        <span className="text-text-4">Saved</span>
        <span className="text-text-3 tabular-nums">{fmtNum(sv.total)}</span>
      </div>
    </>
  );
}

/* ── Intel Panel (main export) ──────────────────────────────── */
const IntelPanel = memo(function IntelPanel({ tokens, rotation, adaptive, journalist, agentBreakdown, memory }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 px-3 pt-2.5 pb-1.5">
        <span className="text-2xs font-mono text-text-3 uppercase tracking-widest">Intel</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <MetricsRow tokens={tokens} rotation={rotation} agentBreakdown={agentBreakdown} />
        <LiveAgents agentBreakdown={agentBreakdown} rotation={rotation} />
        <RecentRotations rotation={rotation} />
        <AdaptiveProfiles adaptive={adaptive} />
        <JournalistSection journalist={journalist} />
        <MemorySection memory={memory} />
        <OverheadSection tokens={tokens} />
        <div className="h-3" />
      </div>
    </div>
  );
});

export { IntelPanel };
