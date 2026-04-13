// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { fmtNum, fmtPct, fmtDollar, timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { roleColor } from '../../lib/status';
import { Activity, Brain, Radio, AlertTriangle, CheckCircle, RotateCw, HelpCircle, BookOpen } from 'lucide-react';
import { Tooltip } from '../ui/tooltip';

/* ── Tiny SVG sparkline for inline use ──────────────────────── */
function TinySparkline({ data, color = HEX.accent, width = 60, height = 16 }) {
  if (!data || data.length < 2) return <div style={{ width, height }} />;
  const vals = Array.isArray(data[0]) ? data : data.map((d) => (typeof d === 'number' ? d : d.v));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;

  const points = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round" strokeOpacity="0.7" />
    </svg>
  );
}

/* ── Info tip (? icon with tooltip) ────────────────────────── */
function InfoTip({ text, side = 'bottom' }) {
  return (
    <Tooltip content={<span className="max-w-[220px] block leading-relaxed">{text}</span>} side={side}>
      <HelpCircle size={10} className="text-text-4 hover:text-text-2 cursor-help flex-shrink-0 transition-colors inline-block ml-1" />
    </Tooltip>
  );
}

/* ── Quality score color ───────────────────────────────────── */
function qualityColor(score) {
  if (score == null) return HEX.text3;
  if (score >= 70) return '#4ae168';
  if (score >= 40) return '#e5c07b';
  return '#e06c75';
}

/* ── Signal pill ───────────────────────────────────────────── */
function SignalPill({ label, value, danger }) {
  if (value == null || value === 0) return null;
  return (
    <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
      {label}: <span style={{ color: danger ? '#e06c75' : HEX.text1 }}>{value}</span>
    </span>
  );
}

