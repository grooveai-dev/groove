// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';
import { Sparkles } from 'lucide-react';

const PHASES = [
  'Reasoning',
  'Analyzing',
  'Processing',
  'Thinking',
  'Evaluating',
];

export function ThinkingIndicator({ className }) {
  const [phase, setPhase] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  // Cycle through phases every 3s
  useEffect(() => {
    const t = setInterval(() => setPhase((p) => (p + 1) % PHASES.length), 3000);
    return () => clearInterval(t);
  }, []);

  // Elapsed timer
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const label = PHASES[phase];
  const secs = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <div className={`flex items-center gap-2.5 ${className || ''}`}>
      <div className="relative flex items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-2 border border-border-subtle overflow-hidden">
        {/* Shimmer sweep */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-accent/[0.04] to-transparent animate-shimmer" />

        <Sparkles size={13} className="text-accent animate-pulse flex-shrink-0" />
        <span className="text-xs font-sans text-text-2 relative">
          {label}
          <span className="inline-flex w-[18px]">
            <span className="animate-ellipsis" />
          </span>
        </span>
        <span className="text-2xs font-mono text-text-4 tabular-nums relative">{secs}</span>
      </div>
    </div>
  );
}
