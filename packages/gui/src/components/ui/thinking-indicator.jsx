// FSL-1.1-Apache-2.0 — see LICENSE
import { useState, useEffect } from 'react';

const MESSAGES = [
  'Reading through the codebase...',
  'Thinking through your request...',
  'Planning the approach...',
  'Running tool calls...',
  'Working through the problem...',
  'Reasoning step by step...',
  'Reviewing context...',
  'Considering options...',
  'Analyzing the code...',
  'Making progress...',
];

export function ThinkingIndicator({ agent, className }) {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % MESSAGES.length);
        setFade(true);
      }, 250);
    }, 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <div className={`${className || ''}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-2xs font-semibold text-text-1 font-sans">{agent?.name || 'Agent'}</span>
        <span className="text-2xs text-accent font-mono">thinking</span>
      </div>
      <div className="border-l border-accent/40 pl-3.5 py-1 flex items-center gap-2.5">
        {/* Spinning ring */}
        <div className="relative w-3.5 h-3.5 flex-shrink-0">
          <span className="absolute inset-0 rounded-full border border-transparent border-t-accent animate-spin" style={{ animationDuration: '0.9s' }} />
        </div>
        <span
          className="text-[12px] font-sans text-text-3 transition-opacity duration-[250ms]"
          style={{ opacity: fade ? 1 : 0 }}
        >
          {MESSAGES[idx]}
        </span>
      </div>
    </div>
  );
}