/* ── Quality bar ───────────────────────────────────────────── */
function QualityBar({ score }) {
  const pct = Math.max(0, Math.min(100, score || 0));
  const color = qualityColor(score);
  return (
    <div className="h-1 rounded-full overflow-hidden flex-1" style={{ background: 'rgba(51,175,188,0.08)' }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ── Progress bar ──────────────────────────────────────────── */
function ProgressBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-text-2">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-semibold tabular-nums" style={{ color }}>
            {pct >= 1 ? Math.round(pct) : pct > 0 ? pct.toFixed(1) : 0}%
          </span>
          <span className="text-2xs font-mono text-text-3 tabular-nums w-10 text-right">{fmtNum(value)}</span>
        </div>
      </div>
      <div className="h-[7px] rounded-full overflow-hidden" style={{ background: 'rgba(51,175,188,0.08)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Health Tab ─────────────────────────────────────────────── */
function HealthTab({ tokens, rotation, agentBreakdown }) {
  const recentHistory = (rotation?.history || []).slice(-10).reverse();
  const liveScores = rotation?.liveScores || {};

  const runningAgents = (agentBreakdown || []).filter((a) => a.status === 'running');
  const allAgents = agentBreakdown || [];
  const agentsWithQuality = allAgents.filter((a) => a.quality?.score != null);
  const avgQuality = agentsWithQuality.length > 0
    ? Math.round(agentsWithQuality.reduce((s, a) => s + a.quality.score, 0) / agentsWithQuality.length)
    : null;

  const completions = allAgents.filter((a) => a.status === 'completed' || a.status === 'stopped').length;
  const crashes = allAgents.filter((a) => a.status === 'crashed').length;
  const completionRate = (completions + crashes) > 0
    ? Math.round((completions / (completions + crashes)) * 100)
    : 100;

  return (
    <div className="p-3 space-y-4">
      {/* Hero stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Quality
            <InfoTip text="Average session quality score (0-100). Based on error rate, tool failures, repetitions, and file churn. Below 40 triggers auto-rotation to prevent wasted tokens." />
          </div>
          <div className="text-base font-mono font-bold text-text-1 tabular-nums leading-none">
            {avgQuality ?? '—'}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Rotations
            <InfoTip text="Context rotations: quality-based (q), context threshold (c), and natural compactions (n) from provider-managed context resets. Each rotation preserves progress via a journalist handoff brief." />
          </div>
          <div className="text-base font-mono font-bold text-text-1 tabular-nums leading-none">
            {rotation?.totalRotations || 0}
          </div>
          {(rotation?.qualityRotations > 0 || rotation?.contextRotations > 0 || rotation?.naturalCompactions > 0) && (
            <div className="text-2xs font-mono text-text-4 mt-0.5">
              {rotation.qualityRotations || 0}q / {rotation.contextRotations || 0}c / {rotation.naturalCompactions || 0}n
            </div>
          )}
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Cache
            <InfoTip text="Prompt cache hit rate. Cache reads are ~90% cheaper than regular input tokens. Managed by your AI provider — GROOVE tracks it, doesn't control it." />
          </div>
          <div className="text-base font-mono font-bold text-text-1 tabular-nums leading-none">
            {fmtPct((tokens?.cacheHitRate || 0) * 100)}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Success
            <InfoTip text="Agent completion rate. Completed agents vs. crashed agents. High success rate means agents are finishing tasks without errors." />
          </div>
          <div className="text-base font-mono font-bold text-text-1 tabular-nums leading-none">
            {completionRate}%
          </div>
        </div>
      </div>

      {/* Running agents with quality signals */}
      {runningAgents.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2">Live Agent Quality</div>
          <div className="space-y-2">
            {runningAgents.map((agent) => {
              const q = agent.quality || {};
              const live = liveScores[agent.id];
              const score = live?.score ?? q.score;
              const rc = roleColor(agent.role);
              return (
                <div key={agent.id} className="bg-surface-0 rounded p-2.5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-2xs font-mono font-semibold capitalize px-1.5 py-px rounded-sm" style={{ background: rc.bg, color: rc.text }}>
                      {agent.role}
                    </span>
                    <span className="text-xs font-mono text-text-1 truncate flex-1">{agent.name}</span>
                    <span className="text-sm font-mono font-bold tabular-nums" style={{ color: qualityColor(score) }}>
                      {score ?? '—'}
                    </span>
                  </div>
                  <QualityBar score={score} />
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <SignalPill label="Errors" value={q.errorCount} danger />
                    <SignalPill label="Reps" value={q.repetitions} danger />
                    <SignalPill label="Churn" value={q.fileChurn} danger />
                    <SignalPill label="Tools" value={q.toolCalls} />
                    <SignalPill label="Files" value={q.filesWritten} />
                    {q.toolCalls > 0 && (
                      <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                        Success: <span style={{ color: q.toolSuccessRate >= 0.8 ? '#4ae168' : '#e5c07b' }}>
                          {Math.round(q.toolSuccessRate * 100)}%
                        </span>
                      </span>
                    )}
                    {q.eventCount > 0 && (
                      <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                        Events: <span className="text-text-2">{q.eventCount}</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Internal Overhead (GROOVE's own cost to coordinate) */}
      {tokens?.internalOverhead?.tokens > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-wider flex items-center">
              GROOVE Overhead
              <InfoTip text="Tokens consumed by GROOVE's own coordination: the Journalist (synthesis), PM (approval gates), Planner, Task Negotiator, Gateway, and user Q&A. Previously invisible — now tracked for honest ROI." />
            </span>
            <div className="flex items-center gap-2">
              <span className="text-2xs font-mono text-text-2 tabular-nums">
                {fmtNum(tokens.internalOverhead.tokens)} tokens
              </span>
              <span className="text-2xs font-mono text-text-3 tabular-nums">
                {fmtDollar(tokens.internalOverhead.costUsd || 0)}
              </span>
              {tokens.totalTokens > 0 && (
                <span className="text-2xs font-mono font-semibold tabular-nums" style={{ color: HEX.purple }}>
                  {Math.round((tokens.internalOverhead.tokens / tokens.totalTokens) * 100)}%
                </span>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {Object.entries(tokens.internalOverhead.components || {})
              .sort((a, b) => (b[1].tokens || 0) - (a[1].tokens || 0))
              .slice(0, 6)
              .map(([id, comp]) => {
                const label = id.replace(/^__|__$/g, '').replace(/_/g, ' ');
                return (
                  <div key={id} className="bg-surface-0 rounded px-2 py-1.5">
                    <div className="text-2xs font-mono text-text-3 uppercase tracking-wider truncate">{label}</div>
                    <div className="text-xs font-mono text-text-1 tabular-nums font-semibold">
                      {fmtNum(comp.tokens || 0)}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Coordination savings */}
      {(tokens?.savings?.total || 0) > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xs font-mono text-text-3 uppercase tracking-wider flex items-center">
              Coordination Savings
              <InfoTip text="Tokens saved vs. uncoordinated agents. Rotation savings are estimated from context degradation (pre/post velocity measurement underway). Conflict prevention and cold-start skip use fixed-overhead models. Compare against GROOVE Overhead above for honest ROI." />
            </span>
            <span className="text-2xs font-mono text-text-2 tabular-nums">{fmtNum(tokens.savings.total)} tokens</span>
          </div>
          <div className="space-y-2">
            <div className="space-y-1">
              <ProgressBar label="Cold-start skip" value={tokens.savings.fromColdStartSkip || 0} total={tokens.savings.total || 1} color={HEX.info} />
              <div className="text-2xs font-mono text-text-4 pl-2">estimated · {(tokens?.savings?.fromColdStartSkip || 0) > 0 ? 'fixed overhead per skip' : ''}</div>
            </div>
            <div className="space-y-1">
              <ProgressBar label="Rotation" value={tokens.savings.fromRotation || 0} total={tokens.savings.total || 1} color={HEX.accent} />
              <div className="text-2xs font-mono text-text-4 pl-2">estimated · velocity measurement accumulating</div>
            </div>
            <div className="space-y-1">
              <ProgressBar label="Conflict prevention" value={tokens.savings.fromConflictPrevention || 0} total={tokens.savings.total || 1} color="#4ec9d4" />
              <div className="text-2xs font-mono text-text-4 pl-2">estimated · fixed overhead per conflict</div>
            </div>
          </div>
        </div>
      )}

      {/* Rotation timeline */}
      {recentHistory.length > 0 ? (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2.5">Recent Rotations</div>
          <div className="space-y-0">
            {recentHistory.map((r, i) => {
              const isQuality = r.reason === 'quality_degradation';
              const isNatural = r.reason === 'natural_compaction';
              const isTokenLimit = r.reason === 'token_limit_exceeded';
              const isVelocity = r.reason === 'runaway_velocity';
              const dotColor = isTokenLimit ? '#e06c75'
                : isVelocity ? '#ff8c42'
                : isQuality ? '#e5c07b'
                : isNatural ? '#c678dd'
                : '#33afbc';
              return (
                <div key={i} className="flex items-start gap-2.5">
                  <div className="flex flex-col items-center flex-shrink-0">
                    <div className="h-1.5" />
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: i === 0 ? dotColor : `${dotColor}25`,
                        border: `1px solid ${dotColor}80`,
                        boxShadow: i === 0 ? `0 0 6px ${dotColor}60` : 'none',
                      }}
                    />
                    {i < recentHistory.length - 1 && (
                      <div className="w-px flex-1 mt-1" style={{ background: 'rgba(51,175,188,0.15)', minHeight: '12px' }} />
                    )}
                  </div>
                  <div className={cn('flex-1 bg-surface-0 rounded px-2 py-1.5', i < recentHistory.length - 1 && 'mb-2')}>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-text-1 font-medium capitalize truncate flex-1">
                        {r.agentName || r.role}
                      </span>
                      {isTokenLimit ? (
                        <span className="text-2xs font-mono font-semibold tabular-nums flex-shrink-0" style={{ color: '#e06c75' }}
                          title={`Auto-rotated: agent burned ${r.instanceTokens?.toLocaleString()} tokens in one session`}>
                          T:{fmtPct(((r.instanceTokens || 0) / 1_000_000) * 100).replace('%', 'M')}
                        </span>
                      ) : isVelocity ? (
                        <span className="flex items-center gap-1 flex-shrink-0">
                          <span className="text-2xs font-mono font-semibold tabular-nums" style={{ color: '#ff8c42' }}
                            title={`Auto-rotated: runaway velocity (${r.velocity?.toLocaleString()} tokens in recent window)`}>
                            V:{fmtPct(((r.velocity || 0) / 1_000_000) * 100).replace('%', 'M')}
                          </span>
                          {r.velocityDelta != null && r.velocityDelta > 0 && (
                            <span className="text-2xs font-mono tabular-nums" style={{ color: '#4ae168' }}
                              title={`Post-rotation velocity dropped by ${r.velocityDelta.toLocaleString()} tokens — rotation worked`}>
                              ↓{fmtPct((r.velocityDelta / 1_000_000) * 100).replace('%', 'M')}
                            </span>
                          )}
                        </span>
                      ) : isQuality ? (
                        <span className="text-2xs font-mono font-semibold tabular-nums flex-shrink-0" style={{ color: '#e5c07b' }}>
                          Q:{r.qualityScore}
                        </span>
                      ) : isNatural ? (
                        <span className="text-2xs font-mono font-semibold tabular-nums flex-shrink-0" style={{ color: '#c678dd' }}>
                          {fmtPct((r.contextUsage || 0) * 100)} → {fmtPct((r.contextAfter || 0) * 100)}
                        </span>
                      ) : (
                        <span className="text-2xs font-mono font-semibold tabular-nums flex-shrink-0"
                          style={{ color: (r.contextUsage || 0) > 0.8 ? '#e06c75' : '#33afbc' }}>
                          {fmtPct((r.contextUsage || 0) * 100)}
                        </span>
                      )}
                      <span className="text-2xs font-mono text-text-4 flex-shrink-0">{timeAgo(r.timestamp)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-surface-0 rounded p-3 text-center space-y-1.5">
          <div className="text-xs font-mono text-text-2 font-semibold">Monitoring for degradation</div>
          <div className="text-2xs font-mono text-text-3 leading-relaxed">
            Auto-rotation triggers when session quality drops below 40 (errors, repetitions, file churn) or context exceeds the adaptive threshold.
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Adaptive Tab ───────────────────────────────────────────── */
function AdaptiveTab({ adaptive }) {
  if (!adaptive?.length) {
    return (
      <div className="p-3">
        <div className="bg-surface-0 rounded p-4 text-center space-y-2">
          <div className="text-xs font-mono text-text-2 font-semibold">No adaptive profiles yet</div>
          <div className="text-2xs font-mono text-text-3 leading-relaxed">
            Adaptive thresholds learn when each agent role benefits from rotation. GROOVE tracks quality scores and adjusts rotation triggers automatically — converging to the optimal threshold per role and provider.
          </div>
        </div>
      </div>
    );
  }

  function parseKey(key) {
    const parts = key.split(':');
    return { provider: parts[0] || key, role: parts[1] || '' };
  }

  return (
    <div className="p-3 space-y-3">
      {adaptive.map((p) => {
        const { provider, role } = parseKey(p.key);
        const displayRole = role || provider;
        const hasHistory = p.thresholdHistory?.length > 1;
        const hasScores = p.recentScores?.length > 1;
        const rc = roleColor(displayRole);
        const signals = p.lastSignals;

        return (
          <div
            key={p.key}
            className="rounded overflow-hidden"
            style={{
              background: 'rgba(51,175,188,0.04)',
              borderLeft: p.converged ? '2px solid #33afbc' : '2px solid rgba(229,192,123,0.35)',
            }}
          >
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
              <span className="text-xs font-mono font-semibold capitalize px-1.5 py-px rounded-sm" style={{ background: rc.bg, color: rc.text }}>
                {displayRole}
              </span>
              {role && (
                <span className="text-2xs font-mono text-text-4 bg-surface-4 px-1.5 py-px rounded-sm">{provider}</span>
              )}
              <div className="flex-1" />
              <span
                className="flex items-center gap-1 text-2xs font-mono font-bold px-2 py-px rounded-full"
                style={{
                  background: p.converged ? 'rgba(74,225,104,0.12)' : 'rgba(229,192,123,0.12)',
                  color: p.converged ? '#4ae168' : '#e5c07b',
                }}
              >
                {!p.converged && (
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: '#e5c07b', animation: 'node-pulse-bar 1.5s ease-in-out infinite' }} />
                )}
                {p.converged ? 'Converged' : 'Learning'}
              </span>
            </div>

            <div className="flex items-end gap-5 px-3 pb-2">
              <div>
                <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-0.5">Threshold</div>
                <div className="text-3xl font-mono font-bold tabular-nums leading-none"
                  style={{ color: p.converged ? '#33afbc' : '#e5c07b' }}>
                  {fmtPct(p.threshold * 100)}
                </div>
              </div>
              <div className="pb-0.5">
                <div className="text-2xs font-mono text-text-4 uppercase tracking-wider mb-0.5">Adj.</div>
                <div className="text-lg font-mono font-semibold text-text-1 tabular-nums">{p.adjustments}</div>
              </div>
            </div>

            {(hasHistory || hasScores) && (
              <div className="px-3 pb-2 space-y-2 overflow-hidden">
                {hasHistory && (
                  <div>
                    <div className="text-2xs font-mono text-text-4 mb-0.5">Threshold history</div>
                    <TinySparkline data={p.thresholdHistory.map((h) => h.v)} color={p.converged ? HEX.accent : HEX.warning} width={240} height={32} />
                  </div>
                )}
                {hasScores && (
                  <div>
                    <div className="text-2xs font-mono text-text-4 mb-0.5">Quality score</div>
                    <TinySparkline data={p.recentScores} color={HEX.warning} width={240} height={24} />
                  </div>
                )}
              </div>
            )}

            {signals && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                <SignalPill label="Errors" value={signals.errorCount} danger />
                <SignalPill label="Reps" value={signals.repetitions} danger />
                <SignalPill label="Churn" value={signals.fileChurn} danger />
                {signals.toolSuccessRate != null && (
                  <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3">
                    Tools: <span className="text-text-1">{Math.round(signals.toolSuccessRate * 100)}%</span>
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Journalist Tab ─────────────────────────────────────────── */
function JournalistTab({ journalist }) {
  if (!journalist) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-3 font-mono p-4">
        Journalist inactive
      </div>
    );
  }

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Cycles</div>
          <div className="text-lg font-mono font-semibold text-text-0 tabular-nums leading-none">{journalist.cycleCount || 0}</div>
        </div>
        {journalist.lastCycleAt && (
          <div>
            <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-0.5">Last</div>
            <div className="text-xs font-mono text-text-2">{timeAgo(journalist.lastCycleAt)}</div>
          </div>
        )}
        {journalist.synthesizing && (
          <span className="text-2xs font-mono font-bold text-accent uppercase tracking-wider animate-pulse">Synthesizing</span>
        )}
      </div>

      {journalist.lastSummary && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Summary</div>
          <div className="text-xs font-sans text-text-2 leading-relaxed">{journalist.lastSummary}</div>
        </div>
      )}

      {journalist.projectMap && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Project Map</div>
          <div className="text-xs font-mono text-text-2 leading-relaxed whitespace-pre-wrap">{journalist.projectMap}</div>
        </div>
      )}

      {journalist.decisions && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1">Decisions</div>
          <div className="text-xs font-mono text-text-2 leading-relaxed whitespace-pre-wrap">{journalist.decisions}</div>
        </div>
      )}

      {journalist.recentHistory?.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1.5">History</div>
          <div className="space-y-1">
            {journalist.recentHistory.slice().reverse().map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono px-2 py-1 bg-surface-0 rounded">
                <span className="text-text-3">#{h.cycle}</span>
                <span className="text-text-2 flex-1 truncate">{h.agentCount} agents</span>
                <span className="text-text-4">{timeAgo(h.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Memory Tab (Layer 7) ───────────────────────────────────── */
function MemoryTab({ memory }) {
  const constraints = memory?.constraints || [];
  const discoveries = memory?.discoveries || [];
  const roles = memory?.roles || [];
  const perAgent = memory?.specializations?.perAgent || {};
  const perRole = memory?.specializations?.perProjectRole || {};
  const agentCount = Object.keys(perAgent).length;
  const roleCount = Object.keys(perRole).length;

  const totalItems = constraints.length + discoveries.length + roles.length;
  if (totalItems === 0 && agentCount === 0) {
    return (
      <div className="p-6 text-center text-xs font-mono text-text-3">
        <BookOpen size={24} className="mx-auto mb-2 text-text-4" />
        <div>No memory accumulated yet</div>
        <div className="text-2xs text-text-4 mt-1">Constraints, handoff chains, and discoveries populate as agents work</div>
      </div>
    );
  }

  return (
    <div className="p-3 space-y-4">
      {/* Hero stats */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Constraints
            <InfoTip text="Project rules discovered by agents or set by the user. Every new agent reads these on spawn to avoid rediscovering them." />
          </div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.accent }}>
            {constraints.length}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Discoveries
            <InfoTip text="Error→fix pairs successful agents have recorded. Injected into future agent context so they don't rediscover known solutions." />
          </div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.success }}>
            {discoveries.length}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Handoff Chains
            <InfoTip text="Cumulative rotation briefs per role. Agent #50 knows what agent #1 struggled with. Each role keeps its last 10 rotation briefs." />
          </div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.purple }}>
            {roles.length}
          </div>
        </div>
        <div className="bg-surface-0 rounded p-2.5">
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-1 flex items-center">
            Specializations
            <InfoTip text="Per-agent quality profiles: session counts, average quality, file touches, preferred thresholds." />
          </div>
          <div className="text-2xl font-mono font-bold tabular-nums leading-none" style={{ color: HEX.info }}>
            {agentCount}
          </div>
          {roleCount > 0 && (
            <div className="text-2xs font-mono text-text-4 mt-0.5">across {roleCount} roles</div>
          )}
        </div>
      </div>

      {/* Constraints list */}
      {constraints.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2">Project Constraints</div>
          <div className="space-y-1">
            {constraints.slice(0, 10).map((c) => (
              <div key={c.hash} className="flex items-start gap-2 bg-surface-0 rounded px-2 py-1.5">
                <span className="text-2xs font-mono px-1.5 py-px rounded-sm bg-surface-4 text-text-3 uppercase tracking-wider flex-shrink-0 mt-0.5">
                  {c.category}
                </span>
                <span className="text-xs font-mono text-text-2 leading-relaxed flex-1">{c.text}</span>
              </div>
            ))}
            {constraints.length > 10 && (
              <div className="text-2xs font-mono text-text-4 px-2">+{constraints.length - 10} more</div>
            )}
          </div>
        </div>
      )}

      {/* Recent discoveries */}
      {discoveries.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2">Recent Discoveries</div>
          <div className="space-y-1.5">
            {discoveries.slice(0, 8).map((d, i) => {
              const rc = roleColor(d.role);
              return (
                <div key={i} className="bg-surface-0 rounded px-2 py-1.5 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-2xs font-mono font-semibold capitalize px-1.5 py-px rounded-sm" style={{ background: rc.bg, color: rc.text }}>
                      {d.role}
                    </span>
                    <span className="text-2xs font-mono text-text-4 flex-1">{timeAgo(d.ts)}</span>
                  </div>
                  <div className="text-xs font-mono text-text-2 leading-relaxed">
                    <span className="text-text-4">When:</span> <span className="text-text-1">{d.trigger}</span>
                  </div>
                  <div className="text-xs font-mono text-text-2 leading-relaxed">
                    <span className="text-text-4">Fix:</span> <span style={{ color: HEX.success }}>{d.fix}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Handoff chain roles */}
      {roles.length > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2">Active Role Chains</div>
          <div className="flex flex-wrap gap-1.5">
            {roles.map((role) => {
              const rc = roleColor(role);
              return (
                <span key={role} className="text-2xs font-mono font-semibold capitalize px-2 py-1 rounded" style={{ background: rc.bg, color: rc.text }}>
                  {role}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-role specialization summary */}
      {roleCount > 0 && (
        <div>
          <div className="text-2xs font-mono text-text-3 uppercase tracking-wider mb-2">Role Quality Profiles</div>
          <div className="space-y-1">
            {Object.entries(perRole).map(([role, data]) => {
              const rc = roleColor(role);
              return (
                <div key={role} className="flex items-center gap-2 bg-surface-0 rounded px-2 py-1.5">
                  <span className="text-2xs font-mono font-semibold capitalize px-1.5 py-px rounded-sm" style={{ background: rc.bg, color: rc.text }}>
                    {role}
                  </span>
                  <span className="text-xs font-mono text-text-3 flex-1">{data.sessionCount} sessions</span>
                  <span className="text-xs font-mono font-semibold tabular-nums" style={{ color: qualityColor(data.avgQualityScore) }}>
                    Q:{data.avgQualityScore}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Intel Panel (main export) ──────────────────────────────── */
const IntelPanel = memo(function IntelPanel({ tokens, rotation, adaptive, journalist, agentBreakdown, memory }) {
  return (
    <Tabs defaultValue="health" className="flex flex-col h-full">
      <TabsList className="flex-shrink-0 px-1">
        <TabsTrigger value="health" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Activity size={11} />
          Health
        </TabsTrigger>
        <TabsTrigger value="memory" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <BookOpen size={11} />
          Memory
        </TabsTrigger>
        <TabsTrigger value="adaptive" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Brain size={11} />
          Adaptive
        </TabsTrigger>
        <TabsTrigger value="journalist" className="text-xs px-2.5 py-1.5 inline-flex items-center gap-1.5">
          <Radio size={11} />
          Journalist
        </TabsTrigger>
      </TabsList>

      <TabsContent value="health" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <HealthTab tokens={tokens} rotation={rotation} agentBreakdown={agentBreakdown} />
        </div>
      </TabsContent>
      <TabsContent value="memory" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <MemoryTab memory={memory} />
        </div>
      </TabsContent>
      <TabsContent value="adaptive" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <AdaptiveTab adaptive={adaptive} />
        </div>
      </TabsContent>
      <TabsContent value="journalist" className="flex-1 min-h-0 relative">
        <div className="absolute inset-0 overflow-y-auto">
          <JournalistTab journalist={journalist} />
        </div>
      </TabsContent>
    </Tabs>
  );
});

export { IntelPanel };
