// FSL-1.1-Apache-2.0 — see LICENSE
import { memo } from 'react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { ScrollArea } from '../ui/scroll-area';
import { fmtNum, fmtPct, timeAgo } from '../../lib/format';
import { cn } from '../../lib/cn';
import { HEX } from '../../lib/theme-hex';
import { RotateCw, Brain, Radio } from 'lucide-react';

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
      <polyline points={points} fill="none" stroke={color} strokeWidth="1" strokeLinejoin="round" strokeOpacity="0.6" />
    </svg>
  );
}

/* ── Savings bar ────────────────────────────────────────────── */
function SavingsBar({ label, value, total, color }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-[9px] font-mono">
        <span className="text-[#6e7681]">{label}</span>
        <span className="text-[#8b929e] tabular-nums">{fmtNum(value)}</span>
      </div>
      <div className="h-[2px] bg-[#1a1e25] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.min(pct, 100)}%`, background: color }}
        />
      </div>
    </div>
  );
}

/* ── Rotation Tab ───────────────────────────────────────────── */
function RotationTab({ tokens, rotation }) {
  const savings = tokens?.savings || {};
  const totalSaved = savings.total || 0;
  const totalUsed = tokens?.totalTokens || 0;
  const hypothetical = totalUsed + totalSaved;

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-4">
        {/* Big numbers */}
        <div className="flex gap-4">
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-0.5">Rotations</div>
            <div className="text-[18px] font-mono font-semibold text-[#bcc2cd] tabular-nums leading-none">
              {rotation?.totalRotations || 0}
            </div>
          </div>
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-0.5">Saved</div>
            <div className="text-[18px] font-mono font-semibold text-[#4ae168] tabular-nums leading-none">
              {fmtNum(totalSaved)}
            </div>
            {hypothetical > 0 && (
              <div className="text-[8px] font-mono text-[#505862] mt-0.5">
                {fmtPct((totalSaved / hypothetical) * 100)} of total
              </div>
            )}
          </div>
        </div>

        {/* Savings breakdown */}
        <div className="space-y-2">
          <SavingsBar label="Rotation" value={savings.fromRotation || 0} total={hypothetical} color={HEX.accent} />
          <SavingsBar label="Conflict prevention" value={savings.fromConflictPrevention || 0} total={hypothetical} color={HEX.purple} />
          <SavingsBar label="Cold-start skip" value={savings.fromColdStartSkip || 0} total={hypothetical} color={HEX.info} />
        </div>

        {/* Rotation history */}
        {rotation?.history?.length > 0 && (
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-1.5">Recent</div>
            <div className="space-y-1">
              {rotation.history.slice(-8).reverse().map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-[9px] font-mono px-2 py-1 bg-[#1a1e25] rounded">
                  <span className="text-[#8b929e] font-medium capitalize truncate flex-1">{r.agentName || r.role}</span>
                  <span className="text-[#505862] tabular-nums">{fmtPct((r.contextUsage || 0) * 100)}</span>
                  <span className="text-[#3a3f4b]">{timeAgo(r.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/* ── Adaptive Tab ───────────────────────────────────────────── */
function AdaptiveTab({ adaptive }) {
  if (!adaptive?.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-[9px] text-[#3a3f4b] font-mono p-4">
        No adaptive profiles
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {adaptive.map((p) => (
          <div key={p.key} className="bg-[#1a1e25] rounded px-2.5 py-2 space-y-1.5">
            {/* Profile header */}
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-mono text-[#8b929e] flex-1 truncate">{p.key}</span>
              <span className="text-[10px] font-mono font-semibold text-[#bcc2cd] tabular-nums">
                {fmtPct(p.threshold * 100)}
              </span>
              <span
                className={cn(
                  'text-[7px] font-mono font-bold uppercase px-1 py-px rounded-sm',
                  p.converged
                    ? 'text-[#4ae168] bg-[rgba(74,225,104,0.1)]'
                    : 'text-[#505862] bg-[rgba(80,88,98,0.1)]',
                )}
              >
                {p.converged ? 'CONV' : `${p.adjustments} adj`}
              </span>
            </div>

            {/* Threshold drift sparkline */}
            {p.thresholdHistory?.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[7px] font-mono text-[#3a3f4b] uppercase tracking-wider">Drift</span>
                <TinySparkline
                  data={p.thresholdHistory.map((h) => h.v)}
                  color={p.converged ? HEX.success : HEX.accent}
                  width={80}
                  height={14}
                />
              </div>
            )}

            {/* Quality scores sparkline */}
            {p.recentScores?.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-[7px] font-mono text-[#3a3f4b] uppercase tracking-wider">Quality</span>
                <TinySparkline
                  data={p.recentScores}
                  color={HEX.warning}
                  width={80}
                  height={14}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

/* ── Journalist Tab ─────────────────────────────────────────── */
function JournalistTab({ journalist }) {
  if (!journalist) {
    return (
      <div className="flex-1 flex items-center justify-center text-[9px] text-[#3a3f4b] font-mono p-4">
        Journalist inactive
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-3 space-y-3">
        {/* Status row */}
        <div className="flex items-center gap-3">
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-0.5">Cycles</div>
            <div className="text-[16px] font-mono font-semibold text-[#bcc2cd] tabular-nums leading-none">
              {journalist.cycleCount || 0}
            </div>
          </div>
          {journalist.lastCycleAt && (
            <div>
              <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-0.5">Last</div>
              <div className="text-[10px] font-mono text-[#6e7681]">{timeAgo(journalist.lastCycleAt)}</div>
            </div>
          )}
          {journalist.synthesizing && (
            <span className="text-[7px] font-mono font-bold text-[#33afbc] uppercase tracking-wider animate-pulse">
              Synthesizing
            </span>
          )}
        </div>

        {/* Last summary */}
        {journalist.lastSummary && (
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-1">Summary</div>
            <div className="text-[9px] font-sans text-[#6e7681] leading-relaxed bg-[#1a1e25] rounded px-2.5 py-2 max-h-32 overflow-y-auto">
              {journalist.lastSummary}
            </div>
          </div>
        )}

        {/* Recent history */}
        {journalist.recentHistory?.length > 0 && (
          <div>
            <div className="text-[8px] font-mono text-[#3a3f4b] uppercase tracking-widest mb-1.5">History</div>
            <div className="space-y-1">
              {journalist.recentHistory.slice().reverse().map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-[9px] font-mono px-2 py-1 bg-[#1a1e25] rounded">
                  <span className="text-[#505862]">#{h.cycle}</span>
                  <span className="text-[#6e7681] flex-1 truncate">{h.agentCount} agents</span>
                  <span className="text-[#3a3f4b]">{timeAgo(h.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

/* ── Intel Panel (main export) ──────────────────────────────── */
const IntelPanel = memo(function IntelPanel({ tokens, rotation, adaptive, journalist }) {
  return (
    <Tabs defaultValue="rotation" className="flex flex-col h-full">
      <TabsList className="flex-shrink-0 px-1 border-b border-[#262a32]">
        <TabsTrigger value="rotation" className="text-[9px] px-2.5 py-1.5 gap-1">
          <RotateCw size={10} />
          Rotation
        </TabsTrigger>
        <TabsTrigger value="adaptive" className="text-[9px] px-2.5 py-1.5 gap-1">
          <Brain size={10} />
          Adaptive
        </TabsTrigger>
        <TabsTrigger value="journalist" className="text-[9px] px-2.5 py-1.5 gap-1">
          <Radio size={10} />
          Journalist
        </TabsTrigger>
      </TabsList>

      <TabsContent value="rotation" className="flex-1 min-h-0 overflow-hidden">
        <RotationTab tokens={tokens} rotation={rotation} />
      </TabsContent>
      <TabsContent value="adaptive" className="flex-1 min-h-0 overflow-hidden">
        <AdaptiveTab adaptive={adaptive} />
      </TabsContent>
      <TabsContent value="journalist" className="flex-1 min-h-0 overflow-hidden">
        <JournalistTab journalist={journalist} />
      </TabsContent>
    </Tabs>
  );
});

export { IntelPanel };
