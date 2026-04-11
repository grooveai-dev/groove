// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';

const PHASES = [
  'Analyzing codebase',
  'Reading context',
  'Planning approach',
  'Reasoning through solution',
  'Evaluating options',
];

const DETAILS = [
  ['Scanning project structure...', 'Checking dependencies...', 'Reviewing recent changes...'],
  ['Parsing file tree...', 'Loading imports...', 'Indexing symbols...'],
  ['Mapping task scope...', 'Identifying constraints...', 'Outlining steps...'],
  ['Tracing logic flow...', 'Considering edge cases...', 'Weighing approaches...'],
  ['Comparing alternatives...', 'Checking tradeoffs...', 'Selecting best path...'],
];

export function ThinkingIndicator({ agent, className }) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Cycle phases every 3.5s
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 3500);
    return () => clearInterval(t);
  }, []);

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const secs = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className={`relative rounded-xl bg-surface-2 border border-border-subtle overflow-hidden my-2 ${className || ''}`}>
      {/* Shimmer sweep */}
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/[0.04] to-transparent animate-shimmer pointer-events-none" />

      <div className="relative px-4 py-4 min-h-[90px]">
        {/* Header: spinning ring + identity + timer */}
        <div className="flex items-center gap-3 mb-4">
          {/* Spinning ring — same pattern as BootSequence */}
          <div className="relative w-8 h-8 flex-shrink-0">
            <span className="absolute inset-0 rounded-full border-2 border-accent/15 animate-ping" style={{ animationDuration: '2.5s' }} />
            <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-accent animate-spin" style={{ animationDuration: '1.2s' }} />
            <span className="absolute inset-[6px] rounded-full bg-accent/10" />
          </div>

          <div className="flex-1 min-w-0">
            {agent ? (
              <>
                <p className="text-xs font-sans font-semibold text-text-1 truncate leading-tight">{agent.name}</p>
                <p className="text-[10px] font-mono text-accent leading-tight mt-0.5">thinking</p>
              </>
            ) : (
              <p className="text-xs font-sans font-semibold text-text-1 leading-tight">Thinking</p>
            )}
          </div>

          <span className="text-xs font-mono text-text-2 tabular-nums flex-shrink-0">{secs}</span>
        </div>

        {/* Phase label — re-keyed to replay fade-in on phase change */}
        <div className="pl-3 border-l-2 border-accent/25 mb-3">
          <span key={phase} className="block text-[13px] font-sans font-medium text-text-1 animate-phase-in">
            {PHASES[phase]}
          </span>
        </div>

        {/* Staggered detail lines — re-keyed to replay cascade on phase change */}
        <div className="space-y-1.5 pl-3 border-l border-border-subtle">
          {DETAILS[phase].map((line, i) => (
            <div
              key={`${phase}-${i}`}
              className="flex items-center gap-2 animate-cascade-in"
              style={{ animationDelay: `${150 + i * 200}ms` }}
            >
              <span className="w-1 h-1 rounded-full bg-accent/35 flex-shrink-0" />
              <span className="text-[11px] font-mono text-text-3">{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
